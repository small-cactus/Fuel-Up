const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { act, create } = require('react-test-renderer');
const load = require('./helpers/loadComponent.cjs');
const { SERVICES } = require('../src/lib/networkStatus');
global.IS_REACT_ACT_ENVIRONMENT = true;
const defaults = { connected: true, services: SERVICES.map(s => ({ ...s, status: 'unknown' })) };
const Overlay = load('src/components/ConnectionOverlay.js', {
    'react-native': { AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) }, ScrollView: 'ScrollView', Text: 'Text', View: 'View', StyleSheet: { absoluteFillObject: {}, absoluteFill: {}, create: s => s } },
    './ConnectionBlur': { __esModule: true, default: 'ConnectionBlur' }, 'expo-glass-effect': { GlassView: 'GlassView' }, 'expo-symbols': { SymbolView: 'SymbolView' },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 62, bottom: 34 }) },
    '../ThemeContext': { useTheme: () => ({ isDark: false, themeColors: { text: '#000', textOpacity: '#666' } }) },
    '../lib/useNetworkStatus': { __esModule: true, default: () => defaults },
}).default;
test('reusable overlay hides for healthy/unknown services and inactive screens', async () => {
    let view;
    await act(async () => { view = create(React.createElement(Overlay)); });
    assert.equal(view.toJSON(), null);
    await act(async () => view.update(React.createElement(Overlay, { active: false, status: { ...defaults, connected: false } })));
    assert.equal(view.toJSON(), null); await act(async () => view.unmount());
});
test('offline copy does not claim a server outage or an automatic repair', async () => {
    let view;
    await act(async () => { view = create(React.createElement(Overlay, { status: { ...defaults, connected: false } })); });
    const text = JSON.stringify(view.toJSON());
    assert.match(text, /No internet connection/); assert.doesNotMatch(text, /fix is already|20 minutes|servers are/);
    assert.equal(view.root.findAllByType('ConnectionBlur').length, 1);
    assert.equal(view.root.findByType('SymbolView').props.name, 'wifi.slash');
    await act(async () => view.unmount());
});
test('server failure identifies failed and untested services separately', async () => {
    let view;
    const status = { ...defaults, services: defaults.services.map(s => ({ ...s, status: s.id === 'prices' ? 'unresponsive' : s.status })) };
    await act(async () => { view = create(React.createElement(Overlay, { status })); });
    const strings = view.root.findAllByType('Text').map(n => n.props.children);
    assert.equal(strings.filter(s => s === 'Not responding').length, 1);
    assert.equal(strings.filter(s => s === 'Not checked').length, SERVICES.length - 1);
    assert(strings.includes('Fuel Up servers are having an outage'));
    assert.equal(view.root.findAllByType('GlassView').length, 2);
    assert.doesNotMatch(JSON.stringify(view.toJSON()), /simulated|developer|fake/i);
    await act(async () => view.unmount());
});
test('a pending request never blurs; actual timeout mounts the blur and warning together', async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
    const { createNetworkStatus } = require('../src/lib/networkStatus');
    const store = createNetworkStatus();
    const request = store.fetch('https://example/functions/v1/gas-prices', {}, () => new Promise(() => {}));
    const rejected = assert.rejects(request, { name: 'TimeoutError' });
    let view;
    await act(async () => { view = create(React.createElement(Overlay, { status: store.getSnapshot() })); });
    assert.equal(view.toJSON(), null, 'no overlay at request start');
    for (const elapsed of [1000, 18999]) {
        await act(async () => {
            t.mock.timers.tick(elapsed);
            view.update(React.createElement(Overlay, { status: store.getSnapshot() }));
        });
        assert.equal(view.toJSON(), null, 'no overlay throughout the pending interval');
    }
    t.mock.timers.tick(1); await rejected;
    await act(async () => view.update(React.createElement(Overlay, { status: store.getSnapshot() })));
    assert.equal(view.root.findAllByType('ConnectionBlur').length, 1);
    assert.match(JSON.stringify(view.toJSON()), /Fuel Up servers are having an outage/);
    await store.fetch('https://example/functions/v1/gas-prices', {}, async () => ({ status: 200 }));
    await act(async () => view.update(React.createElement(Overlay, { status: store.getSnapshot() })));
    assert.equal(view.toJSON(), null, 'successful response removes blur and warning together');
    await act(async () => view.unmount());
});
