const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { act, create } = require('react-test-renderer');
const load = require('./helpers/loadComponent.cjs');
const { createPreferencesStore } = require('../src/lib/preferencesStore.js');
global.IS_REACT_ACT_ENVIRONMENT = true;

async function setup({ requestLocation } = {}) {
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
        withTiming: v => v, withDelay: (_, v) => v, cancelAnimation: () => {}, runOnJS: fn => fn,
        Easing: { out: v => v, exp: v => v, back: () => v => v },
    };
    const mocks = {
        'react-native': {
            View: 'View', Text: 'Text', Image: 'Image', Pressable: 'Pressable', ScrollView,
            Platform: { OS: 'ios' }, useWindowDimensions: () => ({ width: 440, height: 956, fontScale: 1 }),
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
            enablePredictiveTrackingAsync: async () => { calls.location++; return requestLocation ? requestLocation() : tracking; },
            openPredictiveTrackingSettingsAsync: async () => {},
        },
    };
    mocks['../../../modules/fuel-up-glass'] = { GlassForm: 'Form', GlassSection: 'Section' };
    mocks['../../components/native/NativeGlassContainer'] = { __esModule: true, default: 'NativeGlassContainer' };
    mocks['@expo/ui/swift-ui'] = { Host: 'Host', Form: 'Form', Picker: 'NativePicker', Section: 'Section', Text: 'NativeText', Toggle: 'NativeToggle', Button: 'NativeButton', HStack: 'HStack', VStack: 'VStack', Image: 'NativeImage', Spacer: 'Spacer', Slider: 'Slider' };
    mocks['@expo/ui/swift-ui/modifiers'] = Object.fromEntries(['pickerStyle', 'tag', 'accessibilityLabel', 'accessibilityHint', 'accessibilityValue', 'buttonStyle', 'controlSize', 'disabled', 'font', 'foregroundStyle', 'frame', 'tint', 'fixedSize', 'padding', 'glassEffect'].map(name => [name, value => ({ [name]: value })]));
    mocks['../components/native/GlassActionButton'] = load('src/components/native/GlassActionButton.js', mocks);
    mocks['./RadiusControl'] = load('src/screens/onboarding/RadiusControl.js', mocks);
    mocks['./ExamplePricePill'] = { __esModule: true, default: () => null };
    mocks['./LiveActivityPreview'] = { __esModule: true, default: () => null };
    mocks['./presentation.js'] = load('src/screens/onboarding/presentation.js', mocks);
    mocks['./locationCopy.js'] = load('src/screens/onboarding/locationCopy.js', mocks);
    for (const name of ['TopCanopy', 'BottomCanopy', 'FuelUpHeaderLogo']) {
        mocks[`../../components/${name}`] = mocks[`../components/${name}`];
    }
    for (const name of ['WelcomeStep', 'LocationStep', 'NotificationStep', 'presentation', 'locationCopy']) {
        mocks[`./onboarding/${name}.js`] = load(`src/screens/onboarding/${name}.js`, mocks);
    }
    mocks['./onboarding/FuelGradeStep'] = load('src/screens/onboarding/FuelGradeStep.js', mocks);
    mocks['./onboarding/RadiusStep'] = load('src/screens/onboarding/RadiusStep.js', mocks);
    mocks['./onboarding/BrandStep'] = { __esModule: true, default: props => React.createElement('BrandStep', props) };
    mocks['./onboarding/useOnboardingLocation'] = { __esModule: true, default: () => null };
    const Component = load('src/screens/OnboardingScreen.js', mocks).default;
    let renderer;
    await act(async () => { renderer = create(React.createElement(Component)); });
    return {
        renderer, store, scrolls, saved: () => JSON.parse(saved), calls, permissions, tracking, subscriptions,
        swipe: async step => act(async () => renderer.root.findByProps({ testID: 'onboarding-pages' }).props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: step * 440 } } })),
        continue: async () => act(async () => renderer.root.findByType('NativeButton').props.onPress()),
        dispose: async () => act(async () => renderer.unmount()),
    };
}

