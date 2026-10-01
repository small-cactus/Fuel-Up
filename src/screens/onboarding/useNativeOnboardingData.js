import { useMemo } from 'react';
import useNearbyBrands from '../../components/brands/useNearbyBrands';
import useMembershipOptions from '../../components/memberships/useMembershipOptions';
import { FUEL_MEMBERSHIPS } from '../../lib/fuelMemberships';
import { buildStationBrandOptions } from '../../lib/stationPreferences';
import { MAX_SEARCH_RADIUS_MILES } from '../../lib/fuelSearchState';

// Warm the largest selectable area once. Dragging the native radius slider never
// requests data; the same inventory feeds the preview and the following page.
export default function useNativeOnboardingData(coordinate, choices) {
    const nearby = useNearbyBrands({ coordinate, radiusMiles: MAX_SEARCH_RADIUS_MILES,
        fuelGrade: choices.preferredOctane, requiresE85: choices.requiresE85, isActive: Boolean(coordinate) });
    const memberships = useMembershipOptions(coordinate, Boolean(coordinate));
    const data = useMemo(() => ({
        stations: nearby.quotes.map(quote => ({ id: String(quote.stationId), name: quote.stationName,
            latitude: quote.latitude, longitude: quote.longitude })),
        brands: buildStationBrandOptions(nearby.quotes, { ...coordinate, radiusMiles: choices.searchRadiusMiles,
            fuelGrade: choices.preferredOctane, requiresE85: choices.requiresE85 }),
        memberships: FUEL_MEMBERSHIPS.filter(item => memberships.ids?.includes(item.id)
            || choices.fuelMemberships?.includes(item.id)).map(({ id, label }) => ({ id, label })),
        loading: nearby.loading, membershipLoading: memberships.loading,
        error: nearby.error ?? null, membershipError: memberships.error ?? null,
    }), [nearby.quotes, nearby.loading, nearby.error, coordinate, choices.searchRadiusMiles,
        choices.preferredOctane, choices.requiresE85, choices.fuelMemberships, memberships.ids,
        memberships.loading, memberships.error]);
    return { data, retry: () => { nearby.retry(); memberships.retry(); } };
}
