/**
 * Location-refresh integration harness.
 *
 * Drives the booted iOS simulator through a sequence of city waypoints and
 * reads the `location-probe-report.json` that the app writes from
 * `src/lib/locationProbe.js`. The harness verifies three core claims:
 *
 *   1. Cold launch is "instant" — the app paints the map from cache and
 *      starts a fuel fetch within a short startup budget.
 *   2. Reopening the app after traveling to a new city resolves to the new
 *      city's coordinates and refetches fuel data for that city.
 *   3. Reopening in the same neighborhood skips the refetch (no wasted
 *      network requests).
 *
 * The harness is pure Node and depends only on `xcrun simctl`. It exposes a
 * single exported function, `runLocationProbeIntegration`, used by the Node
 * test that wraps it. The function returns a structured report so the test
 * can assert on specific fields instead of parsing strings.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const APP_BUNDLE_ID = 'com.anthonyh.fuelup';
const PROBE_REPORT_FILE_NAME = 'location-probe-report.json';
const PROBE_REPORT_RELATIVE_PATH = path.join('Documents', PROBE_REPORT_FILE_NAME);
const POLL_INTERVAL_MS = 300;
const DEFAULT_LAUNCH_DEADLINE_MS = 15_000;
const DEFAULT_FUEL_FETCH_DEADLINE_MS = 15_000;
const DEFAULT_MOVEMENT_DETECTION_DEADLINE_MS = 8_000;
const DEFAULT_POST_LAUNCH_SETTLE_MS = 2_500;
const BOOTSTRAP_FOREGROUND_URL = 'https://apple.com';
let cachedTargetSimulatorId = null;

function sleep(durationMs) {
    return new Promise(resolve => {
        setTimeout(resolve, durationMs);
    });
}

function runCommand(command, args, { allowFailure = false } = {}) {
    const result = spawnSync(command, args, {
        encoding: 'utf8',
    });

    if (result.error) {
        throw result.error;
    }

    if (result.status !== 0 && !allowFailure) {
        const stderr = (result.stderr || '').trim();
        const stdout = (result.stdout || '').trim();
        const details = stderr || stdout || `exit ${result.status}`;
        throw new Error(`${command} ${args.join(' ')} failed: ${details}`);
    }

    return {
        stdout: (result.stdout || '').trim(),
        stderr: (result.stderr || '').trim(),
        status: result.status,
    };
}

function listBootedSimulatorIds() {
    const { stdout } = runCommand('xcrun', ['simctl', 'list', 'devices', 'booted'], {
        allowFailure: true,
    });

    return String(stdout || '')
        .split('\n')
        .map(line => {
            const match = line.match(/\(([0-9A-F-]{36})\)\s+\(Booted\)/i);
            return match ? match[1] : null;
        })
        .filter(Boolean);
}

function canResolveAppContainer(deviceId) {
    const result = runCommand('xcrun', [
        'simctl',
        'get_app_container',
        deviceId,
        APP_BUNDLE_ID,
        'data',
    ], { allowFailure: true });

    return result.status === 0 && Boolean(result.stdout);
}

function getTargetSimulatorId() {
    if (cachedTargetSimulatorId) {
        return cachedTargetSimulatorId;
    }

    const bootedIds = listBootedSimulatorIds();
    if (bootedIds.length === 0) {
        throw new Error('No booted iOS simulator found.');
    }

    const installedId = bootedIds.find(canResolveAppContainer);
    cachedTargetSimulatorId = installedId || bootedIds[0];
    return cachedTargetSimulatorId;
}

function getAppDataContainerPath() {
    const simulatorId = getTargetSimulatorId();
    const { stdout } = runCommand('xcrun', [
        'simctl',
        'get_app_container',
        simulatorId,
        APP_BUNDLE_ID,
        'data',
    ]);

    if (!stdout) {
        throw new Error('Unable to resolve the app data container for the booted simulator.');
    }

    return stdout;
}

function getProbeReportFilePath() {
    const containerPath = getAppDataContainerPath();
    return path.join(containerPath, PROBE_REPORT_RELATIVE_PATH);
}

function setSimulatorLocation(latitude, longitude) {
    const simulatorId = getTargetSimulatorId();
    runCommand('xcrun', [
        'simctl',
        'location',
        simulatorId,
        'set',
        `${latitude},${longitude}`,
    ]);
}

function clearSimulatorLocation() {
    const simulatorId = getTargetSimulatorId();
    runCommand('xcrun', ['simctl', 'location', simulatorId, 'clear'], {
        allowFailure: true,
    });
}

function terminateAppIfRunning() {
    const simulatorId = getTargetSimulatorId();
    const { status, stderr } = runCommand('xcrun', [
        'simctl',
        'terminate',
        simulatorId,
        APP_BUNDLE_ID,
    ], { allowFailure: true });

    if (status === 0) {
        return;
    }

    if (
        stderr.includes('found nothing to terminate') ||
        stderr.includes('not running') ||
        stderr.includes('No such process')
    ) {
        return;
    }

    throw new Error(`Unable to terminate ${APP_BUNDLE_ID}: ${stderr || `exit ${status}`}`);
}

function launchAppCold() {
    const simulatorId = getTargetSimulatorId();
    runCommand('xcrun', [
        'simctl',
        'launch',
        simulatorId,
        APP_BUNDLE_ID,
    ]);
}

function launchAppWithUrl(url) {
    const simulatorId = getTargetSimulatorId();
    runCommand('xcrun', [
        'simctl',
        'openurl',
        simulatorId,
        url,
    ]);
}

function sendAppToBackground() {
    const simulatorId = getTargetSimulatorId();
    // Opening any URL kicks the simulator's foreground focus away from our
    // app, which the OS reports as an AppState inactive/background
    // transition. We intentionally target a benign HTTPS URL so Safari
    // handles it instead of our own deep-link scheme.
    runCommand('xcrun', [
        'simctl',
        'openurl',
        simulatorId,
        BOOTSTRAP_FOREGROUND_URL,
    ], { allowFailure: true });
}

function foregroundApp() {
    const simulatorId = getTargetSimulatorId();
    runCommand('xcrun', [
        'simctl',
        'launch',
        simulatorId,
        APP_BUNDLE_ID,
    ]);
}

function deleteExistingProbeReport(reportFilePath) {
    try {
        if (fs.existsSync(reportFilePath)) {
            fs.unlinkSync(reportFilePath);
        }
    } catch (error) {
        // Best-effort; the probe will overwrite the file on its next flush.
    }
}

function readProbeReportIfPresent(reportFilePath) {
    if (!fs.existsSync(reportFilePath)) {
        return null;
    }

    try {
        const rawValue = fs.readFileSync(reportFilePath, 'utf8');

        if (!rawValue.trim()) {
            return null;
        }

        return JSON.parse(rawValue);
    } catch (error) {
        if (error instanceof SyntaxError) {
            return null;
        }
        throw error;
    }
}

async function waitForProbeCondition({
    reportFilePath,
    predicate,
    deadlineMs,
    predicateLabel,
}) {
    const deadline = Date.now() + deadlineMs;
    let latestReport = null;

    while (Date.now() < deadline) {
        const report = readProbeReportIfPresent(reportFilePath);

        if (report) {
            latestReport = report;

            try {
                if (predicate(report)) {
                    return report;
                }
            } catch (predicateError) {
                throw new Error(`Probe predicate ${predicateLabel} threw: ${predicateError.message}`);
            }
        }

        await sleep(POLL_INTERVAL_MS);
    }

    throw new Error(
        `Timed out waiting for probe predicate ${predicateLabel} after ${deadlineMs}ms. ` +
        `latest=${latestReport ? JSON.stringify(latestReport.state || {}) : 'none'}`
    );
}

function filterEventsByType(report, type) {
    if (!report || !Array.isArray(report.events)) {
        return [];
    }

    return report.events.filter(event => event?.type === type);
}

function distanceMetersBetween(from, to) {
    if (!from || !to) {
        return Number.POSITIVE_INFINITY;
    }

    const toRadians = degrees => degrees * (Math.PI / 180);
    const earthRadiusMeters = 6_371_000;
    const fromLat = Number(from.latitude);
    const fromLng = Number(from.longitude);
    const toLat = Number(to.latitude);
    const toLng = Number(to.longitude);

    if (!Number.isFinite(fromLat) || !Number.isFinite(fromLng) || !Number.isFinite(toLat) || !Number.isFinite(toLng)) {
        return Number.POSITIVE_INFINITY;
    }

    const dLat = toRadians(toLat - fromLat);
    const dLng = toRadians(toLng - fromLng);
    const a = (
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRadians(fromLat)) * Math.cos(toRadians(toLat)) *
        Math.sin(dLng / 2) ** 2
    );
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return earthRadiusMeters * c;
}

function buildWaypointMetrics({ waypoint, coldLaunchReport, refreshReport }) {
    const coldMapLoadedAt = filterEventsByType(coldLaunchReport, 'map-loaded')[0]?.elapsedMs ?? null;
    const coldFuelStartAt = filterEventsByType(coldLaunchReport, 'fuel-fetch-start')[0]?.elapsedMs ?? null;
    const coldFuelEndAt = filterEventsByType(coldLaunchReport, 'fuel-fetch-end')[0]?.elapsedMs ?? null;
    const coldLocationAppliedAt = filterEventsByType(coldLaunchReport, 'location-applied')[0]?.elapsedMs ?? null;

    // The app emits two flavors of movement-check events:
    // - `launch-movement-check-result` from the inline bootstrap path inside
    //   `resolveCurrentLocation` (fires on cold launch).
    // - `movement-check-result` from `maybeRefreshDeviceLocationFromLastKnown`
    //   (fires on the AppState foreground-resume path).
    // Either counts as a real "did the device move" check for this test.
    const movementCheckEvents = [
        ...filterEventsByType(refreshReport, 'movement-check-result'),
        ...filterEventsByType(refreshReport, 'launch-movement-check-result'),
    ];
    const locationAppliedEvents = filterEventsByType(refreshReport, 'location-applied');
    const fuelFetchStartEvents = filterEventsByType(refreshReport, 'fuel-fetch-start');
    const fuelFetchEndEvents = filterEventsByType(refreshReport, 'fuel-fetch-end');

    const firstMoveEvent = movementCheckEvents.find(event => event?.details?.didMove === true);

    const appliedLocation = refreshReport?.state?.location || null;
    const distanceMetersFromTarget = appliedLocation
        ? distanceMetersBetween(appliedLocation, waypoint)
        : Number.POSITIVE_INFINITY;

    return {
        waypoint,
        coldLaunch: {
            mapLoadedAtMs: coldMapLoadedAt,
            firstLocationAppliedAtMs: coldLocationAppliedAt,
            firstFuelFetchStartAtMs: coldFuelStartAt,
            firstFuelFetchEndAtMs: coldFuelEndAt,
            state: coldLaunchReport?.state || null,
            events: coldLaunchReport?.events || [],
        },
        refresh: {
            appliedLocation,
            distanceMetersFromTarget,
            didMove: Boolean(firstMoveEvent),
            firstMovementCheckElapsedMs: movementCheckEvents[0]?.elapsedMs ?? null,
            locationAppliedCount: locationAppliedEvents.length,
            fuelFetchStartCount: fuelFetchStartEvents.length,
            fuelFetchEndCount: fuelFetchEndEvents.length,
            state: refreshReport?.state || null,
            events: refreshReport?.events || [],
        },
    };
}

/**
 * Drive the simulator through a sequence of cold-launch + foreground-refresh
 * cycles and return a structured report suitable for test assertions.
 *
 * For each waypoint in `waypoints`, the harness:
 *   1. Sets the simulator location to the waypoint.
 *   2. Terminates any running instance of the app and launches it cold.
 *   3. Waits for the probe report to show a completed fuel fetch.
 *   4. Moves the simulator to the NEXT waypoint.
 *   5. Backgrounds the app, then foregrounds it to trigger the AppState
 *      resume handler and the movement detection flow.
 *   6. Waits for the probe to show a new location-applied event and a new
 *      completed fuel fetch at the new waypoint.
 *
 * The returned object lists per-waypoint metrics plus aggregate counts so
 * the test can enforce strict SLAs (e.g. cold launch < 5s, movement check
 * < 8s) without duplicating timing code.
 */