for (const grade of ['Regular', 'Midgrade', 'Premium', 'Diesel', 'E85']) {
    test(`onboarding swipes then Get Started save the actual ${grade} selection`, async () => {
        const app = await setup();
        await act(async () => {
            app.renderer.root.findByType('Slider').props.onValueChange(7);
            app.renderer.root.findByType('NativePicker').props.onSelectionChange(grade.toLowerCase());
        });
        await app.swipe(6);
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
        const button = app.renderer.root.findByType('NativeButton');
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
    assert.equal(slider.props.min, 2);
    assert.equal(slider.props.max, 15);
    await app.dispose();
});


test('a location permission request finishing after leaving onboarding cannot schedule navigation', async t => {
    let finish;
    const app = await setup({ requestLocation: () => new Promise(resolve => { finish = resolve; }) });
    await app.swipe(2);
    await app.continue();
    await app.dispose();
    const timer = t.mock.method(global, 'setTimeout');
    await act(async () => finish({ isReady: true }));
    assert.equal(timer.mock.callCount(), 0);
    assert.equal(app.calls.alerts.length, 0);
});

test('a location permission request failing after leaving onboarding cannot show a stale alert', async () => {
    let fail;
    const app = await setup({ requestLocation: () => new Promise((_, reject) => { fail = reject; }) });
    await app.swipe(2);
    await app.continue();
    await app.dispose();
    await act(async () => fail(new Error('permission service unavailable')));
    assert.equal(app.calls.alerts.length, 0);
});


test('Get Started saves E85 availability and preferred brands atomically with fuel and radius', async () => {
    const app = await setup();
    await act(async () => {
        app.renderer.root.findByType('Slider').props.onValueChange(12);
        app.renderer.root.findByType('NativePicker').props.onSelectionChange('premium');
        app.renderer.root.findByType('NativeToggle').props.onIsOnChange(true);
        app.renderer.root.findByType('BrandStep').props.onChange(['wawa', 'shell']);
        app.renderer.root.findByType('BrandStep').props.onMembershipsChange(['sams']);
    });
    await app.swipe(6);
    await app.continue();
    assert.equal(app.saved().preferredOctane, 'premium');
    assert.equal(app.saved().searchRadiusMiles, 12);
    assert.equal(app.saved().requiresE85, true);
    assert.deepEqual(app.saved().preferredBrands, ['shell', 'wawa']);
    assert.deepEqual(app.saved().fuelMemberships, ['sams']);
    assert.equal(app.saved().hasCompletedOnboarding, true);
    await app.dispose();
});


for (const step of [2, 3]) {
    test(`Not Now advances permission page ${step} without requesting access`, async () => {
        const app = await setup();
        await app.swipe(step);
        const skip = app.renderer.root.findByProps({ testID: 'onboarding-permission-skip' });
        assert.equal(skip.props.accessibilityRole, 'button');
        assert.equal(skip.props.disabled, false);
        assert.equal(skip.props.style.minHeight, 44);
        await act(async () => skip.props.onPress());
        assert.deepEqual(app.scrolls.at(-1), { x: (step + 1) * 440, animated: true });
        assert.equal(app.calls.location, 0);
        assert.equal(app.calls.notifications, 0);
        assert.equal(app.store.getSnapshot().preferences.hasCompletedOnboarding, false);
        await app.dispose();
    });
}

test('Not Now remains disabled during the native permission request and preserves successful delayed advance', async t => {
    let finish;
    const app = await setup({ requestLocation: () => new Promise(resolve => { finish = resolve; }) });
    await app.swipe(2);
    await app.continue();
    const skip = app.renderer.root.findByProps({ testID: 'onboarding-permission-skip' });
    assert.equal(skip.props.disabled, true);
    await act(async () => skip.props.onPress());
    assert.equal(app.scrolls.length, 0);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await act(async () => finish({ isReady: true }));
    assert.equal(app.renderer.root.findAllByProps({ testID: 'onboarding-permission-skip' }).length, 0);
    await act(async () => t.mock.timers.tick(599));
    assert.equal(app.scrolls.length, 0);
    await act(async () => t.mock.timers.tick(1));
    assert.deepEqual(app.scrolls, [{ x: 3 * 440, animated: true }]);
    await app.dispose();
});
