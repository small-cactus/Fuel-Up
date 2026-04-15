import test from 'node:test';
import assert from 'node:assert/strict';

import {
    LOCATION_FOREGROUND_MIN_INTERVAL_MS,
    LOCATION_LAUNCH_STALENESS_MS,
    LOCATION_MOVEMENT_THRESHOLD_METERS,
    buildRegionFromLocation,
    calculateDistanceMeters,
    hasMovedBeyondThreshold,
    isCachedLocationStale,
    shouldCheckOnForegroundResume,
    shouldCheckOnLaunch,
} from '../src/lib/locationRefresh.js';

const SAN_JOSE_DOWNTOWN = { latitude: 37.3346, longitude: -121.8910 };
const SAN_JOSE_DIRIDON = { latitude: 37.3296, longitude: -121.9020 };
const SUNNYVALE_DOWNTOWN = { latitude: 37.3713, longitude: -122.0389 };
const OAKLAND_DOWNTOWN = { latitude: 37.8044, longitude: -122.2712 };

function metersBetween(from, to) {
    return calculateDistanceMeters(from, to);
}

test('calculateDistanceMeters returns infinity when any coordinate is missing or invalid', () => {
    assert.equal(calculateDistanceMeters(null, SAN_JOSE_DOWNTOWN), Number.POSITIVE_INFINITY);
    assert.equal(calculateDistanceMeters(SAN_JOSE_DOWNTOWN, null), Number.POSITIVE_INFINITY);
    assert.equal(
        calculateDistanceMeters({ latitude: 'abc', longitude: 10 }, SAN_JOSE_DOWNTOWN),
        Number.POSITIVE_INFINITY
    );
    assert.equal(
        calculateDistanceMeters(SAN_JOSE_DOWNTOWN, { latitude: 40, longitude: null }),
        Number.POSITIVE_INFINITY
    );
});

test('calculateDistanceMeters agrees with well-known distances between city points', () => {
    const sameSpotDistance = metersBetween(SAN_JOSE_DOWNTOWN, SAN_JOSE_DOWNTOWN);
    assert.ok(sameSpotDistance < 0.001, `same-spot distance should be ~0, got ${sameSpotDistance}`);

    const diridonDistance = metersBetween(SAN_JOSE_DOWNTOWN, SAN_JOSE_DIRIDON);
    assert.ok(
        diridonDistance > 900 && diridonDistance < 1500,
        `SJ downtown → Diridon should be ~1 km, got ${diridonDistance} m`
    );

    const sunnyvaleDistance = metersBetween(SAN_JOSE_DOWNTOWN, SUNNYVALE_DOWNTOWN);
    assert.ok(
        sunnyvaleDistance > 13_000 && sunnyvaleDistance < 15_000,
        `SJ downtown → Sunnyvale should be ~14 km, got ${sunnyvaleDistance} m`
    );

    const oaklandDistance = metersBetween(SAN_JOSE_DOWNTOWN, OAKLAND_DOWNTOWN);
    assert.ok(
        oaklandDistance > 55_000 && oaklandDistance < 65_000,
        `SJ downtown → Oakland should be ~60 km, got ${oaklandDistance} m`
    );
});

test('hasMovedBeyondThreshold treats identical regions as not moved', () => {
    assert.equal(
        hasMovedBeyondThreshold({
            fromRegion: SAN_JOSE_DOWNTOWN,
            toRegion: { ...SAN_JOSE_DOWNTOWN },
        }),
        false
    );
});

test('hasMovedBeyondThreshold ignores sub-threshold GPS drift', () => {
    const driftRegion = {
        latitude: SAN_JOSE_DOWNTOWN.latitude + 0.0005,
        longitude: SAN_JOSE_DOWNTOWN.longitude + 0.0005,
    };

    const driftMeters = metersBetween(SAN_JOSE_DOWNTOWN, driftRegion);
    assert.ok(
        driftMeters < LOCATION_MOVEMENT_THRESHOLD_METERS,
        `fixture drift must be < threshold, got ${driftMeters} m`
    );

    assert.equal(
        hasMovedBeyondThreshold({
            fromRegion: SAN_JOSE_DOWNTOWN,
            toRegion: driftRegion,
        }),
        false
    );
});

test('hasMovedBeyondThreshold flags real movement between city neighborhoods', () => {
    assert.equal(
        hasMovedBeyondThreshold({
            fromRegion: SAN_JOSE_DOWNTOWN,
            toRegion: SAN_JOSE_DIRIDON,
        }),
        true
    );
});

test('hasMovedBeyondThreshold flags long-distance moves between cities', () => {
    assert.equal(
        hasMovedBeyondThreshold({
            fromRegion: SAN_JOSE_DOWNTOWN,
            toRegion: OAKLAND_DOWNTOWN,
        }),
        true
    );
});

test('hasMovedBeyondThreshold treats missing regions as moved so callers refetch safely', () => {
    assert.equal(
        hasMovedBeyondThreshold({
            fromRegion: null,
            toRegion: SAN_JOSE_DOWNTOWN,
        }),
        true
    );
    assert.equal(
        hasMovedBeyondThreshold({
            fromRegion: SAN_JOSE_DOWNTOWN,
            toRegion: null,
        }),
        true
    );
});

