/**
 * Movement-aware location refresh helpers.
 *
 * The Fuel Up home screen shows the user a map of nearby stations. It caches
 * the device's last known location in AsyncStorage so it can paint the map on
 * launch without waiting for GPS. The helpers in this module make it possible
 * to decide, without any background tracking or startup delay, when we should
 * quietly swap the cached location for a fresh reading and when we should
 * leave the cached location alone.
 *
 * The rules are intentionally conservative:
 *   - Distances are measured on the WGS-84 ellipsoid via the haversine
 *     formula. Any refresh decision needs a numeric distance.
 *   - Small GPS drift (< LOCATION_MOVEMENT_THRESHOLD_METERS) never triggers a
 *     fuel refetch because the set of nearby stations does not meaningfully
 *     change at that scale.
 *   - Cache staleness is bounded so that after a long idle gap we re-check the
 *     device's last known position even if the user hasn't touched the phone.
 *   - Foreground resumes have an even shorter debounce so that tapping in and
 *     out of the app does not replay the fuel fetch for every interaction.
 */

// Threshold, in meters, for what we consider "the user actually moved" when
// comparing two coordinates. Below this, we assume GPS drift and keep the
// cached region untouched. A 250m radius is larger than typical consumer GPS
// error (< 10m) and roughly covers a city block, so nearby fuel stations
// should not change materially within it.
export const LOCATION_MOVEMENT_THRESHOLD_METERS = 250;

// Maximum acceptable age for the AsyncStorage cached region before we trigger
// a background refresh on cold launch. Two minutes is long enough to keep
// launch instant during rapid app reopens and short enough that we reliably
// catch travel between sessions.
export const LOCATION_LAUNCH_STALENESS_MS = 120_000;

// Maximum acceptable gap between foreground-resume refresh checks. We only
// bother asking the OS for a new position if at least this much time has
// passed since the last successful check, so tapping in/out of the app is a
// no-op.
export const LOCATION_FOREGROUND_MIN_INTERVAL_MS = 30_000;

// Acceptable age for the iOS/Android last-known-position cache. Anything
// older than this is treated as too stale to trust. Five minutes mirrors the
// interval the OS itself uses before discarding last-known readings.
export const LOCATION_LAST_KNOWN_MAX_AGE_MS = 300_000;

// Acceptable accuracy radius for the last-known-position cache in meters.
// Readings coarser than this are rejected because they would falsely trigger
// the movement threshold when compared against precise cached coordinates.
export const LOCATION_LAST_KNOWN_REQUIRED_ACCURACY_METERS = 200;

// Maximum wall-clock time we are willing to wait for `getLastKnownPositionAsync`
// during launch before falling back to the cached region. We hard-cap this at
// 250ms to avoid perceptible startup delay.
export const LOCATION_FAST_FETCH_TIMEOUT_MS = 250;

// Maximum wall-clock time we are willing to wait for `getCurrentPositionAsync`
// when the device has no last-known reading. This only matters the first time
// the user ever opens the app, and we clip the wait to 1.5s so we never block
// the map on slow GPS.
export const LOCATION_COLD_FETCH_TIMEOUT_MS = 1500;

function degreesToRadians(value) {
    return (value * Math.PI) / 180;
}

function toFiniteNumber(value) {
    if (value === null || value === undefined) {
        return null;
    }

    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
}

/**
 * Compute the great-circle distance, in meters, between two coordinates using
 * the haversine formula. Returns `Number.POSITIVE_INFINITY` when either input
 * is missing or non-finite so callers can treat missing data as "always
 * refresh" without special casing.
 */
export function calculateDistanceMeters(fromRegion, toRegion) {
    const fromLatitude = toFiniteNumber(fromRegion?.latitude);
    const fromLongitude = toFiniteNumber(fromRegion?.longitude);
    const toLatitude = toFiniteNumber(toRegion?.latitude);
    const toLongitude = toFiniteNumber(toRegion?.longitude);

    if (
        fromLatitude === null ||
        fromLongitude === null ||
        toLatitude === null ||
        toLongitude === null
    ) {
        return Number.POSITIVE_INFINITY;
    }

    const earthRadiusMeters = 6_371_000;
    const latitudeDeltaRadians = degreesToRadians(toLatitude - fromLatitude);
    const longitudeDeltaRadians = degreesToRadians(toLongitude - fromLongitude);
    const fromLatitudeRadians = degreesToRadians(fromLatitude);
    const toLatitudeRadians = degreesToRadians(toLatitude);
    const haversineA = (
        Math.sin(latitudeDeltaRadians / 2) ** 2 +
        Math.cos(fromLatitudeRadians) *
        Math.cos(toLatitudeRadians) *
        Math.sin(longitudeDeltaRadians / 2) ** 2
    );
    const haversineC = 2 * Math.atan2(Math.sqrt(haversineA), Math.sqrt(1 - haversineA));

    return earthRadiusMeters * haversineC;
}

