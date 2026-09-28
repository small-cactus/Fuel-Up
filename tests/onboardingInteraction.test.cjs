const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { act, create } = require('react-test-renderer');
const load = require('./helpers/loadComponent.cjs');
const { createPreferencesStore } = require('../src/lib/preferencesStore.js');
global.IS_REACT_ACT_ENVIRONMENT = true;

async function setup() {
    let saved;
    const store = createPreferencesStore({ getItem: async () => saved, setItem: async (_, value) => { saved = value; } });
    await store.load();
    const scrolls = [];
    const subscriptions = new Set();
    const permissions = { status: 'undetermined' };
    const tracking = { isReady: false };
    const calls = { notifications: 0, location: 0, alerts: [] };
    const insets = { top: 62, bottom: 34 };
    const theme = { isDark: false, themeColors: { text: '#000', background: '#fff' } };
    const ScrollView = React.forwardRef((props, ref) => {
        React.useImperativeHandle(ref, () => ({ scrollTo: value => scrolls.push(value) }));
        return React.createElement('ScrollView', props);
    });
    const animated = {
        __esModule: true,
        default: { View: 'AnimatedView', createAnimatedComponent: c => c },
        useSharedValue: initial => React.useRef({ value: initial }).current,
        useAnimatedStyle: () => ({}), useAnimatedProps: () => ({}),
        withTiming: v => v, withDelay: (_, v) => v, runOnJS: fn => fn,
        Easing: { out: v => v, exp: v => v, back: () => v => v },
    };
    const Component = load('src/screens/OnboardingScreen.js', {
        'react-native': {
            View: 'View', Text: 'Text', Image: 'Image', Pressable: 'Pressable', ScrollView,
            StyleSheet: { create: x => x, absoluteFill: {} }, Dimensions: { get: () => ({ width: 440, height: 956 }) },
            Alert: { alert: (...args) => calls.alerts.push(args) },
            AppState: { addEventListener: (_, listener) => { subscriptions.add(listener); return { remove: () => subscriptions.delete(listener) }; } },
        },
        'react-native-reanimated': animated,
        'react-native-maps': { __esModule: true, default: 'MapView', Circle: 'Circle', Marker: 'Marker' },
        '@callstack/liquid-glass': { LiquidGlassView: 'GlassView' },
        'expo-symbols': { SymbolView: 'SymbolView' },
        'expo-linear-gradient': { LinearGradient: 'LinearGradient' },
        'expo-blur': { BlurView: 'BlurView' },
        'expo-haptics': { ImpactFeedbackStyle: { Medium: 'medium' }, impactAsync: async () => {} },
        'expo-notifications': { getPermissionsAsync: async () => permissions },
        'react-native-safe-area-context': { useSafeAreaInsets: () => insets },
        '@react-native-community/slider': { __esModule: true, default: 'Slider' },
        '../ThemeContext': { useTheme: () => theme },
        '../PreferencesContext': { usePreferences: () => {
            const { preferences } = React.useSyncExternalStore(store.subscribe, store.getSnapshot);
            return { preferences, updatePreference: (key, value) => store.update({ [key]: value }),
                completeOnboarding: choices => store.update({ ...choices, hasCompletedOnboarding: true }) };
        } },
        '../components/TopCanopy': { __esModule: true, default: () => null },
        '../components/BottomCanopy': { __esModule: true, default: () => null },
        '../components/FuelUpHeaderLogo': { __esModule: true, default: () => null },
        './onboarding/predictive/PredictiveFuelingStep': { __esModule: true, default: () => null },
        '../lib/notifications': {
            registerForPushNotificationsAsync: async () => { calls.notifications++; return null; },
            savePushTokenToSupabase: async () => {},
        },
        '../lib/predictiveTrackingAccess': {
            getPredictiveTrackingPermissionStateAsync: async () => tracking,
            enablePredictiveTrackingAsync: async () => { calls.location++; return tracking; },
            openPredictiveTrackingSettingsAsync: async () => {},
        },
    }).default;
    let renderer;
    await act(async () => { renderer = create(React.createElement(Component)); });
    return {
        renderer, store, saved: () => JSON.parse(saved), calls, permissions, tracking, subscriptions,
        swipe: async step => act(async () => renderer.root.findByType('ScrollView').props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: step * 440 } } })),
        continue: async () => act(async () => renderer.root.findAllByType('Pressable').find(n => n.props.accessibilityRole === 'button').props.onPress()),
        dispose: async () => act(async () => renderer.unmount()),
    };
}

for (const grade of ['Regular', 'Midgrade', 'Premium', 'Diesel']) {
    test(`onboarding swipes then Get Started save the actual ${grade} selection`, async () => {
        const app = await setup();
        await act(async () => {
            app.renderer.root.findByType('Slider').props.onValueChange(7);
            app.renderer.root.findAllByType('Pressable').find(n => n.props.accessibilityLabel === grade).props.onPress();
        });
        await app.swipe(5);
        await app.continue();
        assert.equal(app.saved().preferredOctane, grade.toLowerCase());
        assert.equal(app.saved().searchRadiusMiles, 7);
        assert.equal(app.saved().hasCompletedOnboarding, true);
        await app.dispose();
    });
}

test('permission refresh on return from Settings and duplicate taps do not create parallel requests', async () => {
    const app = await setup();
    await app.swipe(3);
    await act(async () => {
        const button = app.renderer.root.findAllByType('Pressable').find(n => n.props.accessibilityRole === 'button');
        button.props.onPress(); button.props.onPress();
    });
    assert.equal(app.calls.notifications, 1);
    app.tracking.isReady = true;
    app.permissions.status = 'granted';
    await act(async () => { app.subscriptions.forEach(listener => listener('active')); });
    await app.swipe(2);
    await app.continue();
    assert.equal(app.calls.location, 0);
    await app.dispose();
    assert.equal(app.subscriptions.size, 0);
});

test('onboarding radius uses the same range as the saved preferences', async () => {
    const app = await setup();
    const slider = app.renderer.root.findByType('Slider');
    assert.equal(slider.props.minimumValue, 2);
    assert.equal(slider.props.maximumValue, 15);
    await app.dispose();
});
