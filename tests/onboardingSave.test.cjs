const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { create, act } = require('react-test-renderer');
const load = require('./helpers/loadComponent.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;
const { createOnboardingHandoff } = load('src/lib/onboardingHandoff.js', {});

for (const failure of [null, 'storage', 'network', 'completion']) {
    test(`Save coordinates persisted choices, cached Home readiness and reveal (${failure || 'success'})`, async () => {
        const handoff = createOnboardingHandoff();
        const events = [];
        const Screen = load('src/screens/OnboardingScreen.js', {
            'react-native': { Platform: { OS: 'ios' } },
            '../AppStateContext': { useAppState: () => ({ setResolvedFuelSearchContext: v => events.push(['context', v]) }) },
            '../lib/deviceLocationCache': { persistLastDeviceLocationRegion: async () => { events.push(['location']); } },
            '../lib/onboardingHandoff': { onboardingHandoff: handoff },
            '../lib/launchReadiness': { finishLaunch() {} },
            '../ThemeContext': { useTheme: () => ({ isDark: false }) },
            '../PreferencesContext': { usePreferences: () => ({ preferences: {},
                updatePreferences: async (_, options) => {
                    assert.equal(options.requirePersistence, true);
                    if (failure === 'storage') throw Error('disk full');
                    events.push(['preferences']);
                },
                completeOnboarding: async () => { if (failure === 'completion') throw Error('disk full'); events.push(['completed']); },
            }) },
            './onboarding/NativeOnboarding': { default: 'NativeOnboarding' },
        }).default;
        let view, saving;
        await act(async () => { view = create(React.createElement(Screen)); });
        await act(async () => {
            saving = view.root.findByType('NativeOnboarding').props.onComplete({ preferredOctane: 'premium', searchRadiusMiles: 6 }, { latitude: 27, longitude: -82 });
            await Promise.resolve(); await Promise.resolve();
        });
        if (failure === 'storage') {
            await saving;
            assert.equal(handoff.getSnapshot(), 'idle');
        } else {
            assert.equal(handoff.getSnapshot(), 'preparing');
            assert.equal(events.some(e => e[0] === 'completed'), false);
            await act(async () => {
                if (failure === 'network') handoff.fail(Error('offline'));
                else handoff.mapReady();
                await saving;
            });
        }
        const native = view.root.findByType('NativeOnboarding');
        assert.equal(native.props.revealing, !failure);
        assert.equal(Boolean(native.props.saveError), Boolean(failure));
        assert.equal(events.some(e => e[0] === 'completed'), !failure);
        if (!failure) await act(async () => native.props.onExitComplete());
        assert.equal(handoff.getSnapshot(), 'idle');
        await act(async () => view.unmount());
    });
}

test('setup replay selects Home explicitly in the mounted native tab navigator', async () => {
    const handoff = createOnboardingHandoff();
    const actions = [];
    function NativeTabs({children}) { return React.createElement('Tabs', null, children); }
    NativeTabs.Trigger = Object.assign(({children}) => React.createElement('Tab', null, children), { Icon: 'Icon', Label: 'Label' });
    const navigation = { navigate: (...args) => actions.push(args) };
    const Layout = load('app/(tabs)/_layout.js', {
        'expo-router': { useNavigation: () => navigation },
        'expo-router/unstable-native-tabs': { NativeTabs },
        'react-native': { DynamicColorIOS: value => value },
        '../../src/lib/onboardingHandoff': { onboardingHandoff: handoff },
    }).default;
    const originalFrame = global.requestAnimationFrame;
    const originalCancel = global.cancelAnimationFrame;
    global.requestAnimationFrame = fn => { fn(); return 1; };
    global.cancelAnimationFrame = () => {};
    const ready = handoff.prepare();
    let view;
    await act(async () => { view = create(React.createElement(Layout)); });
    assert.deepEqual(actions, [['(tabs)', { screen: 'index' }]]);
    await act(async () => { handoff.mapReady(); await ready; handoff.reveal(); handoff.finish(); });
    assert.equal(actions.length, 1);
    await act(async () => view.unmount());
    global.requestAnimationFrame = originalFrame;
    global.cancelAnimationFrame = originalCancel;
});
