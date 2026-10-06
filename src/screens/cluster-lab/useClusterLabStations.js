import { onboardingHandoff } from '../../lib/onboardingHandoff';
import useNetworkStatus from '../../lib/useNetworkStatus';
import { useEffect, useMemo, useState } from 'react';
import * as Location from 'expo-location';
import { AppState } from 'react-native';
import { useAppState } from '../../AppStateContext';
import { usePreferences } from '../../PreferencesContext';
import { getLastDeviceLocationRegion } from '../../lib/deviceLocationCache';
import { flushCachedEntry, getCachedFuelPriceSnapshot, refreshFuelPriceSnapshot } from '../../services/fuel';
import { buildLabStations } from './stationCardModel';
import { buildResolvedFuelSearchContext } from '../../lib/fuelSearchState';
import { REPORTED_PRICE_MAX_AGE_MS } from '../../services/fuel/reportedPrices';
import { calculateDistanceMiles } from '../../lib/homeState';

// Data crosses the bridge once per search. The Swift view owns all camera and
// animation work. The five-minute DB refresh never drives animation frames.
export default function useClusterLabStations(active) {
    const { recoveryGeneration, connected } = useNetworkStatus();
    const { resolvedFuelSearchContext, manualLocationOverride, fuelResetToken, setResolvedFuelSearchContext } = useAppState();
    const { preferences, fuelSearchCriteriaSignature } = usePreferences();
    const [result, setResult] = useState(null);
    const [mapOrigin, setMapOrigin] = useState(null);
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
        const publish = (origin, snapshot, e85Snapshot) => {
            if (cancelled) return;
            // An exact-key cache hit can still come from a slightly different
            // origin. Radius filtering and cards must use this search's fix.
            const rebase = quote => quote && Number.isFinite(quote.latitude) && Number.isFinite(quote.longitude)
                ? { ...quote, distanceMiles: calculateDistanceMiles(origin, quote) } : quote;
            const localized = { ...snapshot, quote: rebase(snapshot?.quote), topStations: snapshot?.topStations?.map(rebase) };
            const extra = { ...e85Snapshot, quote: rebase(e85Snapshot?.quote), topStations: e85Snapshot?.topStations?.map(rebase) };
            const stations = buildLabStations(localized, { origin, radiusMiles, minimumRating, fuelGrade: fuelType, requiresE85, preferredBrands: preferences.preferredBrands, fuelMemberships: preferences.fuelMemberships }, extra);
            setResult({ scope, origin: { latitude: origin.latitude, longitude: origin.longitude }, stations, loaded: true });
            clearTimeout(expiryTimer);
            const expirations = stations.flatMap(station => [station.updatedAt, station.secondaryUpdatedAt].map(date => Date.parse(date) + REPORTED_PRICE_MAX_AGE_MS)).filter(Number.isFinite);
            if (expirations.length) {
                // Remove an expired price even while idle/offline. This only
                // re-filters the snapshot; it does not make a network request.
                expiryTimer = setTimeout(() => publish(origin, snapshot, e85Snapshot), Math.max(1, Math.min(...expirations) - Date.now() + 1));
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
                // Start MapKit tiles immediately, independently of price storage/network.
                setMapOrigin({ scope, latitude: origin.latitude, longitude: origin.longitude });
                const query = { latitude: origin.latitude, longitude: origin.longitude, fuelType, radiusMiles, preferredProvider, requiresE85: false };
                const e85Query = requiresE85 && fuelType !== 'e85' ? { ...query, fuelType: 'e85' } : null;
                const [cached, cachedE85] = await Promise.all([getCachedFuelPriceSnapshot(query), e85Query ? getCachedFuelPriceSnapshot(e85Query) : null]);
                if (cancelled) return;
                if (cached && (onboardingHandoff.getSnapshot() === 'idle' || cached.isFresh === true)) {
                    if (onboardingHandoff.getSnapshot() === 'preparing') await flushCachedEntry(cached.cacheKey);
                    publish(origin, cached, cachedE85);
                }
                const primaryRefresh = refreshFuelPriceSnapshot(query);
                const extraRefresh = e85Query ? refreshFuelPriceSnapshot(e85Query).catch(error => {
                    console.warn('[Home] E85 refresh failed:', error.message);
                    return { snapshot: cachedE85 };
                }) : null;
                const fresh = await primaryRefresh;
                if (cancelled) return;
                if (onboardingHandoff.getSnapshot() === 'preparing') await flushCachedEntry(fresh.snapshot.cacheKey);
                publish(origin, fresh.snapshot, cachedE85);
                // E85 is additive: a slower secondary request cannot hold up
                // ordinary gasoline results or erase them on failure.
                if (extraRefresh) {
                    const extra = await extraRefresh;
                    if (cancelled) return;
                    if (onboardingHandoff.getSnapshot() === 'preparing' && extra?.snapshot?.cacheKey) {
                        await flushCachedEntry(extra.snapshot.cacheKey);
                    }
                    publish(origin, fresh.snapshot, extra?.snapshot);
                }
            } catch (error) {
                if (!cancelled) {
                    console.warn('[Home] Station load failed:', error.message);
                    setResult(previous => previous?.scope === scope ? previous : {
                        scope, origin: null, stations: [], loaded: false, error: error.message || 'Station load failed',
                    });
                }
            } finally { refreshing = false; }
        };
        refresh();
        const timer = setInterval(refresh, 5 * 60_000);
        const subscription = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
        return () => { cancelled = true; clearInterval(timer); clearTimeout(expiryTimer); subscription.remove(); };
    }, [recoveryGeneration, connected, active, scope, latitude, longitude, fuelType, radiusMiles, minimumRating, preferredProvider, requiresE85, setResolvedFuelSearchContext, preferences.preferredBrands, preferences.fuelMemberships]);

    return useMemo(() => result?.scope === scope ? {
        ...result, origin: result.origin || (mapOrigin?.scope === scope ? mapOrigin : null),
    } : {
        origin: mapOrigin?.scope === scope ? { latitude: mapOrigin.latitude, longitude: mapOrigin.longitude } : null, stations: [], loaded: false,
    }, [result, mapOrigin, scope]);
}
