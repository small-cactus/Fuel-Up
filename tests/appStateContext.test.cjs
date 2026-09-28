const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { act, create } = require('react-test-renderer');
const load = require('./helpers/loadComponent.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;

test('app state callbacks stay stable and search revisions increment exactly once under StrictMode', async () => {
    const { AppStateProvider, useAppState } = load('src/AppStateContext.js', {});
    let state;
    function Consumer() { state = useAppState(); return null; }
    let renderer;
    await act(async () => { renderer = create(React.createElement(React.StrictMode, null,
        React.createElement(AppStateProvider, null, React.createElement(Consumer)))); });
    const original = state;
    await act(async () => state.setFuelDebugState({ source: 'cache' }));
    for (const [key, value] of Object.entries(original)) {
        if (typeof value === 'function') assert.equal(state[key], value, `${key} must not restart dependent effects`);
    }
    const context = { requestKey: 'test', criteriaSignature: 'regular|10', latitude: 37, longitude: -122 };
    await act(async () => state.setResolvedFuelSearchContext(context));
    assert.equal(state.resolvedFuelSearchVersion, 1);
    await act(async () => state.setResolvedFuelSearchContext({ ...context }));
    assert.equal(state.resolvedFuelSearchVersion, 1);
    await act(async () => state.clearResolvedFuelSearchContext());
    assert.equal(state.resolvedFuelSearchVersion, 2);
    await act(async () => renderer.unmount());
});
