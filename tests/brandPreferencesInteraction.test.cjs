const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { act, create } = require('react-test-renderer');
const load = require('./helpers/loadComponent.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

test('brand requests use real coordinates and discard results after radius/grade changes or unmount', async () => {
    const requests = [];
    const hook = load('src/components/brands/useNearbyBrands.js', {
        '../../services/fuel': {
            getCachedFuelPriceSnapshot: async () => null,
            refreshFuelPriceSnapshot: query => { const pending = deferred(); requests.push({ query, ...pending }); return pending.promise; },
        },
        '../../lib/stationPreferences': { buildStationBrandOptions: quotes => quotes },
    }).default;
    let latest;
    function Harness(props) { latest = hook(props); return null; }
    let renderer;
    const props = { coordinate: { latitude: 28, longitude: -82 }, radiusMiles: 5, fuelGrade: 'regular', isActive: false };
    await act(async () => { renderer = create(React.createElement(Harness, props)); });
    assert.equal(requests.length, 0);
    await act(async () => renderer.update(React.createElement(Harness, { ...props, isActive: true })));
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].query, { latitude: 28, longitude: -82, radiusMiles: 5, fuelType: 'regular', preferredProvider: 'gasbuddy', requiresE85: false });
    await act(async () => renderer.update(React.createElement(Harness, { ...props, isActive: true, fuelGrade: 'premium', radiusMiles: 10 })));
    await act(async () => requests[1].resolve({ snapshot: { topStations: [{ id: 'new' }] } }));
    await act(async () => requests[0].resolve({ snapshot: { topStations: [{ id: 'stale' }] } }));
    assert.deepEqual(latest.options, [{ id: 'new' }]);
    await act(async () => renderer.update(React.createElement(Harness, { ...props, isActive: true, fuelGrade: 'premium', radiusMiles: 10, requiresE85: true })));
    assert.equal(requests.length, 3);
    assert.equal(requests[2].query.requiresE85, true);
    assert.equal(requests[2].query.fuelType, 'premium');
    assert.deepEqual(latest.options, [], 'regular station cache must not stand in for E85 discovery');
    await act(async () => requests[2].resolve({ snapshot: { topStations: [{ id: 'e85' }] } }));
    assert.deepEqual(latest.options, [{ id: 'e85' }]);
    await act(async () => latest.retry());
    assert.equal(latest.loading, true);
    await act(async () => renderer.unmount());
    await act(async () => requests[3].resolve({ snapshot: { topStations: [{ id: 'unmounted' }] } }));
    assert.deepEqual(latest.options, [{ id: 'e85' }]);
});

test('brand requests expose unavailable location, empty results, and retryable failure', async () => {
    let calls = 0, latest;
    const hook = load('src/components/brands/useNearbyBrands.js', {
        '../../services/fuel': {
            getCachedFuelPriceSnapshot: async () => null,
            refreshFuelPriceSnapshot: async () => { if (++calls === 1) throw new Error('offline'); return { snapshot: { topStations: [] } }; },
        },
        '../../lib/stationPreferences': { buildStationBrandOptions: quotes => quotes },
    }).default;
    function Harness(props) { latest = hook(props); return null; }
    let renderer;
    await act(async () => { renderer = create(React.createElement(Harness, { coordinate: null })); });
    assert.equal(latest.hasLocation, false); assert.equal(calls, 0);
    await act(async () => renderer.update(React.createElement(Harness, { coordinate: { latitude: 28, longitude: -82 }, radiusMiles: 5, fuelGrade: 'regular' })));
    assert.match(latest.error, /try again/);
    await act(async () => latest.retry());
    assert.equal(latest.error, null); assert.equal(latest.loading, false); assert.deepEqual(latest.options, []);
    await act(async () => renderer.unmount());
});

test('native brand toggles preserve rapid selections, and local search does not replace selection', async () => {
    const changes = [];
    const Component = load('src/components/BrandPreferences.js', {
        'react-native': { View: 'View', TextInput: 'TextInput', StyleSheet: { create: x => x } },
        '@expo/ui/swift-ui': { Button: 'Button', Form: 'Form', Host: 'Host', ProgressView: 'ProgressView', Section: 'Section', Text: 'Text', Toggle: 'Toggle' },
        '../lib/fuelGrade': { getFuelGradeMeta: () => ({ label: 'Regular' }) },
        './brands/useNearbyBrands': { __esModule: true, default: () => ({ options: [{ id: 'shell', label: 'Shell', count: 4 }, { id: 'wawa', label: 'Wawa', count: 2 }], hasLocation: true, loading: false, retry() {} }) },
    }).default;
    let renderer;
    await act(async () => { renderer = create(React.createElement(Component, { themeColors: {}, selectedBrands: [], onChange: next => changes.push(next), radiusMiles: 5, fuelGrade: 'regular' })); });
    await act(async () => {
        const rows = renderer.root.findAllByType('Toggle');
        rows[0].props.onIsOnChange(true); rows[1].props.onIsOnChange(true);
    });
    assert.deepEqual(changes.at(-1), ['shell', 'wawa']);
    await act(async () => renderer.root.findByType('Button').props.onPress());
    await act(async () => renderer.root.findByType('TextInput').props.onChangeText('waw'));
    assert.equal(renderer.root.findAllByType('Toggle').length, 1);
    assert.equal(renderer.root.findByType('Toggle').props.testID, 'brand-preference-wawa');
    assert.equal(changes.length, 2);
    await act(async () => renderer.unmount());
});
