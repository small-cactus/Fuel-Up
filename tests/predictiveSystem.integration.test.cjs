const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

const {
    APP_BUNDLE_ID,
    getPredictiveSystemProbeReportFilePath,
    runPredictiveSystemProbeIntegration,
} = require('../scripts/predictiveSystemProbeIntegration.cjs');
const {
    getTargetSimulatorId,
} = require('../scripts/locationProbeIntegration.cjs');

function hasBootedSimulator() {
    try {
        return Boolean(getTargetSimulatorId());
    } catch {
        return false;
    }
}

function appIsInstalledOnBootedSimulator() {
    try {
        const simulatorId = getTargetSimulatorId();
        const result = spawnSync('xcrun', [
            'simctl',
            'get_app_container',
            simulatorId,
            APP_BUNDLE_ID,
            'data',
        ], {
            encoding: 'utf8',
        });

        return result.status === 0 && Boolean((result.stdout || '').trim());
    } catch {
        return false;
    }
}

test('predictive system integration: simulator probe proves native MapKit routing and recommendation flow', {
    timeout: 120_000,
    skip: !hasBootedSimulator() || !appIsInstalledOnBootedSimulator()
        ? 'No booted simulator with Fuel Up installed — skipping predictive integration test.'
        : false,
}, async (t) => {
    const token = `predictive-${Date.now()}`;
    const report = await runPredictiveSystemProbeIntegration({ token });

    t.diagnostic(`probeReportPath=${getPredictiveSystemProbeReportFilePath()}`);
    t.diagnostic(`scenarioCount=${report.scenarioCount}`);

    assert.equal(report.status, 'completed');
    assert.equal(report.token, token);
    assert.ok(report.scenarioCount >= 3);
    assert.equal(report.passedScenarioCount, report.scenarioCount);

    for (const scenario of report.scenarios || []) {
        t.diagnostic(`${scenario.name}: expected=${scenario.expectedStationId} got=${scenario.recommendation?.stationId || 'none'} steps=${scenario.routeStepCount}`);
        assert.equal(scenario.pass, true, `${scenario.name} should pass in the simulator probe`);
        assert.ok(scenario.routeStepCount > 0, `${scenario.name} should include real MapKit steps`);
        assert.ok(scenario.lookaheadMeters >= 5_000, `${scenario.name} should project a meaningful ahead fetch`);
        assert.equal(
            scenario.surfaceNow,
            scenario.expectedSurfaceNow,
            `${scenario.name} should preserve the expected attention-aware surfacing decision`
        );
        assert.ok(Array.isArray(scenario.mergedStations) && scenario.mergedStations.length > 0, `${scenario.name} should merge stations`);
        assert.ok(
            scenario.mergedStations.some(station => Number.isFinite(Number(station.maneuverPenaltyPrice))),
            `${scenario.name} should annotate route maneuver penalties`
        );
    }
});
