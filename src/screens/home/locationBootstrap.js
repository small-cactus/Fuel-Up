import { LIVE_TRACKING_TRAJECTORY_MIN_SPEED_MPS } from './constants.js';
import { MAP_REGION_EPSILON } from './constants.js';
import { INITIAL_SMOOTH_LAUNCH_TRANSITION_MAX_DISTANCE_METERS } from './constants.js';
import { LOCATION_FAST_FETCH_TIMEOUT_MS } from '../../lib/locationRefresh';
import { LOCATION_LAST_KNOWN_MAX_AGE_MS } from '../../lib/locationRefresh';
import { LOCATION_LAST_KNOWN_REQUIRED_ACCURACY_METERS } from '../../lib/locationRefresh';
import { getLocationProbeLaunchOverrides } from '../../lib/locationProbeOverrides';
import { recordLocationProbeEvent } from '../../lib/locationProbe';
import * as Location from 'expo-location';
import { LOCATION_COLD_FETCH_TIMEOUT_MS } from '../../lib/locationRefresh';

export function hasUsableHomeRegion(region) {
    return Boolean(
        Number.isFinite(region?.latitude) &&
        Number.isFinite(region?.longitude)
    );
}

export function buildTrajectorySeedFromVelocity({ latitude, longitude, velocity }) {
    if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        !velocity
    ) {
        return null;
    }

    const latPerMs = Number(velocity.latPerMs);
    const lngPerMs = Number(velocity.lngPerMs);

    if (
        !Number.isFinite(latPerMs) ||
        !Number.isFinite(lngPerMs) ||
        (latPerMs === 0 && lngPerMs === 0)
    ) {
        return null;
    }

    const metersPerDegreeLatitude = 111_320;
    const metersPerDegreeLongitude = 111_320 * Math.cos((latitude * Math.PI) / 180);
    const latMetersPerSecond = latPerMs * 1000 * metersPerDegreeLatitude;
    const lngMetersPerSecond = lngPerMs * 1000 * metersPerDegreeLongitude;
    const speedMps = Math.sqrt(
        latMetersPerSecond * latMetersPerSecond +
        lngMetersPerSecond * lngMetersPerSecond
    );

    if (!Number.isFinite(speedMps) || speedMps < LIVE_TRACKING_TRAJECTORY_MIN_SPEED_MPS) {
        return null;
    }

    const courseDegreesRaw = (Math.atan2(lngMetersPerSecond, latMetersPerSecond) * 180) / Math.PI;
    const courseDegrees = ((courseDegreesRaw % 360) + 360) % 360;

    return {
        latitude,
        longitude,
        courseDegrees,
        speedMps,
    };
}

export function areRegionsEquivalent(currentRegion, nextRegion) {
    if (!currentRegion || !nextRegion) {
        return false;
    }

    return (
        Math.abs((currentRegion.latitude || 0) - (nextRegion.latitude || 0)) <= MAP_REGION_EPSILON &&
        Math.abs((currentRegion.longitude || 0) - (nextRegion.longitude || 0)) <= MAP_REGION_EPSILON &&
        Math.abs((currentRegion.latitudeDelta || 0) - (nextRegion.latitudeDelta || 0)) <= MAP_REGION_EPSILON &&
        Math.abs((currentRegion.longitudeDelta || 0) - (nextRegion.longitudeDelta || 0)) <= MAP_REGION_EPSILON
    );
}

export function getDistanceMetersBetweenRegions(fromRegion, toRegion) {
    if (!fromRegion || !toRegion) {
        return Number.POSITIVE_INFINITY;
    }

    const fromLatitude = Number(fromRegion.latitude);
    const fromLongitude = Number(fromRegion.longitude);
    const toLatitude = Number(toRegion.latitude);
    const toLongitude = Number(toRegion.longitude);

    if (
        !Number.isFinite(fromLatitude) ||
        !Number.isFinite(fromLongitude) ||
        !Number.isFinite(toLatitude) ||
        !Number.isFinite(toLongitude)
    ) {
        return Number.POSITIVE_INFINITY;
    }

    const toRadians = degrees => degrees * (Math.PI / 180);
    const earthRadiusMeters = 6371000;
    const latitudeDeltaRadians = toRadians(toLatitude - fromLatitude);
    const longitudeDeltaRadians = toRadians(toLongitude - fromLongitude);
    const fromLatitudeRadians = toRadians(fromLatitude);
    const toLatitudeRadians = toRadians(toLatitude);
    const haversineA = (
        Math.sin(latitudeDeltaRadians / 2) ** 2 +
        Math.cos(fromLatitudeRadians) *
        Math.cos(toLatitudeRadians) *
        Math.sin(longitudeDeltaRadians / 2) ** 2
    );
    const haversineC = 2 * Math.atan2(Math.sqrt(haversineA), Math.sqrt(1 - haversineA));

    return earthRadiusMeters * haversineC;
}