test('hasMovedBeyondThreshold honors a custom threshold', () => {
    const tenMeterRegion = {
        latitude: SAN_JOSE_DOWNTOWN.latitude + 0.0001,
        longitude: SAN_JOSE_DOWNTOWN.longitude + 0.0001,
    };

    assert.equal(
        hasMovedBeyondThreshold({
            fromRegion: SAN_JOSE_DOWNTOWN,
            toRegion: tenMeterRegion,
            thresholdMeters: 5,
        }),
        true
    );

    assert.equal(
        hasMovedBeyondThreshold({
            fromRegion: SAN_JOSE_DOWNTOWN,
            toRegion: tenMeterRegion,
            thresholdMeters: 500,
        }),
        false
    );
});

test('isCachedLocationStale treats missing or invalid timestamps as stale', () => {
    const now = 1_700_000_000_000;

    assert.equal(isCachedLocationStale({ capturedAt: null, nowMs: now }), true);
    assert.equal(isCachedLocationStale({ capturedAt: undefined, nowMs: now }), true);
    assert.equal(isCachedLocationStale({ capturedAt: 0, nowMs: now }), true);
    assert.equal(isCachedLocationStale({ capturedAt: 'nope', nowMs: now }), true);
});

test('isCachedLocationStale returns false within the launch staleness window', () => {
    const now = 1_700_000_000_000;

    assert.equal(
        isCachedLocationStale({
            capturedAt: now - 1_000,
            nowMs: now,
        }),
        false
    );
    assert.equal(
        isCachedLocationStale({
            capturedAt: now - (LOCATION_LAUNCH_STALENESS_MS - 1),
            nowMs: now,
        }),
        false
    );
});

test('isCachedLocationStale returns true at or beyond the launch staleness window', () => {
    const now = 1_700_000_000_000;

    assert.equal(
        isCachedLocationStale({
            capturedAt: now - LOCATION_LAUNCH_STALENESS_MS,
            nowMs: now,
        }),
        true
    );
    assert.equal(
        isCachedLocationStale({
            capturedAt: now - (LOCATION_LAUNCH_STALENESS_MS * 10),
            nowMs: now,
        }),
        true
    );
});

test('shouldCheckOnForegroundResume debounces rapid tab switches', () => {
    const now = 1_700_000_000_000;

    assert.equal(
        shouldCheckOnForegroundResume({
            lastCheckAt: now - 1_000,
            nowMs: now,
        }),
        false
    );

    assert.equal(
        shouldCheckOnForegroundResume({
            lastCheckAt: now - (LOCATION_FOREGROUND_MIN_INTERVAL_MS - 1),
            nowMs: now,
        }),
        false
    );
});

test('shouldCheckOnForegroundResume returns true after the debounce window closes', () => {
    const now = 1_700_000_000_000;

    assert.equal(
        shouldCheckOnForegroundResume({
            lastCheckAt: now - LOCATION_FOREGROUND_MIN_INTERVAL_MS,
            nowMs: now,
        }),
        true
    );

    assert.equal(
        shouldCheckOnForegroundResume({
            lastCheckAt: 0,
            nowMs: now,
        }),
        true
    );

    assert.equal(
        shouldCheckOnForegroundResume({
            lastCheckAt: null,
            nowMs: now,
        }),
        true
    );
});

test('shouldCheckOnLaunch mirrors isCachedLocationStale', () => {
    const now = 1_700_000_000_000;

    assert.equal(
        shouldCheckOnLaunch({
            cachedCapturedAt: null,
            nowMs: now,
        }),
        true
    );
    assert.equal(
        shouldCheckOnLaunch({
            cachedCapturedAt: now - 1_000,
            nowMs: now,
        }),
        false
    );
    assert.equal(
        shouldCheckOnLaunch({
            cachedCapturedAt: now - (LOCATION_LAUNCH_STALENESS_MS + 1),
            nowMs: now,
        }),
        true
    );
});

test('buildRegionFromLocation normalizes expo-location coordinates into region shape', () => {
    const region = buildRegionFromLocation({
        coords: {
            latitude: 37.3346,
            longitude: -121.8910,
            accuracy: 5,
        },
    });

    assert.deepEqual(region, {
        latitude: 37.3346,
        longitude: -121.8910,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
    });
});

test('buildRegionFromLocation returns null for malformed location objects', () => {
    assert.equal(buildRegionFromLocation(null), null);
    assert.equal(buildRegionFromLocation({}), null);
    assert.equal(buildRegionFromLocation({ coords: {} }), null);
    assert.equal(
        buildRegionFromLocation({
            coords: { latitude: NaN, longitude: -121 },
        }),
        null
    );
});

test('buildRegionFromLocation honors custom latitudeDelta / longitudeDelta', () => {
    const region = buildRegionFromLocation(
        {
            coords: {
                latitude: 37.3346,
                longitude: -121.8910,
            },
        },
        {
            latitudeDelta: 0.12,
            longitudeDelta: 0.34,
        }
    );

    assert.deepEqual(region, {
        latitude: 37.3346,
        longitude: -121.8910,
        latitudeDelta: 0.12,
        longitudeDelta: 0.34,
    });
});
