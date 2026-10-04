const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { act, create } = require('react-test-renderer');
const load = require('./helpers/loadComponent.cjs');
const { createMembershipRequestCache } = require('../src/components/memberships/membershipRequestCache.js');
global.IS_REACT_ACT_ENVIRONMENT = true;

const coordinate = { latitude: 27.987654, longitude: -82.754321 };
const address = state => [{ isoCountryCode: 'US', region: state }];
const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
};
function cache(options = {}) {
    return createMembershipRequestCache({
        reverseGeocode: async () => address('FL'),
        fetchMembershipIDs: async () => ({ data: ['sams'] }),
        normalizeState: state => state,
        retryDelayMs: 0,
        ...options,
    });
}

test('concurrent and repeated coordinate requests share exact geocoding and one RPC', async () => {
    const lookups = [], states = [];
    const requests = cache({
        reverseGeocode: async point => { lookups.push(point); return address('FL'); },
        fetchMembershipIDs: async state => { states.push(state); return { data: ['sams'] }; },
    });
    const results = await Promise.all([requests.load(coordinate), requests.load({ ...coordinate })]);
    await requests.load(coordinate);
    assert.deepEqual(lookups, [coordinate], 'the geocoder receives the unrounded GPS position');
    assert.deepEqual(states, ['FL']);
    assert.deepEqual(results[0], results[1]);
    assert.deepEqual(requests.peek(coordinate).ids, ['sams']);
});

test('different coordinates in one state share an in-flight RPC and cache empty results', async () => {
    const pending = deferred();
    let calls = 0;
    const requests = cache({ fetchMembershipIDs: async () => { calls++; return pending.promise; } });
    const a = requests.load(coordinate);
    const b = requests.load({ ...coordinate, latitude: 28 });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1);
    pending.resolve({ data: [] });
    assert.deepEqual((await a).ids, []);
    assert.deepEqual((await b).ids, []);
    await requests.load(coordinate);
    assert.equal(calls, 1, 'an empty valid response is reusable');
});

test('coordinate and membership caches expire independently and evict old entries', async () => {
    let time = 0, geocodes = 0, rpcs = 0;
    const requests = cache({
        now: () => time, coordinateTTL: 10, membershipTTL: 20, maxEntries: 2,
        reverseGeocode: async () => { geocodes++; return address('FL'); },
        fetchMembershipIDs: async () => { rpcs++; return { data: ['sams'] }; },
    });
    await requests.load(coordinate);
    time = 11;
    assert.equal(requests.peek(coordinate), null);
    await requests.load(coordinate);
    assert.deepEqual([geocodes, rpcs], [2, 1]);
    time = 21;
    await requests.load(coordinate);
    assert.deepEqual([geocodes, rpcs], [3, 2]);
    await requests.load({ latitude: 28, longitude: -82 });
    await requests.load({ latitude: 29, longitude: -82 });
    assert.equal(requests.peek(coordinate), null, 'bounded coordinate cache evicts least recently used entry');
});

test('nearby coordinates on opposite sides of a state border do not share a state', async () => {
    const states = [];
    const requests = cache({
        reverseGeocode: async point => address(point.latitude < 35 ? 'NC' : 'SC'),
        fetchMembershipIDs: async state => { states.push(state); return { data: [state] }; },
    });
    const a = await requests.load({ latitude: 34.9999, longitude: -82 });
    const b = await requests.load({ latitude: 35.0001, longitude: -82 });
    assert.deepEqual(states, ['NC', 'SC']);
    assert.notEqual(a.key, b.key);
    assert.deepEqual(b.ids, ['SC']);
});

test('failed RPC retries reuse the resolved state and do not poison later requests', async () => {
    let geocodes = 0, rpcs = 0;
    const requests = cache({
        reverseGeocode: async () => { geocodes++; return address('FL'); },
        fetchMembershipIDs: async () => ++rpcs <= 2 ? { error: new Error('offline') } : { data: ['sams'] },
    });
    await assert.rejects(requests.load(coordinate), /Could not load memberships/);
    assert.deepEqual([geocodes, rpcs], [1, 2]);
    assert.deepEqual((await requests.load(coordinate)).ids, ['sams']);
    assert.deepEqual([geocodes, rpcs], [1, 3]);
});

