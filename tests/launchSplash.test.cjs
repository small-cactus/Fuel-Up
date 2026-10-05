const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { create, act } = require('react-test-renderer');
const load = require('./helpers/loadComponent.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;
const { createLaunchReadiness } = load('src/lib/launchReadiness.js', {});

test('map-ready releases one launch only and unsubscribed listeners stay silent', () => {
    const state = createLaunchReadiness();
    let notifications = 0;
    const off = state.subscribe(() => notifications++);
    assert.equal(state.getSnapshot(), false);
    state.finish(); state.finish();
    assert.equal(state.getSnapshot(), true);
    assert.equal(notifications, 1);
    off(); state.finish(); assert.equal(notifications, 1);
});

for (const mapReady of [true, false]) {
    test(`splash animates after ${mapReady ? 'map readiness' : 'offline deadline'} and unmounts only on completion`, async t => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const state = createLaunchReadiness();
        let hidden = 0;
        const Splash = load('src/components/LaunchSplash.js', {
            'react-native': {
                Platform: { OS: 'ios' }, Animated: { Value: class {} },
                StyleSheet: { create: v => v, absoluteFillObject: {} },
            },
            'expo-modules-core': { requireNativeViewManager: () => 'NativeSplash' },
            'expo-splash-screen': { preventAutoHideAsync: async () => {}, hideAsync: async () => { hidden++; } },
            '../ThemeContext': { useTheme: () => ({ isDark: false }) },
            '../lib/launchReadiness': { launchReadiness: state, finishLaunch: () => state.finish() },
        }).default;
        let view;
        await act(async () => { view = create(React.createElement(Splash)); });
        assert.equal(hidden, 0, 'keep OS artwork until native replacement is drawn');
        if (mapReady) await act(async () => state.finish());
        assert.equal(view.root.findByType('NativeSplash').props.exiting, false,
            'even an already-ready map waits for the OS handoff');
        await act(async () => view.root.findByType('NativeSplash').props.onArtworkReady());
        assert.equal(hidden, 1);
        if (!mapReady) {
            await act(async () => t.mock.timers.tick(3999));
            assert.equal(view.root.findByType('NativeSplash').props.exiting, false);
            await act(async () => t.mock.timers.tick(1));
        }
        assert.equal(view.root.findByType('NativeSplash').props.exiting, true);
        assert.equal(view.root.findByType('NativeSplash').props.pointerEvents, 'none');
        assert.notEqual(view.toJSON(), null, 'readiness does not cut the animation short');
        await act(async () => view.root.findByType('NativeSplash').props.onExitComplete());
        assert.equal(view.toJSON(), null);
        assert.equal(state.getSnapshot(), true);
        await act(async () => view.unmount());
    });
}
