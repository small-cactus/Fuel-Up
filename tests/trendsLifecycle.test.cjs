const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { act, create } = require('react-test-renderer');
const load = require('./helpers/loadComponent.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('local freshness removes expired reports and preserves data identity between unchanged renders', async () => {
    const state = await setup();
    await act(async () => state.requests[0].resolve({ leaderboard: [
        { stationId: 'fresh', latestPrice: 3.49, updatedAt: new Date().toISOString() },
        { stationId: 'old', latestPrice: 1, updatedAt: new Date(Date.now() - 86400001).toISOString() },
    ] }));
    const displayed = state.value.data;
    assert.deepEqual(displayed.leaderboard.map(row => row.stationId), ['fresh']);
    await state.update({});
    assert.equal(state.value.data, displayed, 'ordinary renders must not restart the trend background animation');
    await state.unmount();
});

async function setup(options = {}) {
    let generation = 0; let value; let renderer;
    const requests = []; const commits = []; const cache = new Map(); const rendered = [];
    const gps = options.gps || deferred();
    const key = p => `${p.fuelType}:${p.latitude},${p.longitude}:${p.radiusMiles}`;
    const service = {
        buildTrendRequestKey: key,
        captureTrendCacheGeneration: () => generation,
        isTrendCacheGenerationCurrent: value => value === generation,
        clearTrendDataCache: () => { generation++; cache.clear(); },
        getCachedTrendData: key => cache.get(key),
        getLastResolvedTrendData: () => null,
        getLastTrendsScreenViewedAt: () => Date.now(),
        prefetchTrendData: params => {
            const task = deferred(); const startedGeneration = generation;
            requests.push({ params, ...task });
            return task.promise.then(data => {
                if (generation !== startedGeneration) return null;
                cache.set(params.requestKey, data); return data;
            });
        },
    };
    const useTrendData = load('src/screens/trends/useTrendData.js', {
        'react-native': { AppState: { addEventListener: () => ({ remove() {} }) } },
        'expo-router': { useFocusEffect: callback => React.useEffect(callback, [callback]) },
        'expo-location': { Accuracy: { Balanced: 3 }, getForegroundPermissionsAsync: async () => ({ status: options.denied ? 'denied' : 'granted' }),
            getCurrentPositionAsync: () => gps.promise },
        '../../services/fuel/trends': service,
    }).default;
    let props = { currentRequestKey: 'regular:27,-82:10', origin: { latitude: 27, longitude: -82 }, fuelGrade: 'regular',
        radiusMiles: 10, preferredProvider: 'gasbuddy', minimumRating: 0, resetToken: 0, commitOrigin: (...args) => commits.push(args), ...options.props };
    function Consumer(input) { value = useTrendData(input); rendered.push(value.data); return null; }
    const element = () => React.createElement(options.strict ? React.StrictMode : React.Fragment, null, React.createElement(Consumer, props));
    await act(async () => { renderer = create(element()); });
    return { requests, commits, gps, rendered, service, get value() { return value; },
        update: async update => { props = { ...props, ...update }; await act(async () => renderer.update(element())); },
        unmount: async () => act(async () => renderer.unmount()),
    };
}

test('old fuel-grade response never flashes over the current grade or starts a fetch loop', async () => {
    const state = await setup();
    assert.equal(state.requests.length, 1);
    await state.update({ currentRequestKey: 'e85:27,-82:10', fuelGrade: 'e85' });
    assert.equal(state.value.data, null);
    assert.equal(state.requests.length, 2);
    await act(async () => state.requests[1].resolve({ grade: 'e85' }));
    await act(async () => state.requests[0].resolve({ grade: 'regular' }));
    assert.equal(state.value.data.grade, 'e85');
    assert.equal(state.rendered.some(data => data?.grade === 'regular'), false);
    assert.equal(state.requests.length, 2);
    await state.unmount();
});

test('late GPS resolution cannot override a manual location chosen while waiting', async () => {
    const state = await setup({ props: { currentRequestKey: '', origin: null } });
    await state.update({ currentRequestKey: 'regular:40,-74:10', origin: { latitude: 40, longitude: -74, locationSource: 'manual' } });
    await act(async () => state.gps.resolve({ coords: { latitude: 27, longitude: -82 } }));
    assert.equal(state.requests.length, 1);
    assert.equal(state.requests[0].params.latitude, 40);
    assert.deepEqual(state.commits, []);
    await state.unmount();
});

test('a cache reset rejects the old completion and starts one current request', async () => {
    const state = await setup();
    await state.update({ resetToken: 1 });
    assert.equal(state.requests.length, 2);
    await act(async () => state.requests[0].resolve({ old: true }));
    assert.equal(state.value.data, null);
    assert.equal(state.value.loading, true);
    await act(async () => state.requests[1].resolve({ fresh: true }));
    assert.deepEqual(state.value.data, { fresh: true });
    await state.unmount();
});

test('denied location does not fetch fake Apple Park prices or repeatedly prompt', async () => {
    const state = await setup({ denied: true, props: { currentRequestKey: '', origin: null } });
    assert.equal(state.value.loading, false);
    assert.match(state.value.error, /Allow location/);
    assert.equal(state.requests.length, 0);
    assert.deepEqual(state.commits, []);
    await state.unmount();
});

test('unmounted location work cannot publish a fix or start a network request', async () => {
    const state = await setup({ props: { currentRequestKey: '', origin: null } });
    await state.unmount();
    await act(async () => state.gps.resolve({ coords: { latitude: 27, longitude: -82 } }));
    assert.equal(state.requests.length, 0);
    assert.deepEqual(state.commits, []);
});

test('StrictMode remount accepts current data and ignores the abandoned request', async () => {
    const state = await setup({ strict: true });
    const current = state.requests.at(-1);
    await act(async () => current.resolve({ current: true }));
    for (const abandoned of state.requests.slice(0, -1)) await act(async () => abandoned.resolve({ abandoned: true }));
    assert.deepEqual(state.value.data, { current: true });
    await state.unmount();
});
