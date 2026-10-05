const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { act, create } = require('react-test-renderer');
const load = require('./helpers/loadComponent.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;
test('blur animation lasts 650ms independently of the request warning deadline', async t => {
    t.mock.method(Date, 'now', () => 1000);
    const shared = { value: 0 };
    const { default: Blur, WAITING_BLUR, ERROR_BLUR } = load('src/components/ConnectionBlur.js', {
        'react-native': { StyleSheet: { absoluteFill: {} } },
        'expo-blur': { BlurView: 'BlurView' },
        'react-native-reanimated': { __esModule: true, default: { createAnimatedComponent: () => 'AnimatedBlur' },
            cancelAnimation() {}, Easing: { linear: 'linear' }, useSharedValue: () => shared,
            useAnimatedProps: fn => fn(), withDelay: (delay, animation) => ({ delay, animation }),
            withTiming: (value, options) => ({ value, ...options }),
        },
    });
    let view;
    await act(async () => { view = create(React.createElement(Blur, { pending: { startedAt: 1000, deadlineAt: 21000 }, failed: false, isDark: false })); });
    assert.deepEqual(shared.value, { delay: 1000, animation: { value: WAITING_BLUR, duration: 650, easing: 'linear' } });
    await act(async () => view.update(React.createElement(Blur, { failed: true, isDark: false })));
    assert.deepEqual(shared.value, { value: ERROR_BLUR, duration: 650 });
    assert.equal(ERROR_BLUR, 40);
    await act(async () => view.unmount());
});
