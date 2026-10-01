import { useCallback, useEffect, useMemo, useState } from 'react';
import { getCachedFuelPriceSnapshot, refreshFuelPriceSnapshot } from '../../services/fuel';
import { buildStationBrandOptions } from '../../lib/stationPreferences';

const EMPTY_QUOTES = [];
export default function useNearbyBrands({ coordinate, radiusMiles, fuelGrade, requiresE85, isActive = true }) {
    const latitude = coordinate?.latitude;
    const longitude = coordinate?.longitude;
    const hasLocation = Number.isFinite(latitude) && Number.isFinite(longitude)
        && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
    const queryKey = hasLocation ? `${latitude}|${longitude}|${radiusMiles}|${fuelGrade}|${Boolean(requiresE85)}` : '';
    const [result, setResult] = useState({ key: '', quotes: EMPTY_QUOTES, loading: false, error: null });
    const [attempt, setAttempt] = useState(0);
    const retry = useCallback(() => setAttempt(value => value + 1), []);
    useEffect(() => {
        if (!isActive || !hasLocation) return;
        let cancelled = false;
        const query = { latitude, longitude, radiusMiles, fuelType: fuelGrade, preferredProvider: 'gasbuddy', requiresE85: Boolean(requiresE85) };
        setResult(previous => ({ key: queryKey, quotes: previous.key === queryKey ? previous.quotes : EMPTY_QUOTES, loading: true, error: null }));
        void (async () => {
            try {
                const cached = await getCachedFuelPriceSnapshot(query).catch(() => null);
                if (cancelled) return;
                if (cached?.topStations?.length) {
                    setResult({ key: queryKey, quotes: cached.topStations, loading: true, error: null });
                }
                const fresh = await refreshFuelPriceSnapshot(query);
                if (!cancelled) setResult({ key: queryKey, quotes: fresh?.snapshot?.topStations || EMPTY_QUOTES, loading: false, error: null });
            } catch {
                if (!cancelled) setResult(previous => ({ ...previous, loading: false, error: 'Could not refresh nearby brands. Please try again.' }));
            }
        })();
        return () => { cancelled = true; };
    }, [isActive, hasLocation, latitude, longitude, radiusMiles, fuelGrade, requiresE85, queryKey, attempt]);
    const quotes = result.key === queryKey ? result.quotes : EMPTY_QUOTES;
    const options = useMemo(() => buildStationBrandOptions(quotes, {
        latitude, longitude, radiusMiles, fuelGrade, requiresE85,
    }), [quotes, latitude, longitude, radiusMiles, fuelGrade, requiresE85]);
    return { options, quotes, hasLocation, loading: hasLocation && isActive && (result.key !== queryKey || result.loading),
        error: result.key === queryKey ? result.error : null, retry };
}
