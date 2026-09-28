const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { act, create } = require('react-test-renderer');
const load = require('./helpers/loadComponent.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

async function setup() {
    const read = deferred(); const review = deferred(); const alerts = [];
    let form; let sheet; let foreground; let reviewCalls = 0; const updates = [];
    const Screen = load('app/(tabs)/settings.js', {
        'react-native': { View: 'View', StyleSheet: { create: value => value }, Alert: { alert: (...args) => alerts.push(args) },
            AppState: { addEventListener: (_, callback) => { foreground = callback; return { remove() {} }; } } },
        'expo-haptics': { impactAsync: async () => {}, selectionAsync: async () => {}, ImpactFeedbackStyle: { Light: 1, Medium: 2 } },
        'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
        '../../src/AppStateContext': { useAppState: () => ({ requestFuelReset() {}, setFuelDebugState() {} }) },
        '../../src/PreferencesContext': { usePreferences: () => ({ preferences: { preferredBrands: ['shell'], requiresE85: false }, updatePreference: (...args) => updates.push(args), resetOnboarding() {} }) },
        '../../src/ThemeContext': { useTheme: () => ({ isDark: false, themeMode: 'light', setThemeMode() {}, themeColors: {} }) },
        '../../src/services/fuel': { clearFuelPriceCache: async () => {} },
        '../../src/services/fuel/trends': { clearTrendDataCache() {} },
        '../../src/components/TopCanopy': () => null,
        '../../src/components/FuelUpHeaderLogo': () => null,
        '../../src/components/settings/BrandPreferencesSheet': props => { sheet = props; return null; },
        '../../src/components/settings/NativeSettingsForm': props => { form = props; return null; },
        '../../src/lib/predictiveTrackingAccess': { getPredictiveTrackingPermissionStateAsync: () => read.promise,
            enablePredictiveTrackingAsync: () => { reviewCalls++; return review.promise; }, openPredictiveTrackingSettingsAsync: async () => {} },
    }).default;
    let renderer; await act(async () => { renderer = create(React.createElement(Screen)); });
    return { read, review, alerts, foreground, updates, get sheet() { return sheet; }, get form() { return form; }, get reviewCalls() { return reviewCalls; },
        unmount: async () => act(async () => renderer.unmount()) };
}

test('slow background permission read cannot overwrite the completed explicit setup', async () => {
    const state = await setup();
    await act(async () => { void state.form.onReviewTracking(); state.foreground('active'); });
    await act(async () => state.review.resolve({ isReady: true }));
    await act(async () => state.read.resolve({ isReady: false }));
    assert.equal(state.form.trackingReady, true);
    assert.equal(state.alerts.length, 1);
    await state.unmount();
});

test('repeated permission taps share one native setup flow', async () => {
    const state = await setup();
    await act(async () => { void state.form.onReviewTracking(); void state.form.onReviewTracking(); });
    assert.equal(state.reviewCalls, 1);
    await act(async () => state.review.resolve({ isReady: true }));
    assert.equal(state.alerts.length, 1);
    await state.unmount();
});

test('permission completion after leaving Settings cannot display an orphan alert', async () => {
    const state = await setup();
    await act(async () => { void state.form.onReviewTracking(); });
    await state.unmount();
    await act(async () => { state.review.resolve({ isReady: true }); state.read.resolve({ isReady: false }); });
    assert.deepEqual(state.alerts, []);
});

 test('Settings persists E85 and multiple brand choices through the native controls', async () => {
    const state = await setup();
    assert.equal(state.sheet.visible, false);
    assert.deepEqual(state.form.preferredBrands, ['shell']);
    await act(async () => { state.form.onRequiresE85Change(true); state.form.onEditPreferredBrands(); });
    assert.equal(state.sheet.visible, true);
    await act(async () => { state.sheet.onChange(['shell', 'costco']); state.sheet.onClose(); });
    assert.deepEqual(state.updates, [['requiresE85', true], ['preferredBrands', ['shell', 'costco']]]);
    assert.equal(state.sheet.visible, false);
    await state.unmount();
});
