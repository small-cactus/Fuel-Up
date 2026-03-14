import { normalizeFuelGrade } from './fuelGrade.js';

export const DEFAULT_SEARCH_RADIUS_MILES = 10;
export const DEFAULT_PREFERRED_PROVIDER = 'primary';
export const DEFAULT_MINIMUM_RATING = 0;
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
    return Math.max(1, Math.round(toPositiveNumber(value) || DEFAULT_SEARCH_RADIUS_MILES));
}

export function normalizeMinimumRating(value) {
    return Math.max(0, toFiniteNumber(value) ?? DEFAULT_MINIMUM_RATING);
}

export function normalizePreferredProvider(value) {
    const normalizedValue = String(value || DEFAULT_PREFERRED_PROVIDER).trim().toLowerCase();
    return normalizedValue === 'all' ? 'all' : DEFAULT_PREFERRED_PROVIDER;
}

export function normalizeFuelSearchPreferences(preferences = {}) {
    return {
        searchRadiusMiles: normalizeSearchRadiusMiles(preferences.searchRadiusMiles),
        preferredOctane: normalizeFuelGrade(preferences.preferredOctane),
        preferredProvider: normalizePreferredProvider(preferences.preferredProvider),
        minimumRating: normalizeMinimumRating(preferences.minimumRating),
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
