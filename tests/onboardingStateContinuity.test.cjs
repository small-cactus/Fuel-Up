const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { act, create } = require('react-test-renderer');
const load = require('./helpers/loadComponent.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;

test('a delayed cached location cannot replace a fresh fix or restart the radius camera', async () => {
    let resolveCached, accept, latest;
    const hook = load('src/screens/onboarding/useOnboardingLocation.js', { 'expo-location': {
        Accuracy: { Balanced: 3 },
        getLastKnownPositionAsync: () => new Promise(resolve => { resolveCached = resolve; }),
        watchPositionAsync: async (_, callback) => { accept = callback; return { remove() {} }; },
    } }).default;
    function Harness() { latest = hook({ foregroundGranted: true }); return null; }
    let renderer;
    await act(async () => { renderer = create(React.createElement(Harness)); });
    try {
        await act(async () => accept({ timestamp: 2000, coords: { latitude: 28, longitude: -82.4 } }));
        const fresh = latest;
        await act(async () => resolveCached({ timestamp: 1000, coords: { latitude: 27.95, longitude: -82.45 } }));
        assert.strictEqual(latest, fresh, 'cached fix must not rewind map');
        await act(async () => accept({ timestamp: 3000, coords: { latitude: 28, longitude: -82.4 } }));
        assert.strictEqual(latest, fresh, 'same coordinate must preserve identity');
        await act(async () => accept({ timestamp: 2500, coords: { latitude: 27, longitude: -81 } }));
        assert.strictEqual(latest, fresh, 'older watch sample must not rewind map');
    } finally { await act(async () => renderer.unmount()); }
});

test('designer accepts an unfinished decimal without replacing typed text', async () => {
    const Designer = load('app/live-activity-designer.js', {
        'react-native': { Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', TextInput: 'TextInput', View: 'View', StyleSheet: { create: x => x, hairlineWidth: 1 } },
        'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
        '../src/ThemeContext': { useTheme: () => ({ isDark: false }) },
        '../src/lib/PriceDropActivityLivePreview': { BannerPreview: 'BannerPreview', DynamicIslandCompactPreview: 'CompactPreview', DynamicIslandExpandedPreview: 'ExpandedPreview' },
        '../src/lib/notifications': { endAllLiveActivities: async () => ({}), startPredictiveLiveActivity: async () => ({}), updateTrackedLiveActivity: () => true },
    }).default;
    let renderer;
    await act(async () => { renderer = create(React.createElement(Designer)); });
    const progress = () => renderer.root.findAllByType('TextInput').at(-1);
    try {
        await act(async () => progress().props.onFocus?.());
        await act(async () => progress().props.onChangeText('0.'));
        assert.equal(progress().props.value, '0.');
        await act(async () => progress().props.onChangeText('0.65'));
        assert.equal(renderer.root.findByType('BannerPreview').props.props.progress, 0.65);
        await act(async () => progress().props.onBlur?.());
        assert.equal(progress().props.value, '0.65');
        await act(async () => progress().props.onChangeText(''));
        assert.equal(progress().props.value, '');
    } finally { await act(async () => renderer.unmount()); }
});


test('the radius preview does not animate while its onboarding page is offscreen', async () => {
    const animations = [];
    const Map = React.forwardRef((props, ref) => {
        React.useImperativeHandle(ref, () => ({ animateToRegion: region => animations.push(region) }));
        return React.createElement('Map', props);
    });
    const RadiusStep = load('src/screens/onboarding/RadiusStep.js', {
        'react-native': { View: 'View', Text: 'Text', StyleSheet: { create: x => x } },
        'react-native-maps': { __esModule: true, default: Map, Circle: 'Circle' },
        '@react-native-community/slider': { __esModule: true, default: 'Slider' },
        '@callstack/liquid-glass': { LiquidGlassView: 'Glass' },
    }).default;
    const props = { insets: { top: 0, bottom: 0 }, themeColors: {}, width: 375,
        value: 5, onChange() {}, coordinate: { latitude: 28, longitude: -82 }, isActive: false };
    let renderer;
    await act(async () => { renderer = create(React.createElement(RadiusStep, props)); });
    try {
        assert.equal(animations.length, 0);
        props.coordinate = { latitude: 29, longitude: -82 };
        await act(async () => renderer.update(React.createElement(RadiusStep, props)));
        assert.equal(animations.length, 0);
        await act(async () => renderer.update(React.createElement(RadiusStep, { ...props, isActive: true })));
        assert.equal(animations.length, 1);
        assert.equal(animations[0].latitude, 29);
    } finally { await act(async () => renderer.unmount()); }
});
