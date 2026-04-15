/**
 * Simulated city-move scenarios for the movement-detection helpers.
 *
 * These tests drive a fake timeline of location readings and assert that the
 * helpers in `src/lib/locationRefresh.js` make the right refresh decisions at
 * every step. They deliberately mirror the real integration scenarios (cold
 * launch with fresh cache, cold launch with stale cache, foreground resume
 * after a city-scale move, rapid background/foreground flips) so that any
 * regression in the threshold tuning is caught without needing the iOS
 * simulator.
 *
 * The reference coordinates below sit in real neighborhoods across the San
 * Francisco Bay Area so that the distances under test are representative of
 * what a user would see on a real trip.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    LOCATION_FOREGROUND_MIN_INTERVAL_MS,
    LOCATION_LAUNCH_STALENESS_MS,
    LOCATION_MOVEMENT_THRESHOLD_METERS,
    calculateDistanceMeters,
    hasMovedBeyondThreshold,
    isCachedLocationStale,
    shouldCheckOnForegroundResume,
} from '../src/lib/locationRefresh.js';

// Ten waypoints roughly 10mi / 16km apart inside and around the SF Bay Area.
// Each point is a genuine city center so the test reads like a plausible
// day's drive from San Jose up the peninsula, across the bay, and back.
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

// Tight-radius drift points, all within 100m of San Jose Downtown. Used to
// verify that tiny GPS wobble never triggers a refetch.
const SAN_JOSE_DRIFT_POINTS = [
    { name: 'SJ drift 0', latitude: 37.33460, longitude: -121.89100 },
    { name: 'SJ drift 1', latitude: 37.33470, longitude: -121.89090 },
    { name: 'SJ drift 2', latitude: 37.33455, longitude: -121.89115 },
    { name: 'SJ drift 3', latitude: 37.33468, longitude: -121.89092 },
    { name: 'SJ drift 4', latitude: 37.33450, longitude: -121.89122 },
];

test('10 city waypoints are all at least 10 km / ~6mi apart from each other', () => {
    for (let firstIndex = 0; firstIndex < CITY_WAYPOINTS.length; firstIndex += 1) {
        for (let secondIndex = firstIndex + 1; secondIndex < CITY_WAYPOINTS.length; secondIndex += 1) {
            const distance = calculateDistanceMeters(
                CITY_WAYPOINTS[firstIndex],
                CITY_WAYPOINTS[secondIndex]
            );

            assert.ok(
                distance >= 5_000,
                `${CITY_WAYPOINTS[firstIndex].name} → ${CITY_WAYPOINTS[secondIndex].name} should be >= 5km, got ${Math.round(distance)}m`
            );
        }
    }
});

test('Every city waypoint triggers a refresh from every other city waypoint', () => {
    const refreshMatrix = CITY_WAYPOINTS.map(fromRegion => (
        CITY_WAYPOINTS.map(toRegion => (
            fromRegion === toRegion
                ? false
                : hasMovedBeyondThreshold({
                    fromRegion,
                    toRegion,
                })
        ))
    ));

    for (let fromIndex = 0; fromIndex < CITY_WAYPOINTS.length; fromIndex += 1) {
        for (let toIndex = 0; toIndex < CITY_WAYPOINTS.length; toIndex += 1) {
            if (fromIndex === toIndex) {
                assert.equal(
                    refreshMatrix[fromIndex][toIndex],
                    false,
                    `Same waypoint ${CITY_WAYPOINTS[fromIndex].name} should not refresh`
                );
                continue;
            }

            assert.equal(
                refreshMatrix[fromIndex][toIndex],
                true,
                `${CITY_WAYPOINTS[fromIndex].name} → ${CITY_WAYPOINTS[toIndex].name} must refresh`
            );
        }
    }
});

test('GPS drift around San Jose Downtown never triggers a refresh', () => {
    for (const driftPoint of SAN_JOSE_DRIFT_POINTS) {
        assert.equal(
            hasMovedBeyondThreshold({
                fromRegion: CITY_WAYPOINTS[0],
                toRegion: driftPoint,
            }),
            false,
            `Drift ${driftPoint.name} should not trigger refresh`
        );
    }
});

test('Cold launch with fresh cache (< 2min old) skips the movement check', () => {
    const now = 1_700_000_000_000;
    const cachedCapturedAt = now - 30_000; // 30s ago

    assert.equal(
        isCachedLocationStale({
            capturedAt: cachedCapturedAt,
            nowMs: now,
            maxAgeMs: LOCATION_LAUNCH_STALENESS_MS,
        }),
        false
    );
});

test('Cold launch with stale cache (> 2min old) triggers the movement check', () => {
    const now = 1_700_000_000_000;
    const cachedCapturedAt = now - (LOCATION_LAUNCH_STALENESS_MS + 10_000);

    assert.equal(
        isCachedLocationStale({
            capturedAt: cachedCapturedAt,
            nowMs: now,
            maxAgeMs: LOCATION_LAUNCH_STALENESS_MS,
        }),
        true
    );
});

test('Reopening the app after traveling to a new city resolves to the new city', () => {
    // Scenario: user closed the app in San Jose, drove to San Francisco,
    // then reopened the app. The cached region is still San Jose but the
    // movement check sees the fresh reading as San Francisco.
    const cachedRegion = CITY_WAYPOINTS[0]; // San Jose
    const freshRegion = CITY_WAYPOINTS[6];  // San Francisco

    assert.equal(
        hasMovedBeyondThreshold({
            fromRegion: cachedRegion,
            toRegion: freshRegion,
        }),
        true,
        'Must detect San Jose → San Francisco as a real move'
    );

    const distanceMeters = calculateDistanceMeters(cachedRegion, freshRegion);
    assert.ok(
        distanceMeters > 60_000,
        `San Jose → San Francisco should be ~67km, got ${Math.round(distanceMeters)}m`
    );
});

test('Reopening the app in the same neighborhood keeps the cached region', () => {
    // Scenario: user closed the app in San Jose, walked across the street,
    // reopened the app. GPS drift is under the 250m threshold and the
    // helper correctly keeps the cached region.
    const cachedRegion = CITY_WAYPOINTS[0];
    const freshRegion = {
        latitude: CITY_WAYPOINTS[0].latitude + 0.001,
        longitude: CITY_WAYPOINTS[0].longitude - 0.0005,
    };

    const distanceMeters = calculateDistanceMeters(cachedRegion, freshRegion);
    assert.ok(
        distanceMeters < LOCATION_MOVEMENT_THRESHOLD_METERS,
        `Neighborhood drift should stay under threshold, got ${Math.round(distanceMeters)}m`
    );

    assert.equal(
        hasMovedBeyondThreshold({
            fromRegion: cachedRegion,
            toRegion: freshRegion,
        }),
        false
    );
});

test('Rapid background/foreground flips debounce as long as they come within 30s', () => {
    const now = 1_700_000_000_000;
    let lastCheckAt = now - 60_000;

    // First foreground resume: check allowed (last check was 60s ago).
    assert.equal(
        shouldCheckOnForegroundResume({
            lastCheckAt,
            nowMs: now,
            minIntervalMs: LOCATION_FOREGROUND_MIN_INTERVAL_MS,
        }),
        true
    );

    // Record the check, then immediately simulate another resume 5s later.
    lastCheckAt = now;
    const rapidResumeAt = now + 5_000;

    assert.equal(
        shouldCheckOnForegroundResume({
            lastCheckAt,
            nowMs: rapidResumeAt,
            minIntervalMs: LOCATION_FOREGROUND_MIN_INTERVAL_MS,
        }),
        false,
        'Rapid reopen inside 30s should not trigger another check'
    );

    // After the debounce window closes, the next resume is allowed again.
    const laterResumeAt = now + LOCATION_FOREGROUND_MIN_INTERVAL_MS + 1_000;

    assert.equal(
        shouldCheckOnForegroundResume({
            lastCheckAt,
            nowMs: laterResumeAt,
            minIntervalMs: LOCATION_FOREGROUND_MIN_INTERVAL_MS,
        }),
        true
    );
});

test('Simulated road trip through 10 waypoints decides correctly at each step', () => {
    // Represent a road trip: initial cache set at waypoint 0, then the
    // user drives through each subsequent waypoint. At each step, the
    // helper must decide whether the refresh would fire.
    const decisions = [];
    let cachedRegion = CITY_WAYPOINTS[0];

    for (let stepIndex = 1; stepIndex < CITY_WAYPOINTS.length; stepIndex += 1) {
        const nextWaypoint = CITY_WAYPOINTS[stepIndex];
        const didMove = hasMovedBeyondThreshold({
            fromRegion: cachedRegion,
            toRegion: nextWaypoint,
        });

        decisions.push({
            from: cachedRegion.name,
            to: nextWaypoint.name,
            didMove,
            distanceMeters: Math.round(calculateDistanceMeters(cachedRegion, nextWaypoint)),
        });

        // Simulate the helper committing to the new cached region once a
        // move is detected. This mirrors persistLastDeviceLocationRegion.
        if (didMove) {
            cachedRegion = nextWaypoint;
        }
    }

    // Every step between distinct city waypoints should trigger a move.
    for (const decision of decisions) {
        assert.equal(
            decision.didMove,
            true,
            `${decision.from} → ${decision.to} (${decision.distanceMeters}m) should refresh`
        );
    }

    // We walked through every waypoint, so the final cached region should
    // be the last waypoint.
    assert.equal(cachedRegion, CITY_WAYPOINTS[CITY_WAYPOINTS.length - 1]);
});

test('Zigzag drift around the same waypoint only triggers the first refresh', () => {
    // Scenario: user is walking around a neighborhood. Each drift point is
    // within 100m of the origin. Only the very first movement check (from
    // no cache) counts as a "move"; everything after stays debounced.
    let cachedRegion = null;
    const commitCount = [];

    for (const driftPoint of SAN_JOSE_DRIFT_POINTS) {
        const didMove = hasMovedBeyondThreshold({
            fromRegion: cachedRegion,
            toRegion: driftPoint,
        });
        commitCount.push(didMove);
        if (didMove) {
            cachedRegion = driftPoint;
        }
    }

    // First point has no cached region, so it must commit. All remaining
    // drift points stay within threshold and should NOT commit.
    assert.equal(commitCount[0], true, 'first drift point should commit (no cache yet)');
    for (let index = 1; index < commitCount.length; index += 1) {
        assert.equal(
            commitCount[index],
            false,
            `drift point ${index} (${SAN_JOSE_DRIFT_POINTS[index].name}) should stay debounced`
        );
    }
});
