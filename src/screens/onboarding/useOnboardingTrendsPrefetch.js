import { useCallback, useEffect } from 'react';
import { normalizeFuelSearchPreferences } from '../../lib/fuelSearchState';
import { buildTrendRequestKey, getCachedTrendData, getLastTrendsScreenViewedAt,
    prefetchTrendData } from '../../services/fuel/trends';
import { prefetchNationalTrends } from '../../services/fuel/nationalTrendsCache';

export function warmOnboardingTrends(coordinate, choices, resetToken) {
    const preferences = normalizeFuelSearchPreferences(choices);
    const { preferredOctane: fuelType, searchRadiusMiles: radiusMiles, ...filters } = preferences;
    const requests = [prefetchNationalTrends({ fuelType, requiresE85: filters.requiresE85, resetToken })];
    if (Number.isFinite(coordinate?.latitude) && Number.isFinite(coordinate?.longitude)) {
        const params = { ...coordinate, ...filters, fuelType, radiusMiles };
        const key = buildTrendRequestKey(params);
        const age = Date.now() - getLastTrendsScreenViewedAt(key);
        if (!getCachedTrendData(key) || age < 0 || age >= 5 * 60000) {
            requests.push(prefetchTrendData(params));
        }
    }
    // Speculative loading must never prevent saving or surface an onboarding
    // error. Trends retains its ordinary retry/refresh path if a request fails.
    return Promise.allSettled(requests);
}

export default function useOnboardingTrendsPrefetch(coordinate, choices, resetToken, ready) {
    // Serialize normalized values so native location/choice events with identical
    // values do not restart the debounce or issue another request.
    const signature = JSON.stringify([coordinate, normalizeFuelSearchPreferences(choices), resetToken]);
    useEffect(() => {
        if (!ready) return;
        const [origin, preferences, generation] = JSON.parse(signature);
        const timer = setTimeout(() => { void warmOnboardingTrends(origin, preferences, generation); }, 800);
        return () => clearTimeout(timer);
    }, [signature, ready]);
    // Save may arrive before the debounce fires. Start the final selection now,
    // reusing completed/in-flight requests, without holding up the Home reveal.
    return useCallback(finalChoices => {
        void warmOnboardingTrends(coordinate, finalChoices, resetToken);
    }, [coordinate, resetToken]);
}