export function shouldAnimateSmoothLaunchTransition(fromRegion, toRegion) {
    return getDistanceMetersBetweenRegions(fromRegion, toRegion) <= INITIAL_SMOOTH_LAUNCH_TRANSITION_MAX_DISTANCE_METERS;
}

export function waitForMillisecondsWithValue(value, durationMs) {
    return new Promise(resolve => {
        setTimeout(() => resolve(value), durationMs);
    });
}

export async function fetchLastKnownPositionWithTimeout({
    timeoutMs = LOCATION_FAST_FETCH_TIMEOUT_MS,
    maxAgeMs = LOCATION_LAST_KNOWN_MAX_AGE_MS,
    requiredAccuracyMeters = LOCATION_LAST_KNOWN_REQUIRED_ACCURACY_METERS,
} = {}) {
    try {
        const launchOverrides = getLocationProbeLaunchOverrides();

        if (__DEV__ && launchOverrides.forceNullLastKnownPosition) {
            recordLocationProbeEvent({
                type: 'last-known-position-overridden-null',
            });
            return null;
        }

        const lastKnownPromise = Location
            .getLastKnownPositionAsync({
                maxAge: maxAgeMs,
                requiredAccuracy: requiredAccuracyMeters,
            })
            .catch(() => null);
        const timeoutPromise = waitForMillisecondsWithValue(null, timeoutMs);

        return await Promise.race([lastKnownPromise, timeoutPromise]);
    } catch (error) {
        return null;
    }
}

export async function fetchCurrentPositionWithTimeout({
    timeoutMs = LOCATION_COLD_FETCH_TIMEOUT_MS,
    accuracy = Location.Accuracy.Low,
} = {}) {
    try {
        recordLocationProbeEvent({
            type: 'current-position-fetch-start',
            details: {
                timeoutMs,
                accuracy,
            },
        });

        const currentPromise = Location
            .getCurrentPositionAsync({
                accuracy,
            })
            .catch(() => null);
        const timeoutPromise = waitForMillisecondsWithValue(null, timeoutMs);
        const resolvedPositionObject = await Promise.race([currentPromise, timeoutPromise]);

        recordLocationProbeEvent({
            type: 'current-position-fetch-end',
            details: {
                timeoutMs,
                accuracy,
                hasFix: Boolean(resolvedPositionObject),
            },
        });

        return resolvedPositionObject;
    } catch (error) {
        recordLocationProbeEvent({
            type: 'current-position-fetch-end',
            details: {
                timeoutMs,
                accuracy,
                hasFix: false,
                error: error?.message || String(error || 'unknown-error'),
            },
        });
        return null;
    }
}

export async function resolveLaunchMovementCheckPosition({
    currentFallbackTimeoutMs = LOCATION_COLD_FETCH_TIMEOUT_MS,
} = {}) {
    const lastKnownPositionObject = await fetchLastKnownPositionWithTimeout({
        timeoutMs: LOCATION_FAST_FETCH_TIMEOUT_MS,
        maxAgeMs: LOCATION_LAST_KNOWN_MAX_AGE_MS,
        requiredAccuracyMeters: LOCATION_LAST_KNOWN_REQUIRED_ACCURACY_METERS,
    });

    if (lastKnownPositionObject) {
        return {
            positionObject: lastKnownPositionObject,
            resolver: 'last-known',
        };
    }

    const currentPositionObject = await fetchCurrentPositionWithTimeout({
        timeoutMs: currentFallbackTimeoutMs,
        accuracy: Location.Accuracy.Low,
    });

    return {
        positionObject: currentPositionObject,
        resolver: currentPositionObject ? 'current-fallback' : 'none',
    };
}

export function startLaunchMovementCheck({
    currentFallbackTimeoutMs = LOCATION_COLD_FETCH_TIMEOUT_MS,
} = {}) {
    const fastResultPromise = fetchLastKnownPositionWithTimeout({
        timeoutMs: LOCATION_FAST_FETCH_TIMEOUT_MS,
        maxAgeMs: LOCATION_LAST_KNOWN_MAX_AGE_MS,
        requiredAccuracyMeters: LOCATION_LAST_KNOWN_REQUIRED_ACCURACY_METERS,
    }).then(lastKnownPositionObject => (
        lastKnownPositionObject
            ? {
                positionObject: lastKnownPositionObject,
                resolver: 'last-known',
            }
            : {
                positionObject: null,
                resolver: 'none',
            }
    ));

    const completionPromise = fastResultPromise.then(async (fastResult) => {
        if (fastResult.positionObject) {
            return fastResult;
        }

        const currentPositionObject = await fetchCurrentPositionWithTimeout({
            timeoutMs: currentFallbackTimeoutMs,
            accuracy: Location.Accuracy.Low,
        });

        return {
            positionObject: currentPositionObject,
            resolver: currentPositionObject ? 'current-fallback' : 'none',
        };
    });

    return {
        fastResultPromise,
        completionPromise,
    };
}
