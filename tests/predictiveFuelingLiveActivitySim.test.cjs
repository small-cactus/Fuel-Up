const test = require('node:test');
const assert = require('node:assert/strict');

const {
    SIM_SCENARIOS,
    computePropsForProgress,
    createPredictiveFuelingLiveActivitySim,
} = require('../src/lib/predictiveFuelingLiveActivitySim.js');

test('SIM_SCENARIOS exposes at least one preset with the expected shape', () => {
    assert.ok(Array.isArray(SIM_SCENARIOS));
    assert.ok(SIM_SCENARIOS.length >= 1);

    for (const scenario of SIM_SCENARIOS) {
        assert.equal(typeof scenario.id, 'string');
        assert.equal(typeof scenario.label, 'string');
        assert.equal(typeof scenario.stationName, 'string');
        assert.equal(typeof scenario.pricePerGallon, 'number');
        assert.equal(typeof scenario.baselinePricePerGallon, 'number');
        assert.equal(typeof scenario.initialDistanceMiles, 'number');
        assert.equal(typeof scenario.initialEtaMinutes, 'number');
        assert.equal(typeof scenario.durationSeconds, 'number');
    }
});

test('computePropsForProgress produces valid props at start, mid, and end', () => {
    const scenario = SIM_SCENARIOS[0];

    const start = computePropsForProgress(scenario, 0);
    assert.equal(start.progress, 0);
    assert.equal(Number(start.distanceMiles).toFixed(1), scenario.initialDistanceMiles.toFixed(1));
    assert.equal(start.phase, 'approaching');

    const mid = computePropsForProgress(scenario, 0.5);
    assert.equal(mid.progress, 0.5);
    assert.ok(Number(mid.distanceMiles) < scenario.initialDistanceMiles);
    assert.ok(Number(mid.distanceMiles) > 0);

    const end = computePropsForProgress(scenario, 1);
    assert.equal(end.progress, 1);
    assert.equal(Number(end.distanceMiles), 0);
    assert.equal(end.phase, 'arrived');
    assert.equal(end.status, 'Arrived');
});

test('computePropsForProgress clamps out-of-range progress', () => {
    const scenario = SIM_SCENARIOS[0];
    const overshoot = computePropsForProgress(scenario, 1.5);
    assert.equal(overshoot.progress, 1);
    assert.equal(overshoot.phase, 'arrived');

    const undershoot = computePropsForProgress(scenario, -0.25);
    assert.equal(undershoot.progress, 0);
    assert.equal(undershoot.phase, 'approaching');
});

test('computePropsForProgress hides savings badge when baseline matches price', () => {
    const noSavings = SIM_SCENARIOS.find(s => s.pricePerGallon === s.baselinePricePerGallon);
    assert.ok(noSavings, 'expected a no-savings scenario preset');
    const state = computePropsForProgress(noSavings, 0.5);
    assert.equal(state.savingsPerGallon, '');
    assert.equal(state.totalSavings, '');
});

test('computePropsForProgress formats savings with two decimals when present', () => {
    const withSavings = SIM_SCENARIOS.find(s => s.pricePerGallon < s.baselinePricePerGallon);
    assert.ok(withSavings, 'expected a savings-positive scenario');
    const state = computePropsForProgress(withSavings, 0);
    assert.match(state.savingsPerGallon, /^\d+\.\d{2}$/);
    assert.match(state.totalSavings, /^\d+\.\d{2}$/);
});

test('computePropsForProgress advances status through phases', () => {
    const scenario = SIM_SCENARIOS[0];
    const early = computePropsForProgress(scenario, 0.1);
    const gettingClose = computePropsForProgress(scenario, 0.6);
    const almost = computePropsForProgress(scenario, 0.9);
    const arrived = computePropsForProgress(scenario, 1.0);

    assert.equal(early.phase, 'approaching');
    assert.equal(gettingClose.phase, 'approaching');
    assert.equal(gettingClose.status, 'Getting close');
    assert.equal(almost.phase, 'arriving');
    assert.equal(almost.status, 'Almost there');
    assert.equal(arrived.phase, 'arrived');
    assert.equal(arrived.status, 'Arrived');
});

test('eta formatting falls back to "<1" when near arrival and "0" at arrival', () => {
    const scenario = SIM_SCENARIOS[0];
    const nearlyArrived = computePropsForProgress(scenario, 0.92);
    assert.equal(nearlyArrived.etaMinutes, '<1');

    const arrived = computePropsForProgress(scenario, 1.0);
    assert.equal(arrived.etaMinutes, '0');
});

test('createPredictiveFuelingLiveActivitySim honors scenario selection and state callbacks without notifications', async () => {
    // Stub the notifications module so we don't touch the iOS Live Activity API.
    //
    // The sim now awaits `startPredictiveLiveActivity` (it went async so
    // the notifications.js dedup guarantee can settle before we start
    // the new activity). The stub returns a plain object — awaiting a
    // non-promise resolves in the next microtask, so the test must
    // `await sim.start()` before asserting on emitted state.
    //
    // Stubs also include `endAllLiveActivities` and `updateTrackedLiveActivity`
    // to match the new public API.
    const notificationsPath = require.resolve('../src/lib/notifications.js');
    const originalModule = require.cache[notificationsPath];
    require.cache[notificationsPath] = {
        id: notificationsPath,
        filename: notificationsPath,
        loaded: true,
        exports: {
            startPredictiveLiveActivity: () => ({ id: 'stub' }),
            updatePredictiveLiveActivity: () => {},
            updateTrackedLiveActivity: () => true,
            endLiveActivity: () => {},
            endAllLiveActivities: () => ({ ended: 0, errors: 0 }),
        },
    };

    try {
        const scenarioId = SIM_SCENARIOS[1].id;
        const observed = [];
        const sim = createPredictiveFuelingLiveActivitySim({
            scenarioId,
            onStateChange: (state) => { observed.push(state); },
            tickIntervalMs: 10_000,
        });

        await sim.start();
        assert.equal(sim.getState().phase, 'running');
        assert.equal(sim.getState().scenarioId, scenarioId);
        assert.ok(observed.length >= 1, 'expected at least an initial state emission');
        assert.equal(observed[0].stationName, SIM_SCENARIOS[1].stationName);

        sim.pause();
        assert.equal(sim.getState().phase, 'paused');

        sim.resume();
        assert.equal(sim.getState().phase, 'running');

        sim.stop();
        assert.equal(sim.getState().phase, 'idle');
        assert.equal(sim.getState().lastState, null);
    } finally {
        if (originalModule) {
            require.cache[notificationsPath] = originalModule;
        } else {
            delete require.cache[notificationsPath];
        }
    }
});
