const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { create, act } = require('react-test-renderer');
const load = require('./helpers/loadComponent.cjs');
const { buildLabStations } = require('../src/screens/cluster-lab/stationCardModel.js');
const continuity = require('../src/screens/cluster-lab/stationContinuity.js');
global.IS_REACT_ACT_ENVIRONMENT = true;
const pending = () => new Promise(() => {});
const tick = () => new Promise(setImmediate);
const origin = { latitude: 27.95, longitude: -82.45, locationSource: 'device' };
const quote = (id, overrides = {}) => ({ stationId: id, providerTier: 'station', fuelType: 'regular',
    latitude: origin.latitude, longitude: origin.longitude, distanceMiles: 99, price: 3.1,
    updatedAt: new Date().toISOString(), ...overrides });

async function mount(t, { cache, refresh = pending, preferences = {} } = {}) {
    let context = { resolvedFuelSearchContext: origin, fuelResetToken: 0 };
    let prefs = { preferredOctane: 'regular', searchRadiusMiles: 5, ...preferences };
    let value, root, cacheCalls = 0, refreshCalls = 0, active = true, foreground;
    const renders = [];
    const hook = load('src/screens/cluster-lab/useClusterLabStations.js', {
        react: React,
        '../../lib/onboardingHandoff': { onboardingHandoff: { getSnapshot: () => 'idle' } },
        '../../lib/useNetworkStatus': { __esModule: true, default: () => ({ connected: true }) },
        '../../AppStateContext': { useAppState: () => context },
        '../../PreferencesContext': { usePreferences: () => ({ preferences: prefs, fuelSearchCriteriaSignature: JSON.stringify(prefs) }) },
        'react-native': { AppState: { currentState: 'active', addEventListener: (_, listener) => { foreground = listener; return { remove() { foreground = null; } }; } } },
        'expo-location': {},
        '../../lib/deviceLocationCache': {},
        '../../lib/fuelSearchState': {},
        '../../services/fuel': {
            getCachedFuelPriceSnapshot: query => cache(query, ++cacheCalls),
            refreshFuelPriceSnapshot: query => refresh(query, ++refreshCalls),
        },
        './stationCardModel': { buildLabStations },
        './stationContinuity': continuity,
    }).default;
    function Probe() { value = hook(active); renders.push(value); return null; }
    await act(async () => { root = create(React.createElement(Probe)); await tick(); });
    t.after(async () => { await act(async () => root.unmount()); });
    return { renders, get value() { return value; }, get refreshCalls() { return refreshCalls; },
        async foreground() { await act(async () => { foreground('active'); await tick(); }); },
        async setActive(next) { active = next; await act(async () => { root.update(React.createElement(Probe)); await tick(); }); },
        async update(changes = {}, preferenceChanges) {
            context = { ...context, ...changes };
            if (preferenceChanges) prefs = { ...prefs, ...preferenceChanges };
            await act(async () => { root.update(React.createElement(Probe)); await tick(); });
        } };
}

test('GPS movement retains IDs and rebases raw quotes while next cache read is unresolved', async t => {
    const raw = quote('kept');
    const app = await mount(t, { cache: (_, count) => count === 1 ? Promise.resolve({ topStations: [raw] }) : pending() });
    assert.equal(app.value.loaded, true);
    assert.equal(app.value.stations[0].distanceMiles, 0);
    const firstMovementRender = app.renders.length;
    for (const delta of [0.001, 0.002, 0.003]) {
        const moved = { ...origin, latitude: origin.latitude + delta };
        await app.update({ resolvedFuelSearchContext: moved });
        assert.equal(app.value.loaded, true);
        assert.deepEqual(app.value.stations.map(s => s.id), ['kept']);
        assert(app.value.stations[0].distanceMiles > 0);
        assert.equal(app.value.origin.latitude, moved.latitude);
    }
    assert(app.renders.slice(firstMovementRender).every(render => render.loaded && render.stations.length === 1),
        'not even the first render of a location change may blank the map or unmount cards');
    assert.equal(raw.distanceMiles, 99, 'raw archived price and distance metadata are immutable');
    assert.equal(raw.price, 3.1);
    await app.update({ resolvedFuelSearchContext: { ...origin, latitude: origin.latitude + 1 } });
    assert.deepEqual(app.value.stations, [], 'retention still enforces the current radius');
});