test('hook hides the prior state immediately and ignores a slower old coordinate response', async () => {
    const old = deferred();
    const hook = load('src/components/memberships/useMembershipOptions.js', {
        'expo-location': { reverseGeocodeAsync: point => point.latitude === 28 ? old.promise : Promise.resolve(address('Georgia')) },
        '../../lib/supabase': { supabase: { rpc: async (_, { p_state }) => ({ data: [p_state] }) } },
    }).default;
    let output;
    const renders = [];
    function Harness({ latitude }) {
        output = hook({ latitude, longitude: -82 }, true);
        renders.push({ latitude, ...output });
        return null;
    }
    let view;
    await act(async () => { view = create(React.createElement(Harness, { latitude: 28 })); });
    await act(async () => view.update(React.createElement(Harness, { latitude: 33 })));
    assert.equal(renders.find(entry => entry.latitude === 33).loading, true);
    assert.equal(renders.find(entry => entry.latitude === 33).ids, undefined);
    assert.deepEqual(output.ids, ['GA']);
    await act(async () => old.resolve(address('Florida')));
    assert.deepEqual(output.ids, ['GA']);
    await act(async () => view.unmount());
});

test('hook remount reads cached results without another geocode or RPC', async () => {
    let geocodes = 0, rpcs = 0, output;
    const hook = load('src/components/memberships/useMembershipOptions.js', {
        'expo-location': { reverseGeocodeAsync: async () => { geocodes++; return address('Florida'); } },
        '../../lib/supabase': { supabase: { rpc: async () => { rpcs++; return { data: ['sams'] }; } } },
    }).default;
    function Harness() { output = hook(coordinate, true); return null; }
    let view;
    await act(async () => { view = create(React.createElement(Harness)); });
    await act(async () => view.unmount());
    await act(async () => { view = create(React.createElement(Harness)); });
    assert.equal(output.loading, false);
    assert.deepEqual(output.ids, ['sams']);
    assert.deepEqual([geocodes, rpcs], [1, 1]);
    await act(async () => view.unmount());
});

test('a loaded state disappears during a coordinate change and inactive results cannot overwrite it', async () => {
    const next = deferred();
    const hook = load('src/components/memberships/useMembershipOptions.js', {
        'expo-location': { reverseGeocodeAsync: point => point.latitude === 28 ? Promise.resolve(address('Florida')) : next.promise },
        '../../lib/supabase': { supabase: { rpc: async (_, { p_state }) => ({ data: [p_state] }) } },
    }).default;
    let output;
    function Harness({ latitude, active = true }) {
        output = hook({ latitude, longitude: -82 }, active);
        return null;
    }
    let view;
    await act(async () => { view = create(React.createElement(Harness, { latitude: 28 })); });
    assert.deepEqual(output.ids, ['FL']);
    await act(async () => view.update(React.createElement(Harness, { latitude: 33 })));
    assert.equal(output.ids, undefined);
    assert.equal(output.state, undefined);
    assert.equal(output.loading, true);
    await act(async () => view.update(React.createElement(Harness, { latitude: 33, active: false })));
    await act(async () => next.resolve(address('Georgia')));
    assert.equal(output.ids, undefined, 'deactivation prevents publishing the in-flight result');
    await act(async () => view.update(React.createElement(Harness, { latitude: 33 })));
    assert.deepEqual(output.ids, ['GA']);
    await act(async () => view.unmount());
});

test('manual retry clears an error and shares the successful resolved state', async () => {
    let calls = 0, output;
    const hook = load('src/components/memberships/useMembershipOptions.js', {
        'expo-location': { reverseGeocodeAsync: async () => address('Florida') },
        '../../lib/supabase': { supabase: { rpc: async () => ++calls <= 2 ? { error: new Error('offline') } : { data: ['sams'] } } },
        './membershipRequestCache': {
            ...require('../src/components/memberships/membershipRequestCache.js'),
            createMembershipRequestCache: options => createMembershipRequestCache({ ...options, retryDelayMs: 0 }),
        },
    }).default;
    function Harness() { output = hook(coordinate, true); return null; }
    let view;
    await act(async () => { view = create(React.createElement(Harness)); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    assert.match(output.error, /Could not load memberships/);
    await act(async () => output.retry());
    assert.equal(output.error, undefined);
    assert.equal(output.loading, false);
    assert.deepEqual(output.ids, ['sams']);
    assert.equal(calls, 3);
    await act(async () => view.unmount());
});
