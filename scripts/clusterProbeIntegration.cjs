const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const APP_BUNDLE_ID = 'com.anthonyh.fuelup';
const PROBE_TIMEOUT_MS = 120000;
const APP_LAUNCH_WAIT_MS = 8000;
const POLL_INTERVAL_MS = 1000;

function sleep(durationMs) {
    return new Promise(resolve => {
        setTimeout(resolve, durationMs);
    });
}

function runCommand(command, args) {
    const result = spawnSync(command, args, {
        encoding: 'utf8',
    });

    if (result.error) {
        throw result.error;
    }

    if (result.status !== 0) {
        const stderr = (result.stderr || '').trim();
        const stdout = (result.stdout || '').trim();
        const details = stderr || stdout || `exit ${result.status}`;

        throw new Error(`${command} ${args.join(' ')} failed: ${details}`);
    }

    return (result.stdout || '').trim();
}

function getProbeReportFilePath() {
    const appContainerPath = runCommand('xcrun', [
        'simctl',
        'get_app_container',
        'booted',
        APP_BUNDLE_ID,
        'data',
    ]);

    if (!appContainerPath) {
        throw new Error('Unable to resolve the app data container for the booted simulator.');
    }

    return path.join(appContainerPath, 'Documents', 'cluster-debug-probe.json');
}

function launchAppIfNeeded() {
    const result = spawnSync('xcrun', [
        'simctl',
        'launch',
        'booted',
        APP_BUNDLE_ID,
    ], {
        encoding: 'utf8',
    });

    if (result.error) {
        throw result.error;
    }

    if (result.status === 0) {
        return;
    }

    const stderr = (result.stderr || '').trim();

    if (stderr.includes('already running')) {
        return;
    }

    const stdout = (result.stdout || '').trim();
    const details = stderr || stdout || `exit ${result.status}`;

    throw new Error(`Unable to launch ${APP_BUNDLE_ID}: ${details}`);
}

function terminateAppIfRunning() {
    const result = spawnSync('xcrun', [
        'simctl',
        'terminate',
        'booted',
        APP_BUNDLE_ID,
    ], {
        encoding: 'utf8',
    });

    if (result.error) {
        throw result.error;
    }

    if (result.status === 0) {
        return;
    }

    const stderr = (result.stderr || '').trim();
    if (
        stderr.includes('found nothing to terminate') ||
        stderr.includes('not running') ||
        stderr.includes('No such process')
    ) {
        return;
    }

    const stdout = (result.stdout || '').trim();
    const details = stderr || stdout || `exit ${result.status}`;
    throw new Error(`Unable to terminate ${APP_BUNDLE_ID}: ${details}`);
}

function reloadApp() {
    terminateAppIfRunning();
    launchAppIfNeeded();
}

function triggerProbe(token) {
    runCommand('xcrun', [
        'simctl',
        'openurl',
        'booted',
        `fuelup:///?clusterProbe=1&clusterProbeToken=${token}`,
    ]);
}

async function waitForProbeReport(reportFilePath, token) {
    const deadline = Date.now() + PROBE_TIMEOUT_MS;
    const expectedTrigger = `automation:${token}`;

    while (Date.now() < deadline) {
        if (fs.existsSync(reportFilePath)) {
            try {
                const parsedReport = JSON.parse(fs.readFileSync(reportFilePath, 'utf8'));

                if (parsedReport.trigger === expectedTrigger) {
                    if (parsedReport.status === 'completed') {
                        return parsedReport;
                    }

                    if (
                        parsedReport.status === 'failed' ||
                        parsedReport.status === 'blocked'
                    ) {
                        throw new Error(
                            parsedReport.message || `Probe ended with status ${parsedReport.status}.`
                        );
                    }
                }
            } catch (error) {
                if (error instanceof SyntaxError) {
                    // The app may still be writing the file. Try again on the next poll.
                } else {
                    throw error;
                }
            }
        }

        await sleep(POLL_INTERVAL_MS);
    }

    throw new Error(`Timed out waiting for probe token ${token}.`);
}

async function runClusterProbeIntegration(options = {}) {
    const maxFrameDeltaThreshold = options.maxFrameDeltaThreshold ?? 2;
    const throwOnThresholdExceeded = options.throwOnThresholdExceeded ?? true;
    const reloadAppBeforeProbe = options.reloadAppBeforeProbe ?? true;
    const token = options.token || `probe-test-${Date.now()}`;
    const reportFilePath = getProbeReportFilePath();

    if (reloadAppBeforeProbe) {
        reloadApp();
    } else {
        launchAppIfNeeded();
    }
    await sleep(APP_LAUNCH_WAIT_MS);
    triggerProbe(token);

    const report = await waitForProbeReport(reportFilePath, token);

    if (!Number.isFinite(report.maxFrameDelta)) {
        throw new Error(`Probe reported a non-numeric maxFrameDelta: ${report.maxFrameDelta}`);
    }

    const exceededThreshold = report.maxFrameDelta > maxFrameDeltaThreshold;

    if (exceededThreshold && throwOnThresholdExceeded) {
        throw new Error(
            `Probe maxFrameDelta ${report.maxFrameDelta.toFixed(2)}px exceeded ${maxFrameDeltaThreshold.toFixed(2)}px. ` +
            `Report: ${reportFilePath}`
        );
    }

    return {
        report,
        reportFilePath,
        token,
        exceededThreshold,
        maxFrameDeltaThreshold,
    };
}

module.exports = {
    APP_BUNDLE_ID,
    runClusterProbeIntegration,
};
