const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { act, create } = require('react-test-renderer');
const load = require('./helpers/loadComponent.cjs');
const { SERVICES } = require('../src/lib/networkStatus');
global.IS_REACT_ACT_ENVIRONMENT = true;
const defaults = { connected: true, faultsEnabled: false, services: SERVICES.map(s => ({ ...s, status: 'unknown' })) };
const Overlay = load('src/components/ConnectionOverlay.js', {
    'react-native': { AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) }, ScrollView: 'ScrollView', Text: 'Text', View: 'View', StyleSheet: { absoluteFillObject: {}, absoluteFill: {}, create: s => s } },
    'expo-blur': { BlurView: 'BlurView' }, 'expo-symbols': { SymbolView: 'SymbolView' },
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
    assert.equal(view.root.findByType('BlurView').props.intensity, 100);
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
    await act(async () => view.unmount());
});
