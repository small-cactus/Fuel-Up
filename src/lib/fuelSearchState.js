import { normalizeFuelGrade } from './fuelGrade.js';

// The supported search radius range was determined by testing the live
// GasBuddy return set across ~20 US cities (dense urban → extreme rural).
// GasBuddy adaptively returns stations within its own cluster, so our
// `radiusMiles` is ONLY a client-side filter on the returned set:
//
//   - Urban centers (SF, NYC, LA, Sacramento) return 10–17 stations
//     with a max distance of 1.4–2.8 mi. A radius < 2 mi filters some
//     of those to zero (e.g. Sacramento, NYC, Anchorage), which is a
//     broken UX, so 2 mi is the effective minimum.
//   - Small towns (Fallon NV) return stations up to ~5 mi.
//   - Remote rural (Death Valley) returns a single station at ~12 mi.
//   - Above 15 mi we never saw any additional stations in testing, so
//     15 mi is the effective maximum. Anything larger is wasted scale.
export const DEFAULT_SEARCH_RADIUS_MILES = 10;
export const MIN_SEARCH_RADIUS_MILES = 2;
export const MAX_SEARCH_RADIUS_MILES = 15;
export const DEFAULT_PREFERRED_PROVIDER = 'gasbuddy';
export const DEFAULT_MINIMUM_RATING = 0;
export const DEFAULT_NAVIGATION_APP = 'apple-maps';
export const SUPPORTED_NAVIGATION_APPS = ['apple-maps', 'google-maps'];
const LOCATION_PRECISION = 2;

function toFiniteNumber(value) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
}

function toPositiveNumber(value) {
    const numericValue = toFiniteNumber(value);
    return numericValue !== null && numericValue > 0 ? numericValue : null;
}

export function normalizeSearchRadiusMiles(value) {
    const resolvedValue = toPositiveNumber(value) || DEFAULT_SEARCH_RADIUS_MILES;
    const rounded = Math.round(resolvedValue);
    // Clamp to the empirically-validated [MIN, MAX] range so legacy
    // preference values persisted from the old [3, 25] slider snap into
    // the new range (e.g. a stored 25 becomes 15, a stored 1 becomes 2).
    return Math.max(
        MIN_SEARCH_RADIUS_MILES,
        Math.min(MAX_SEARCH_RADIUS_MILES, rounded)
    );
}

export function normalizeMinimumRating(value) {
    return Math.max(0, toFiniteNumber(value) ?? DEFAULT_MINIMUM_RATING);
}

export function normalizePreferredProvider(value) {
    const normalizedValue = String(value || DEFAULT_PREFERRED_PROVIDER).trim().toLowerCase();
    return normalizedValue === 'all' ? 'all' : DEFAULT_PREFERRED_PROVIDER;
}

export function normalizeNavigationApp(value) {
    const normalizedValue = String(value || DEFAULT_NAVIGATION_APP).trim().toLowerCase();
    return SUPPORTED_NAVIGATION_APPS.includes(normalizedValue)
        ? normalizedValue
        : DEFAULT_NAVIGATION_APP;
}

export function normalizeFuelSearchPreferences(preferences = {}) {
    return {
        searchRadiusMiles: normalizeSearchRadiusMiles(preferences.searchRadiusMiles),
        preferredOctane: normalizeFuelGrade(preferences.preferredOctane),
        preferredProvider: normalizePreferredProvider(preferences.preferredProvider),
        minimumRating: normalizeMinimumRating(preferences.minimumRating),
        navigationApp: normalizeNavigationApp(preferences.navigationApp),
    };
}

export function buildFuelSearchCriteriaSignature({
    preferredOctane,
    fuelGrade,
    searchRadiusMiles,
    radiusMiles,
    preferredProvider,
    minimumRating = DEFAULT_MINIMUM_RATING,
}) {
    return [
        normalizeFuelGrade(preferredOctane || fuelGrade),
        normalizeSearchRadiusMiles(searchRadiusMiles ?? radiusMiles),
        normalizePreferredProvider(preferredProvider),
        normalizeMinimumRating(minimumRating).toFixed(1),
    ].join('|');
}

export function buildFuelSearchLocationKey(origin) {
    const latitude = toFiniteNumber(origin?.latitude);
    const longitude = toFiniteNumber(origin?.longitude);

    if (latitude === null || longitude === null) {
        return 'unresolved';
    }

    return `${latitude.toFixed(LOCATION_PRECISION)}:${longitude.toFixed(LOCATION_PRECISION)}`;
}

export function buildFuelSearchRequestKey({
    origin,
    preferredOctane,
    fuelGrade,
    searchRadiusMiles,
    radiusMiles,
    preferredProvider,
    minimumRating = DEFAULT_MINIMUM_RATING,
}) {
    return [
        buildFuelSearchLocationKey(origin),
        buildFuelSearchCriteriaSignature({
            preferredOctane,
            fuelGrade,
            searchRadiusMiles,
            radiusMiles,
            preferredProvider,
            minimumRating,
        }),
    ].join('|');
}

export function buildResolvedFuelSearchContext({
    origin,
    locationSource = 'device',
    preferredOctane,
    fuelGrade,
    searchRadiusMiles,
    radiusMiles,
    preferredProvider,
    minimumRating = DEFAULT_MINIMUM_RATING,
}) {
    if (!origin) {
        return null;
    }

    return {
        latitude: toFiniteNumber(origin.latitude),
        longitude: toFiniteNumber(origin.longitude),
        latitudeDelta: toFiniteNumber(origin.latitudeDelta),
        longitudeDelta: toFiniteNumber(origin.longitudeDelta),
        locationSource: String(locationSource || 'device'),
        criteriaSignature: buildFuelSearchCriteriaSignature({
            preferredOctane,
            fuelGrade,
            searchRadiusMiles,
            radiusMiles,
            preferredProvider,
            minimumRating,
        }),
        requestKey: buildFuelSearchRequestKey({
            origin,
            preferredOctane,
            fuelGrade,
            searchRadiusMiles,
            radiusMiles,
            preferredProvider,
            minimumRating,
        }),
        updatedAt: new Date().toISOString(),
    };
}

export function areFuelSearchRequestsEqual(leftRequestKey, rightRequestKey) {
    return String(leftRequestKey || '') === String(rightRequestKey || '');
}