test('a superseded request cannot replace the latest moving-origin snapshot', async t => {
    let finishOld, finishNew;
    const app = await mount(t, { cache: async (_, count) => count === 1 ? { topStations: [quote('cached')] } : null,
        refresh: (_, count) => new Promise(resolve => { if (count === 1) finishOld = resolve; else finishNew = resolve; }) });
    const moved = { ...origin, latitude: origin.latitude + 0.002 };
    await app.update({ resolvedFuelSearchContext: moved });
    await act(async () => { finishNew({ snapshot: { topStations: [quote('new')] } }); await tick(); });
    await act(async () => { finishOld({ snapshot: { topStations: [quote('obsolete')] } }); await tick(); });
    assert.deepEqual(app.value.stations.map(s => s.id), ['new']);
    assert.equal(app.value.origin.latitude, moved.latitude);
});

for (const change of ['criteria', 'reset', 'manual']) {
    test(`${change} invalidates prior content immediately and cannot resurrect it on return`, async t => {
        const app = await mount(t, { cache: (_, count) => count === 1 ? Promise.resolve({ topStations: [quote('old')] }) : pending() });
        if (change === 'criteria') await app.update({}, { preferredOctane: 'premium' });
        if (change === 'reset') await app.update({ fuelResetToken: 1 });
        if (change === 'manual') await app.update({ manualLocationOverride: { latitude: origin.latitude, longitude: origin.longitude } });
        assert.equal(app.value.loaded, false);
        assert.deepEqual(app.value.stations, []);
        await app.update({ fuelResetToken: 0, manualLocationOverride: null }, { preferredOctane: 'regular' });
        assert.deepEqual(app.value.stations, []);
    });
}

test('retained quotes expire while moving and the new cache read never finishes', async t => {
    const now = Date.parse('2026-11-14T12:00:00Z');
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now });
    const raw = quote('expiring', { updatedAt: new Date(now - 86400000 + 1000).toISOString() });
    const app = await mount(t, { cache: (_, count) => count === 1 ? Promise.resolve({ topStations: [raw] }) : pending() });
    await app.update({ resolvedFuelSearchContext: { ...origin, latitude: origin.latitude + 0.002 } });
    assert.equal(app.value.stations.length, 1);
    await act(async () => { t.mock.timers.tick(1001); });
    assert.deepEqual(app.value.stations, []);
    assert.equal(app.refreshCalls, 1, 'expiry is local and never collects prices');
});

test('movement retains additive E85 while primary refresh finishes and secondary fails', async t => {
    let moved = false;
    const primary = { topStations: [quote('regular', { offersE85: true })] };
    const ethanol = { topStations: [quote('regular', { fuelType: 'e85', offersE85: true, price: 2.3 })] };
    const app = await mount(t, { preferences: { requiresE85: true },
        cache: async query => moved ? null : query.fuelType === 'e85' ? ethanol : primary,
        refresh: query => !moved ? pending() : query.fuelType === 'e85' ? Promise.reject(new Error('offline')) : Promise.resolve({ snapshot: primary }) });
    assert.equal(app.value.stations[0].dualPrices.e85Price, '$2.30');
    moved = true;
    await app.update({ resolvedFuelSearchContext: { ...origin, latitude: origin.latitude + 0.002 } });
    assert.equal(app.value.stations[0].dualPrices.e85Price, '$2.30');
    assert.equal(app.value.stations[0].price, 3.1);
});


test('foreground refresh uses the latest committed E85 snapshot from the same search', async t => {
    let second = false;
    const primary = { topStations: [quote('dual', { offersE85: true })] };
    const cachedE85 = { topStations: [quote('dual', { fuelType: 'e85', offersE85: true, price: 2.3 })] };
    const freshE85 = { topStations: [quote('dual', { fuelType: 'e85', offersE85: true, price: 2.5 })] };
    const app = await mount(t, { preferences: { requiresE85: true },
        cache: async query => second ? null : query.fuelType === 'e85' ? cachedE85 : primary,
        refresh: query => query.fuelType !== 'e85' ? Promise.resolve({ snapshot: primary }) :
            second ? Promise.reject(new Error('offline')) : Promise.resolve({ snapshot: freshE85 }) });
    assert.equal(app.value.stations[0].dualPrices.e85Price, '$2.50');
    second = true;
    await app.foreground();
    assert.equal(app.value.stations[0].dualPrices.e85Price, '$2.50', 'must not revert to effect-start cache or null');
});

test('refocusing Home removes expired retained prices before a hanging cache refresh', async t => {
    const now = Date.parse('2026-11-14T12:00:00Z');
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now });
    const app = await mount(t, { cache: (_, count) => count === 1 ? Promise.resolve({ topStations: [quote('expires-away',
        { updatedAt: new Date(now - 86400000 + 1000).toISOString() })] }) : pending() });
    await app.setActive(false);
    await act(async () => { t.mock.timers.tick(1001); });
    const returnRender = app.renders.length;
    await app.setActive(true);
    assert(app.renders.slice(returnRender).every(render => render.stations.length === 0));
    assert.equal(app.refreshCalls, 1);
});
