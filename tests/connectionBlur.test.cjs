const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { act, create } = require('react-test-renderer');
const load = require('./helpers/loadComponent.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;
test('warning blur starts its 500ms animation when mounted', async t => {
    const shared = { value: 0 };
    const { default: Blur, ERROR_BLUR } = load('src/components/ConnectionBlur.js', {
        'react-native': { StyleSheet: { absoluteFill: {} } },
        'expo-blur': { BlurView: 'BlurView' },
        'react-native-reanimated': { __esModule: true, default: { createAnimatedComponent: () => 'AnimatedBlur' },
            cancelAnimation() {}, useSharedValue: () => shared,
            useAnimatedProps: fn => fn(),
            withTiming: (value, options) => ({ value, ...options }),
        },
    });
    let view;
    await act(async () => { view = create(React.createElement(Blur, { isDark: false })); });
    assert.deepEqual(shared.value, { value: ERROR_BLUR, duration: 500 });
    assert.equal(ERROR_BLUR, 65);
    await act(async () => view.unmount());
});
