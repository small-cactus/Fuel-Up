const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { act, create } = require('react-test-renderer');
const load = require('./helpers/loadComponent.cjs');
const { createPreferencesStore } = require('../src/lib/preferencesStore.js');
global.IS_REACT_ACT_ENVIRONMENT = true;

test('native completion saves exactly the final draft, including membership and E85 choices', async () => {
    let saved;
    const store = createPreferencesStore({ getItem: async () => null, setItem: async (_, value) => { saved = value; } });
    await store.load();
    const initial = store.getSnapshot().preferences;
    let query, retries = 0, backs = 0;
    const Native = load('src/screens/onboarding/NativeOnboarding.js', {
        'expo-modules-core': { requireNativeViewManager: () => 'NativeFlow' },
        './useNativeOnboardingData': { __esModule: true, default: (coordinate, choices) => {
            query = { coordinate, choices }; return { data: {}, retry: () => retries++ };
        } },
    }).default;
    let view;
    await act(async () => { view = create(React.createElement(Native, {
        preferences: initial, visible: true, isDark: false, onBack: () => backs++,
        onComplete: choices => store.update({ ...choices, hasCompletedOnboarding: true }),
    })); });
    const send = event => act(async () => view.root.findByType('NativeFlow').props.onAction({ nativeEvent: event }));
    assert.equal(query.choices.searchRadiusMiles, 6, 'onboarding starts at six miles before requesting nearby choices');
    assert.equal(view.root.findByType('NativeFlow').props.initialChoices.searchRadiusMiles, 6);
    await send({ type: 'location', latitude: 27.98, longitude: -82.75 });
    assert.deepEqual(query.coordinate, { latitude: 27.98, longitude: -82.75 });
    const draft = { searchRadiusMiles: 12, preferredOctane: 'premium', requiresE85: true,
        preferredBrands: ['racetrac'], fuelMemberships: ['sams'] };
    await send({ type: 'choices', choices: draft });
    assert.deepEqual(query.choices, draft);
    assert.equal(store.getSnapshot().preferences.hasCompletedOnboarding, false);
    await send({ type: 'back' });
    await send({ type: 'retry' });
    assert.equal(backs, 1); assert.equal(retries, 1);
    await send({ type: 'complete', choices: draft });
    const result = JSON.parse(saved);
    for (const [key, value] of Object.entries(draft)) assert.deepEqual(result[key], value);
    assert.equal(result.hasCompletedOnboarding, true);
    await act(async () => view.unmount());
});

test('onboarding prefetch uses max radius; radius changes reuse inventory and filter brands locally', async () => {
    const requests = [];
    const quotes = [
        { stationId: 'a', stationName: 'Near', latitude: 28, longitude: -82, price: 3, fuelType: 'regular', allPrices: { regular: 3 } },
        { stationId: 'b', stationName: 'Far', latitude: 28.12, longitude: -82, price: 3, fuelType: 'regular', allPrices: { regular: 3 } },
    ];
    const hook = load('src/screens/onboarding/useNativeOnboardingData.js', {
        '../../components/brands/useNearbyBrands': { __esModule: true, default: args => {
            requests.push(args); return { quotes, loading: false, retry() {} };
        } },
        '../../components/memberships/useMembershipOptions': { __esModule: true, default: () => ({ ids: ['sams'], retry() {} }) },
    }).default;
    let output;
    function Harness({ radius }) {
        output = hook({ latitude: 28, longitude: -82 }, { searchRadiusMiles: radius, preferredOctane: 'regular', fuelMemberships: [] });
        return null;
    }
    let view;
    await act(async () => { view = create(React.createElement(Harness, { radius: 5 })); });
    assert.deepEqual(output.data.brands.map(b => b.label), ['Near']);
    assert.deepEqual(output.data.memberships.map(b => b.id), ['sams']);
    assert.equal(output.data.stations.length, 2);
    assert.ok(output.data.stations.every(s => !('price' in s)));
    await act(async () => view.update(React.createElement(Harness, { radius: 15 })));
    assert.equal(output.data.brands.length, 2);
    assert.ok(requests.every(r => r.radiusMiles === 15 && r.isActive));
    await act(async () => view.unmount());
});

test('membership prefetch recovers a transient location lookup and uses the normalized state', async () => {
    let calls = 0, receivedState;
    const hook = load('src/components/memberships/useMembershipOptions.js', {
        'expo-location': { reverseGeocodeAsync: async () => {
            if (++calls === 1) throw new Error('Temporary geocoder failure');
            return [{ isoCountryCode: 'US', region: 'Florida' }];
        } },
        '../../lib/supabase': { supabase: { rpc: async (_, params) => {
            receivedState = params.p_state; return { data: ['sams', 'costco'] };
        } } },
    }).default;
    let result;
    function Harness() { result = hook({ latitude: 28, longitude: -82 }, true); return null; }
    let view;
    await act(async () => { view = create(React.createElement(Harness)); });
    assert.equal(result.loading, true);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1100)); });
    assert.equal(calls, 2);
    assert.equal(receivedState, 'FL');
    assert.deepEqual(result.ids, ['sams', 'costco']);
    assert.equal(result.loading, false);
    await act(async () => view.unmount());
});
