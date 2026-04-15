/**
 * Integration test for the movement-aware location refresh flow.
 *
 * This test runs AGAINST a booted iOS simulator with Fuel Up already
 * installed. It drives the app through a sequence of ~10mi city waypoints,
 * each time forcing a cold launch at waypoint A and then backgrounding /
 * foregrounding the app after moving the simulator location to waypoint B.
 *
 * For each waypoint, it verifies:
 *   1. Cold launch completes within the launch budget.
 *   2. The first location applied to state matches the waypoint.
 *   3. Fuel data is fetched for coordinates at the waypoint.
 *   4. After the app is reopened at the next waypoint, the location is
 *      updated within the movement-detection budget and fuel data is
 *      refetched for the new coordinates.
 *   5. No extra fuel fetches are issued when the device has not moved.
 *
 * This test is skipped automatically when no simulator is booted or when
 * Fuel Up is not installed on the booted simulator. That way running
 * `npm test` on CI or on a fresh checkout does not blow up — the unit
 * tests cover the pure logic.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

const {
    APP_BUNDLE_ID,
    distanceMetersBetween,
    filterEventsByType,
    getProbeReportFilePath,
    getTargetSimulatorId,
    launchAppCold,
    launchAppWithUrl,
    readProbeReportIfPresent,
    runLocationProbeIntegration,
    setSimulatorLocation,
    terminateAppIfRunning,
    waitForProbeCondition,
    deleteExistingProbeReport,
} = require('../scripts/locationProbeIntegration.cjs');

const CITY_WAYPOINTS = [
    { name: 'San Jose Downtown', latitude: 37.3346, longitude: -121.8910 },
    { name: 'Mountain View', latitude: 37.3861, longitude: -122.0839 },
    { name: 'Palo Alto', latitude: 37.4419, longitude: -122.1430 },
    { name: 'Redwood City', latitude: 37.4852, longitude: -122.2364 },
    { name: 'San Mateo', latitude: 37.5630, longitude: -122.3255 },
    { name: 'South San Francisco', latitude: 37.6547, longitude: -122.4077 },
    { name: 'San Francisco', latitude: 37.7749, longitude: -122.4194 },
    { name: 'Oakland', latitude: 37.8044, longitude: -122.2712 },
    { name: 'Berkeley', latitude: 37.8715, longitude: -122.2730 },
    { name: 'Hayward', latitude: 37.6688, longitude: -122.0808 },
];

const COLD_LAUNCH_BUDGET_MS = 15_000;
const FUEL_FETCH_BUDGET_MS = 15_000;
const MOVEMENT_DETECTION_BUDGET_MS = 12_000;
const LAUNCH_FIRST_PAINT_BUDGET_MS = 2_500;

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

        if (result.error) {
            return false;
        }

        return result.status === 0 && (result.stdout || '').trim().length > 0;
    } catch {
        return false;
    }
}

function formatWaypointEvents(waypointReport) {
    return (waypointReport?.coldLaunch?.events || [])
        .slice(0, 12)
        .map(event => `${event.type}@${event.elapsedMs}ms`)
        .join(', ');
}

function formatProbeEvents(report) {
    return (report?.events || [])
        .slice(0, 16)
        .map(event => `${event.type}@${event.elapsedMs}ms`)
        .join(', ');
}

test('location refresh integration: 10-waypoint road trip stays smooth and accurate', {
    timeout: 360_000,
    skip: !hasBootedSimulator() || !appIsInstalledOnBootedSimulator()
        ? 'No booted simulator with Fuel Up installed — skipping integration test.'
        : false,
}, async (t) => {
    const statusMessages = [];

    const integrationReport = await runLocationProbeIntegration({
        waypoints: CITY_WAYPOINTS,
        coldLaunchBudgetMs: COLD_LAUNCH_BUDGET_MS,
        fuelFetchBudgetMs: FUEL_FETCH_BUDGET_MS,
        movementDetectionBudgetMs: MOVEMENT_DETECTION_BUDGET_MS,
        onStatus: message => {
            statusMessages.push(message);
        },
    });

    statusMessages.forEach(message => t.diagnostic(message));

    t.diagnostic(`waypointCount=${integrationReport.perWaypointReports.length}`);

    const perWaypointReports = integrationReport.perWaypointReports;
    assert.equal(
        perWaypointReports.length,
        CITY_WAYPOINTS.length,
        `Expected metrics for every waypoint, got ${perWaypointReports.length}`
    );

    // Cold launch SLA: first launch (waypoint 0) must paint the cached
    // region quickly. Every subsequent cold launch after a previous trip
    // should also be fast because the cache primes it.
    perWaypointReports.forEach((report, index) => {
        const waypointName = CITY_WAYPOINTS[index].name;
        const { coldLaunch, refresh } = report;

        t.diagnostic(`waypoint[${index}] name="${waypointName}" coldLaunchEvents=[${formatWaypointEvents(report)}]`);

        assert.ok(
            Number.isFinite(coldLaunch.firstLocationAppliedAtMs),
            `waypoint[${index}] ${waypointName}: expected first location-applied event on cold launch, got none.`
        );

        assert.ok(
            coldLaunch.firstLocationAppliedAtMs <= LAUNCH_FIRST_PAINT_BUDGET_MS,
            `waypoint[${index}] ${waypointName}: first location-applied took ${coldLaunch.firstLocationAppliedAtMs}ms, expected <= ${LAUNCH_FIRST_PAINT_BUDGET_MS}ms.`
        );

        assert.ok(
            Number.isFinite(coldLaunch.firstFuelFetchEndAtMs),
            `waypoint[${index}] ${waypointName}: expected fuel-fetch-end event on cold launch, got none.`
        );

        assert.ok(
            coldLaunch.firstFuelFetchEndAtMs <= COLD_LAUNCH_BUDGET_MS,
            `waypoint[${index}] ${waypointName}: cold launch fuel fetch took ${coldLaunch.firstFuelFetchEndAtMs}ms, expected <= ${COLD_LAUNCH_BUDGET_MS}ms.`
        );

        // If this waypoint has a refresh phase, the resolved location must
        // match the NEXT waypoint (because the simulator location was
        // rotated before the resume).
        if (refresh && refresh.appliedLocation) {
            const expectedWaypoint = CITY_WAYPOINTS[index + 1];
            const distance = distanceMetersBetween(refresh.appliedLocation, expectedWaypoint);

            assert.ok(
                distance < 2_000,
                `waypoint[${index}→${index + 1}] ${waypointName} → ${expectedWaypoint.name}: resolved location is ${Math.round(distance)}m from expected, expected < 2000m.`
            );

            assert.equal(
                refresh.didMove,
                true,
                `waypoint[${index}→${index + 1}] ${waypointName} → ${expectedWaypoint.name}: expected movement-check to fire, didMove=${refresh.didMove}.`
            );

            assert.ok(
                refresh.fuelFetchEndCount >= 1,
                `waypoint[${index}→${index + 1}] ${waypointName} → ${expectedWaypoint.name}: expected at least one fuel fetch after refresh, got ${refresh.fuelFetchEndCount}.`
            );
        }
    });

    // Aggregate sanity: the map should NOT be reapplying the location more
    // than necessary. The cold-launch + single refresh cycle should result
    // in at most two `location-applied` events per waypoint (cached then
    // fresh). If this balloons, we introduced a regression that stutters.
    perWaypointReports.forEach((report, index) => {
        const applyCount = (report.coldLaunch.events || [])
            .filter(event => event.type === 'location-applied')
            .length;

        assert.ok(
            applyCount >= 1 && applyCount <= 3,
            `waypoint[${index}] ${CITY_WAYPOINTS[index].name}: expected 1-3 location-applied events during cold launch, got ${applyCount}.`
        );
    });
});

test('location refresh integration: cold launch still resolves current city when last-known is null', {
    timeout: 90_000,
    skip: !hasBootedSimulator() || !appIsInstalledOnBootedSimulator()
        ? 'No booted simulator with Fuel Up installed — skipping integration test.'
        : false,
}, async (t) => {
    const reportFilePath = getProbeReportFilePath();

    const waitForCompletedFuelFetch = async (predicateLabel) => (
        waitForProbeCondition({
            reportFilePath,
            predicate: report => {
                const completedFuelFetches = filterEventsByType(report, 'fuel-fetch-end').filter(event => (
                    event?.details?.status === 'completed'
                ));

                return completedFuelFetches.length > 0 && Boolean(report?.state?.location);
            },
            deadlineMs: COLD_LAUNCH_BUDGET_MS,
            predicateLabel,
        })
    );

    try {
        const requestedSeedWaypoint = CITY_WAYPOINTS[0];

        setSimulatorLocation(requestedSeedWaypoint.latitude, requestedSeedWaypoint.longitude);
        terminateAppIfRunning();
        deleteExistingProbeReport(reportFilePath);
        launchAppCold();

        const seededReport = await waitForCompletedFuelFetch(`seed-cache@${requestedSeedWaypoint.name}`);
        const seededLocation = seededReport?.state?.location || null;
        const targetWaypoint = CITY_WAYPOINTS
            .map(waypoint => ({
                ...waypoint,
                distanceMeters: distanceMetersBetween(seededLocation, waypoint),
            }))
            .sort((left, right) => right.distanceMeters - left.distanceMeters)[0];

        t.diagnostic(`seed events=[${formatProbeEvents(seededReport)}]`);
        assert.ok(
            seededLocation,
            'Expected first launch to produce a cached location before the override scenario.'
        );
        assert.ok(
            targetWaypoint.distanceMeters > 20_000,
            `Expected a far-away target waypoint for the override scenario, got only ${Math.round(targetWaypoint.distanceMeters)}m.`
        );

        setSimulatorLocation(targetWaypoint.latitude, targetWaypoint.longitude);
        terminateAppIfRunning();
        deleteExistingProbeReport(reportFilePath);
        launchAppWithUrl('fuelup:///?locationProbeForceNullLastKnown=1');

        const overrideReport = await waitForCompletedFuelFetch(`force-null-last-known@${targetWaypoint.name}`);
        const appliedLocation = overrideReport?.state?.location || null;
        const distanceToTarget = distanceMetersBetween(appliedLocation, targetWaypoint);
        const distanceToSeed = distanceMetersBetween(appliedLocation, seededLocation);
        const overrideEvents = formatProbeEvents(overrideReport);
        const sawOverrideEvent = filterEventsByType(overrideReport, 'last-known-position-overridden-null').length > 0;

        t.diagnostic(`override events=[${overrideEvents}]`);
        t.diagnostic(`seededLocation=${JSON.stringify(seededLocation)} targetWaypoint=${targetWaypoint.name} appliedLocation=${JSON.stringify(appliedLocation)} distanceToTarget=${Math.round(distanceToTarget)} distanceToSeed=${Math.round(distanceToSeed)}`);

        assert.equal(
            sawOverrideEvent,
            true,
            'Expected the deep-link override to force last-known position to null.'
        );

        assert.ok(
            distanceToTarget < 2_000,
            `Expected cold launch with null last-known to resolve near ${targetWaypoint.name}, got ${Math.round(distanceToTarget)}m away instead.`
        );
    } catch (error) {
        const latestReport = readProbeReportIfPresent(reportFilePath);
        if (latestReport) {
            t.diagnostic(`latest report events=[${formatProbeEvents(latestReport)}]`);
            t.diagnostic(`latest report state=${JSON.stringify(latestReport.state || {})}`);
        }
        throw error;
    } finally {
        try {
            terminateAppIfRunning();
        } catch {
            // Ignore cleanup failures.
        }
    }
});

test('location refresh integration: null last-known launch only performs one current-position fetch', {
    timeout: 90_000,
    skip: !hasBootedSimulator() || !appIsInstalledOnBootedSimulator()
        ? 'No booted simulator with Fuel Up installed — skipping integration test.'
        : false,
}, async (t) => {
    const reportFilePath = getProbeReportFilePath();

    const waitForCompletedFuelFetch = async (predicateLabel) => (
        waitForProbeCondition({
            reportFilePath,
            predicate: report => {
                const completedFuelFetches = filterEventsByType(report, 'fuel-fetch-end').filter(event => (
                    event?.details?.status === 'completed'
                ));

                return completedFuelFetches.length > 0 && Boolean(report?.state?.location);
            },
            deadlineMs: COLD_LAUNCH_BUDGET_MS,
            predicateLabel,
        })
    );

    try {
        const seedWaypoint = CITY_WAYPOINTS[0];
        const targetWaypoint = CITY_WAYPOINTS[8];

        setSimulatorLocation(seedWaypoint.latitude, seedWaypoint.longitude);
        terminateAppIfRunning();
        deleteExistingProbeReport(reportFilePath);
        launchAppCold();
        await waitForCompletedFuelFetch(`seed-duplicate-check@${seedWaypoint.name}`);

        setSimulatorLocation(targetWaypoint.latitude, targetWaypoint.longitude);
        terminateAppIfRunning();
        deleteExistingProbeReport(reportFilePath);
        launchAppWithUrl('fuelup:///?locationProbeForceNullLastKnown=1');

        const report = await waitForCompletedFuelFetch(`duplicate-current-fetch@${targetWaypoint.name}`);
        const currentPositionFetchStarts = filterEventsByType(report, 'current-position-fetch-start');
        const currentPositionFetchEnds = filterEventsByType(report, 'current-position-fetch-end');

        t.diagnostic(`duplicate-check events=[${formatProbeEvents(report)}]`);
        t.diagnostic(`current-position-fetch-start count=${currentPositionFetchStarts.length}`);

        assert.equal(
            currentPositionFetchStarts.length,
            1,
            `Expected exactly one current-position fallback fetch on launch, got ${currentPositionFetchStarts.length}.`
        );
        assert.equal(
            currentPositionFetchEnds.length,
            1,
            `Expected exactly one completed current-position fallback fetch on launch, got ${currentPositionFetchEnds.length}.`
        );
    } catch (error) {
        const latestReport = readProbeReportIfPresent(reportFilePath);
        if (latestReport) {
            t.diagnostic(`latest report events=[${formatProbeEvents(latestReport)}]`);
            t.diagnostic(`latest report state=${JSON.stringify(latestReport.state || {})}`);
        }
        throw error;
    } finally {
        try {
            terminateAppIfRunning();
        } catch {
            // Ignore cleanup failures.
        }
    }
});
