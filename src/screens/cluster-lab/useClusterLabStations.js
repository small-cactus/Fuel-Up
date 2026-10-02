import { useEffect, useMemo, useState } from 'react';
import * as Location from 'expo-location';
import { AppState } from 'react-native';
import { useAppState } from '../../AppStateContext';
import { usePreferences } from '../../PreferencesContext';
import { getLastDeviceLocationRegion } from '../../lib/deviceLocationCache';
import { getCachedFuelPriceSnapshot, refreshFuelPriceSnapshot } from '../../services/fuel';
import { buildLabStations } from './stationCardModel';
import { buildResolvedFuelSearchContext } from '../../lib/fuelSearchState';
import { REPORTED_PRICE_MAX_AGE_MS } from '../../services/fuel/reportedPrices';
import { calculateDistanceMiles } from '../../lib/homeState';

// Data crosses the bridge once per search. The Swift view owns all camera and
// animation work. The five-minute DB refresh never drives animation frames.
export default function useClusterLabStations(active) {
    const { resolvedFuelSearchContext, manualLocationOverride, fuelResetToken, setResolvedFuelSearchContext } = useAppState();
    const { preferences, fuelSearchCriteriaSignature } = usePreferences();
    const [result, setResult] = useState(null);
    const latitude = manualLocationOverride?.latitude ?? resolvedFuelSearchContext?.latitude;
    const longitude = manualLocationOverride?.longitude ?? resolvedFuelSearchContext?.longitude;
    const fuelType = preferences.preferredOctane;
    const radiusMiles = preferences.searchRadiusMiles;
    const preferredProvider = preferences.preferredProvider;
    const minimumRating = preferences.minimumRating;
    const requiresE85 = Boolean(preferences.requiresE85);
    const scope = JSON.stringify([latitude, longitude, fuelType, radiusMiles, preferredProvider, requiresE85, minimumRating, fuelSearchCriteriaSignature, fuelResetToken]);

    useEffect(() => {
        if (!active) return;
        let cancelled = false;
        let refreshing = false;
        let expiryTimer;
        const publish = (origin, snapshot) => {
            if (cancelled) return;
            // An exact-key cache hit can still come from a slightly different
            // origin. Radius filtering and cards must use this search's fix.
            const rebase = quote => quote && Number.isFinite(quote.latitude) && Number.isFinite(quote.longitude)
                ? { ...quote, distanceMiles: calculateDistanceMiles(origin, quote) } : quote;
            const localized = { ...snapshot, quote: rebase(snapshot?.quote), topStations: snapshot?.topStations?.map(rebase) };
            const stations = buildLabStations(localized, { origin, radiusMiles, minimumRating, fuelGrade: fuelType, requiresE85, preferredBrands: preferences.preferredBrands, fuelMemberships: preferences.fuelMemberships });
            setResult({ scope, origin: { latitude: origin.latitude, longitude: origin.longitude }, stations });
            clearTimeout(expiryTimer);
            const expirations = stations.map(station => Date.parse(station.updatedAt) + REPORTED_PRICE_MAX_AGE_MS).filter(Number.isFinite);
            if (expirations.length) {
                // Remove an expired price even while idle/offline. This only
                // re-filters the snapshot; it does not make a network request.
                expiryTimer = setTimeout(() => publish(origin, snapshot), Math.max(1, Math.min(...expirations) - Date.now() + 1));
            }
        };
        const refresh = async () => {
            if (refreshing || AppState.currentState === 'background') return;
            refreshing = true;
            try {
                let origin = Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } :
                    await getLastDeviceLocationRegion();
                if (cancelled) return;
                if (!origin) {
                    const permission = await Location.getForegroundPermissionsAsync();
                    if (permission.status !== 'granted' || cancelled) return;
                    const fix = await Location.getLastKnownPositionAsync() ||
                        await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
                    origin = fix.coords;
                }
                if (cancelled) return;
                if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
                    setResolvedFuelSearchContext(buildResolvedFuelSearchContext({
                        origin, locationSource: 'device', fuelGrade: fuelType, radiusMiles,
                        preferredProvider, minimumRating, preferredBrands: preferences.preferredBrands, fuelMemberships: preferences.fuelMemberships, requiresE85,
                    }));
                }
                const query = { latitude: origin.latitude, longitude: origin.longitude, fuelType, radiusMiles, preferredProvider, requiresE85 };
                const cached = await getCachedFuelPriceSnapshot(query);
                if (cancelled) return;
                if (cached) publish(origin, cached);
                const fresh = await refreshFuelPriceSnapshot(query);
                publish(origin, fresh.snapshot);
            } catch (error) {
                if (!cancelled) console.warn('[Home] Station load failed:', error.message);
            } finally { refreshing = false; }
        };
        refresh();
        const timer = setInterval(refresh, 5 * 60_000);
        const subscription = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
        return () => { cancelled = true; clearInterval(timer); clearTimeout(expiryTimer); subscription.remove(); };
    }, [active, scope, latitude, longitude, fuelType, radiusMiles, minimumRating, preferredProvider, requiresE85, setResolvedFuelSearchContext, preferences.preferredBrands, preferences.fuelMemberships]);

    return useMemo(() => result?.scope === scope ? result : { origin: null, stations: [] }, [result, scope]);
}