/**
 * Decide whether a new region meaningfully differs from the cached one. Used
 * to gate fuel refetches and map re-animations. Returns `false` when the
 * caller supplies identical coordinates or coordinates whose haversine
 * distance is less than the configured threshold.
 */
export function hasMovedBeyondThreshold({
    fromRegion,
    toRegion,
    thresholdMeters = LOCATION_MOVEMENT_THRESHOLD_METERS,
}) {
    if (!fromRegion || !toRegion) {
        return true;
    }

    const numericThreshold = toFiniteNumber(thresholdMeters);

    if (numericThreshold === null || numericThreshold < 0) {
        return true;
    }

    return calculateDistanceMeters(fromRegion, toRegion) > numericThreshold;
}

/**
 * Decide whether a cached-region timestamp is old enough to warrant a fresh
 * position check. Falsy timestamps are treated as stale because there is no
 * evidence the cache is current.
 */
export function isCachedLocationStale({
    capturedAt,
    nowMs = Date.now(),
    maxAgeMs = LOCATION_LAUNCH_STALENESS_MS,
}) {
    const numericCapturedAt = toFiniteNumber(capturedAt);

    if (numericCapturedAt === null || numericCapturedAt <= 0) {
        return true;
    }

    const numericNow = toFiniteNumber(nowMs) ?? Date.now();
    const numericMaxAge = toFiniteNumber(maxAgeMs);

    if (numericMaxAge === null || numericMaxAge < 0) {
        return true;
    }

    return (numericNow - numericCapturedAt) >= numericMaxAge;
}

/**
 * Decide whether we should issue a new last-known-position check after a
 * foreground resume. Returns `true` when enough time has elapsed since the
 * last recorded check, or when there is no prior check on record.
 */
export function shouldCheckOnForegroundResume({
    lastCheckAt,
    nowMs = Date.now(),
    minIntervalMs = LOCATION_FOREGROUND_MIN_INTERVAL_MS,
}) {
    const numericLastCheck = toFiniteNumber(lastCheckAt);

    if (numericLastCheck === null || numericLastCheck <= 0) {
        return true;
    }

    const numericNow = toFiniteNumber(nowMs) ?? Date.now();
    const numericMinInterval = toFiniteNumber(minIntervalMs);

    if (numericMinInterval === null || numericMinInterval < 0) {
        return true;
    }

    return (numericNow - numericLastCheck) >= numericMinInterval;
}

/**
 * Decide whether we should issue a launch-time fast position check. The
 * answer is `true` when there is no cached region, or when the cached
 * region's timestamp is older than the launch staleness budget. Callers
 * should still run the fast check inside a timeout-guarded race so the map
 * paints immediately regardless.
 */
export function shouldCheckOnLaunch({
    cachedCapturedAt,
    nowMs = Date.now(),
    maxAgeMs = LOCATION_LAUNCH_STALENESS_MS,
}) {
    return isCachedLocationStale({
        capturedAt: cachedCapturedAt,
        nowMs,
        maxAgeMs,
    });
}

/**
 * Normalize an `expo-location` LocationObject into the `{latitude, longitude,
 * latitudeDelta, longitudeDelta}` region shape used throughout the app. The
 * default delta matches DEFAULT_REGION so callers can apply the region
 * directly to map state.
 */
export function buildRegionFromLocation(location, { latitudeDelta = 0.05, longitudeDelta = 0.05 } = {}) {
    const latitude = toFiniteNumber(location?.coords?.latitude);
    const longitude = toFiniteNumber(location?.coords?.longitude);

    if (latitude === null || longitude === null) {
        return null;
    }

    return {
        latitude,
        longitude,
        latitudeDelta,
        longitudeDelta,
    };
}
