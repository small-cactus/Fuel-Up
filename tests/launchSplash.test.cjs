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
    test(`splash releases on ${mapReady ? 'rendered map without delay' : 'deadline when map is offline'}`, async t => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const state = createLaunchReadiness();
        let hidden = 0;
        const Splash = load('src/components/LaunchSplash.js', {
            'react-native': { View: 'View', Image: 'Image', StyleSheet: { create: v => v, absoluteFillObject: {}, absoluteFill: {} } },
            'expo-splash-screen': { preventAutoHideAsync: async () => {}, hideAsync: async () => { hidden++; } },
            '../ThemeContext': { useTheme: () => ({ isDark: false }) },
            '../lib/launchReadiness': { launchReadiness: state, finishLaunch: () => state.finish() },
        }).default;
        let view;
        await act(async () => { view = create(React.createElement(Splash)); });
        assert.equal(view.root.findByType('View').props.testID, 'launch-splash');
        await act(async () => view.root.findByType('View').props.onLayout());
        assert.equal(hidden, 0, 'native artwork stays while its replacement image loads');
        await act(async () => view.root.findByType('Image').props.onLoadEnd());
        assert.equal(hidden, 1, 'native screen hands off after branded cover has layout and artwork');
        await act(async () => {
            if (mapReady) state.finish();
            else t.mock.timers.tick(3999);
        });
        if (!mapReady) {
            assert.notEqual(view.toJSON(), null);
            await act(async () => t.mock.timers.tick(1));
        }
        assert.equal(view.toJSON(), null);
        assert.equal(state.getSnapshot(), true);
        await act(async () => view.unmount());
    });
}