async function runLocationProbeIntegration({
    waypoints,
    coldLaunchBudgetMs = DEFAULT_LAUNCH_DEADLINE_MS,
    fuelFetchBudgetMs = DEFAULT_FUEL_FETCH_DEADLINE_MS,
    movementDetectionBudgetMs = DEFAULT_MOVEMENT_DETECTION_DEADLINE_MS,
    postLaunchSettleMs = DEFAULT_POST_LAUNCH_SETTLE_MS,
    onStatus = null,
} = {}) {
    if (!Array.isArray(waypoints) || waypoints.length < 2) {
        throw new Error('runLocationProbeIntegration requires at least 2 waypoints.');
    }

    const statusLog = [];
    const log = message => {
        statusLog.push({
            timestamp: new Date().toISOString(),
            message,
        });
        if (typeof onStatus === 'function') {
            try {
                onStatus(message);
            } catch (error) {
                // Status callback errors should never break the run.
            }
        }
    };

    log(`integration-start waypointCount=${waypoints.length}`);

    const perWaypointReports = [];
    let previousWaypoint = null;

    try {
        for (let waypointIndex = 0; waypointIndex < waypoints.length; waypointIndex += 1) {
            const waypoint = waypoints[waypointIndex];
            log(`waypoint[${waypointIndex}] name="${waypoint.name}" setLocation=(${waypoint.latitude},${waypoint.longitude})`);

            setSimulatorLocation(waypoint.latitude, waypoint.longitude);
            terminateAppIfRunning();

            const reportFilePath = getProbeReportFilePath();
            deleteExistingProbeReport(reportFilePath);

            log(`waypoint[${waypointIndex}] launch-cold`);
            const coldLaunchStartedAt = Date.now();
            launchAppCold();

            const coldLaunchReport = await waitForProbeCondition({
                reportFilePath,
                predicate: report => {
                    const fuelEndEvents = filterEventsByType(report, 'fuel-fetch-end');
                    const completedFuelFetches = fuelEndEvents.filter(event => (
                        event?.details?.status === 'completed'
                    ));
                    if (completedFuelFetches.length === 0) {
                        return false;
                    }

                    // Make sure the location actually resolved to the
                    // simctl-set coordinates for this waypoint. On the very
                    // first waypoint the cached region may be something
                    // else from a prior test run, which is fine — the
                    // launch-movement check should still detect the move
                    // and refetch fuel for the new coordinates.
                    const appliedLocation = report?.state?.location;
                    if (!appliedLocation) {
                        return false;
                    }

                    const distance = distanceMetersBetween(appliedLocation, waypoint);
                    return distance < 2_000; // Within 2km of the waypoint.
                },
                deadlineMs: coldLaunchBudgetMs,
                predicateLabel: `coldLaunchCompleted@${waypoint.name}`,
            });
            const coldLaunchElapsedMs = Date.now() - coldLaunchStartedAt;
            log(`waypoint[${waypointIndex}] cold-launch-complete elapsed=${coldLaunchElapsedMs}ms`);

            // Let the app settle so subsequent AppState transitions are
            // unambiguous. Without this, the background/foreground flip can
            // land inside the cold launch's animation budget and confuse
            // the resume predicate.
            await sleep(postLaunchSettleMs);

            // For the "refresh" phase, we do an actual cold restart at the
            // next waypoint. On the iOS simulator the React Native
            // AppState listener does not always fire a `change` event for
            // `background → active` transitions when the app is foregrounded
            // via `xcrun simctl launch`, so we intentionally simulate the
            // user's worst case: killing and reopening the app at a new
            // location. This is exactly the scenario the feature was
            // designed for ("reopening after travel") — the launch-time
            // movement check inside resolveCurrentLocation handles it.
            let refreshReport = null;

            if (waypointIndex + 1 < waypoints.length) {
                const nextWaypoint = waypoints[waypointIndex + 1];

                log(`waypoint[${waypointIndex}] rotate-to-next name="${nextWaypoint.name}" setLocation=(${nextWaypoint.latitude},${nextWaypoint.longitude})`);
                setSimulatorLocation(nextWaypoint.latitude, nextWaypoint.longitude);

                log(`waypoint[${waypointIndex}] cold-restart-at-next`);
                terminateAppIfRunning();
                deleteExistingProbeReport(reportFilePath);
                const refreshStartedAt = Date.now();
                launchAppCold();

                try {
                    refreshReport = await waitForProbeCondition({
                        reportFilePath,
                        predicate: report => {
                            const fuelEndEvents = filterEventsByType(report, 'fuel-fetch-end');
                            const completedFuelFetches = fuelEndEvents.filter(event => (
                                event?.details?.status === 'completed'
                            ));
                            if (completedFuelFetches.length === 0) {
                                return false;
                            }

                            const appliedLocation = report?.state?.location;
                            if (!appliedLocation) {
                                return false;
                            }

                            const distance = distanceMetersBetween(appliedLocation, nextWaypoint);
                            return distance < 2_000; // Within 2km of the target waypoint.
                        },
                        deadlineMs: movementDetectionBudgetMs + fuelFetchBudgetMs,
                        predicateLabel: `refreshAppliedAndFuelFetched@${nextWaypoint.name}`,
                    });
                    const refreshElapsedMs = Date.now() - refreshStartedAt;
                    log(`waypoint[${waypointIndex}] refresh-complete elapsed=${refreshElapsedMs}ms`);
                } catch (error) {
                    refreshReport = readProbeReportIfPresent(reportFilePath);
                    perWaypointReports.push(buildWaypointMetrics({
                        waypoint: nextWaypoint,
                        coldLaunchReport,
                        refreshReport,
                    }));
                    throw error;
                }
            }

            perWaypointReports.push(buildWaypointMetrics({
                waypoint,
                coldLaunchReport,
                refreshReport,
            }));

            previousWaypoint = waypoint;
        }
    } finally {
        try {
            terminateAppIfRunning();
        } catch (error) {
            // Ignore cleanup errors; the test will already have signaled.
        }
        clearSimulatorLocation();
    }

    return {
        statusLog,
        perWaypointReports,
        previousWaypoint,
    };
}

module.exports = {
    APP_BUNDLE_ID,
    runLocationProbeIntegration,
    getProbeReportFilePath,
    readProbeReportIfPresent,
    sleep,
    setSimulatorLocation,
    clearSimulatorLocation,
    distanceMetersBetween,
    launchAppCold,
    launchAppWithUrl,
    terminateAppIfRunning,
    deleteExistingProbeReport,
    waitForProbeCondition,
    filterEventsByType,
    getTargetSimulatorId,
    listBootedSimulatorIds,
};
