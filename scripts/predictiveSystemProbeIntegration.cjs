const path = require('node:path');

const {
    APP_BUNDLE_ID,
    deleteExistingProbeReport,
    getTargetSimulatorId,
    launchAppCold,
    launchAppWithUrl,
    readProbeReportIfPresent,
    sleep,
    terminateAppIfRunning,
    waitForProbeCondition,
} = require('./locationProbeIntegration.cjs');

const PROBE_REPORT_FILE_NAME = 'predictive-system-probe.json';
const PROBE_REPORT_RELATIVE_PATH = path.join('Documents', PROBE_REPORT_FILE_NAME);
const DEFAULT_WARM_LAUNCH_SETTLE_MS = 8_000;
const DEFAULT_RETRY_DELAY_MS = 5_000;
const DEFAULT_MAX_TRIGGER_ATTEMPTS = 3;

function getPredictiveSystemProbeReportFilePath() {
    const simulatorId = getTargetSimulatorId();
    const { spawnSync } = require('node:child_process');
    const result = spawnSync('xcrun', [
        'simctl',
        'get_app_container',
        simulatorId,
        APP_BUNDLE_ID,
        'data',
    ], {
        encoding: 'utf8',
    });

    if (result.error || result.status !== 0) {
        throw result.error || new Error(result.stderr || 'Unable to resolve simulator app container');
    }

    return path.join((result.stdout || '').trim(), PROBE_REPORT_RELATIVE_PATH);
}

async function waitForProbeStart({
    reportFilePath,
    token,
    deadlineMs,
}) {
    return waitForProbeCondition({
        reportFilePath,
        predicate: report => (
            report?.token === token &&
            (
                report?.status === 'running' ||
                report?.status === 'completed'
            )
        ),
        deadlineMs,
        predicateLabel: `predictiveSystemProbeStarted@${token}`,
    });
}

async function triggerProbeWithWarmLaunch({
    reportFilePath,
    token,
    warmLaunchSettleMs,
    retryDelayMs,
    maxTriggerAttempts,
}) {
    launchAppCold();
    await sleep(warmLaunchSettleMs);

    let lastStartError = null;

    for (let attempt = 1; attempt <= maxTriggerAttempts; attempt += 1) {
        launchAppWithUrl(`fuelup:///?predictiveSystemProbe=1&predictiveSystemProbeToken=${encodeURIComponent(token)}`);

        try {
            await waitForProbeStart({
                reportFilePath,
                token,
                deadlineMs: retryDelayMs,
            });
            return;
        } catch (error) {
            lastStartError = error;
        }
    }

    throw lastStartError || new Error('Unable to trigger predictive system probe.');
}

async function runPredictiveSystemProbeIntegration({
    token = `probe-${Date.now()}`,
    deadlineMs = 90_000,
    warmLaunchSettleMs = DEFAULT_WARM_LAUNCH_SETTLE_MS,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    maxTriggerAttempts = DEFAULT_MAX_TRIGGER_ATTEMPTS,
} = {}) {
    const reportFilePath = getPredictiveSystemProbeReportFilePath();

    terminateAppIfRunning();
    deleteExistingProbeReport(reportFilePath);
    await triggerProbeWithWarmLaunch({
        reportFilePath,
        token,
        warmLaunchSettleMs,
        retryDelayMs,
        maxTriggerAttempts,
    });

    return waitForProbeCondition({
        reportFilePath,
        predicate: report => (
            report?.status === 'completed' &&
            report?.token === token &&
            Number(report?.scenarioCount) >= 3 &&
            Number(report?.passedScenarioCount) === Number(report?.scenarioCount)
        ),
        deadlineMs,
        predicateLabel: `predictiveSystemProbe@${token}`,
    });
}

module.exports = {
    APP_BUNDLE_ID,
    getPredictiveSystemProbeReportFilePath,
    readProbeReportIfPresent,
    runPredictiveSystemProbeIntegration,
};
