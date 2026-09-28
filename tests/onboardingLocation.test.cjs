const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { act, create } = require('react-test-renderer');
const load = require('./helpers/loadComponent.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;
test('radius location uses native coordinates only after permission and removes its watch', async () => {
    let removed = 0, watched = 0, accept, latest;
    const hook = load('src/screens/onboarding/useOnboardingLocation.js', { 'expo-location': {
        Accuracy: { Balanced: 3 },
        getLastKnownPositionAsync: async () => ({ coords: { latitude: 27.95, longitude: -82.45 } }),
        watchPositionAsync: async (_, callback) => { watched++; accept = callback; return { remove: () => removed++ }; },
    } }).default;
    function Harness({ granted }) { latest = hook({ foregroundGranted: granted }); return null; }
    let renderer;
    await act(async () => { renderer = create(React.createElement(Harness, { granted: false })); });
    assert.equal(latest, null); assert.equal(watched, 0);
    await act(async () => renderer.update(React.createElement(Harness, { granted: true })));
    assert.deepEqual(latest, { latitude: 27.95, longitude: -82.45 });
    await act(async () => accept({ coords: { latitude: 28, longitude: -82.4 } }));
    assert.deepEqual(latest, { latitude: 28, longitude: -82.4 });
    await act(async () => renderer.update(React.createElement(Harness, { granted: false })));
    assert.equal(latest, null); assert.equal(removed, 1);
    await act(async () => renderer.unmount());
});
