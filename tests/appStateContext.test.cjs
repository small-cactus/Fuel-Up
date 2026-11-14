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

test('moving location updates data consumers without rendering navigation or action-only screens', async () => {
    const { AppStateProvider, useAppState, useAppControls, useAppActions } = load('src/AppStateContext.js', {});
    const renders = { data: 0, controls: 0, actions: 0 };
    let data, controls, actions;
    let mounts = 0, cleanups = 0;
    function DataConsumer() { data = useAppState(); renders.data++; return null; }
    function NavigationConsumer() { controls = useAppControls(); renders.controls++; return null; }
    function SettingsConsumer() {
        actions = useAppActions();
        renders.actions++;
        React.useEffect(() => { mounts++; return () => { cleanups++; }; }, []);
        return null;
    }
    let renderer;
    await act(async () => { renderer = create(React.createElement(AppStateProvider, null,
        React.createElement(DataConsumer), React.createElement(NavigationConsumer), React.createElement(SettingsConsumer))); });
    const originalActions = actions;
    const originalControls = controls;
    for (let fix = 0; fix < 5; fix++) {
        await act(async () => actions.setResolvedFuelSearchContext({
            requestKey: `drive-${fix}`, criteriaSignature: 'regular|10', latitude: 37 + fix * 0.001, longitude: -122,
        }));
    }
    assert.equal(data.resolvedFuelSearchVersion, 5);
    assert.equal(data.resolvedFuelSearchContext.latitude, 37.004);
    assert.deepEqual(renders, { data: 6, controls: 1, actions: 1 });
    assert.equal(controls, originalControls);
    assert.equal(actions, originalActions);
    for (const [key, action] of Object.entries(actions)) assert.equal(data[key], action, `${key} retains combined API identity`);

    await act(async () => { actions.setFuelDebugState({ source: 'cache' }); actions.setHomeStationSnapshot({ stations: [] }); });
    await act(async () => actions.setManualLocationOverride({ latitude: 28, longitude: -82 }));
    assert.equal(data.manualLocationOverride.latitude, 28);
    await act(async () => actions.requestFuelReset());
    assert.equal(data.fuelResetToken, 1);
    assert.equal(data.resolvedFuelSearchContext, null);
    assert.equal(renders.controls, 1);
    assert.equal(renders.actions, 1);
    assert.equal(mounts, 1, 'permission/background subscriptions remain mounted');
    assert.equal(cleanups, 0);
    await act(async () => renderer.unmount());
    assert.equal(cleanups, 1);
});

test('probe and launch controls remain reactive while action consumers stay isolated', async () => {
    const { AppStateProvider, useAppState, useAppControls, useAppActions } = load('src/AppStateContext.js', {});
    let state, controls, actions, actionRenders = 0, controlRenders = 0;
    function DataConsumer() { state = useAppState(); return null; }
    function NavigationConsumer() { controls = useAppControls(); controlRenders++; return null; }
    function SettingsConsumer() { actions = useAppActions(); actionRenders++; return null; }
    let renderer;
    await act(async () => { renderer = create(React.createElement(AppStateProvider, null,
        React.createElement(DataConsumer), React.createElement(NavigationConsumer), React.createElement(SettingsConsumer))); });
    await act(async () => actions.requestClusterProbe({ token: 'drive-test' }));
    assert.equal(controls.clusterProbeRequest.token, 'drive-test');
    assert.equal(controls.isClusterProbeSessionActive, true);
    assert.equal(controls.clusterProbeRequest, state.clusterProbeRequest);
    await act(async () => actions.finishClusterProbeSession());
    assert.equal(controls.clusterProbeRequest, null);
    assert.equal(controls.isClusterProbeSessionActive, false);
    await act(async () => actions.holdRootReveal({ force: true }));
    assert.equal(controls.rootRevealPhase, 'blurred');
    assert.equal(controls.hasCompletedRootReveal, false);
    await act(async () => actions.startRootReveal());
    assert.equal(controls.rootRevealPhase, 'revealing');
    await act(async () => actions.hideRootReveal());
    assert.equal(controls.rootRevealPhase, 'hidden');
    assert.equal(controls.hasCompletedRootReveal, true);
    assert.equal(controls.rootRevealVersion, state.rootRevealVersion);
    assert.equal(controlRenders, 6);
    assert.equal(actionRenders, 1);
    await act(async () => renderer.unmount());
});
