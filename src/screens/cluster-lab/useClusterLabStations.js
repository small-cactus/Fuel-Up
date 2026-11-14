import { onboardingHandoff } from '../../lib/onboardingHandoff';
import useNetworkStatus from '../../lib/useNetworkStatus';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { AppState } from 'react-native';
import { useAppState } from '../../AppStateContext';
import { usePreferences } from '../../PreferencesContext';
import { getLastDeviceLocationRegion } from '../../lib/deviceLocationCache';
import { flushCachedEntry, getCachedFuelPriceSnapshot, refreshFuelPriceSnapshot } from '../../services/fuel';
import { buildLabStations } from './stationCardModel';
import { buildResolvedFuelSearchContext } from '../../lib/fuelSearchState';
import { localizeStationSnapshot, stationContinuityKey, stationExpiryDelay } from './stationContinuity';

// Data crosses the bridge once per search. The Swift view owns all camera and
// animation work. The five-minute DB refresh never drives animation frames.
export default function useClusterLabStations(active) {
    const { recoveryGeneration, connected } = useNetworkStatus();
    const { resolvedFuelSearchContext, manualLocationOverride, fuelResetToken, setResolvedFuelSearchContext } = useAppState();
    const { preferences, fuelSearchCriteriaSignature } = usePreferences();
    const [result, setResult] = useState(null);
    const [mapOrigin, setMapOrigin] = useState(null);
    const committedSnapshot = useRef(null);
    const latitude = manualLocationOverride?.latitude ?? resolvedFuelSearchContext?.latitude;
    const longitude = manualLocationOverride?.longitude ?? resolvedFuelSearchContext?.longitude;
    const fuelType = preferences.preferredOctane;
    const radiusMiles = preferences.searchRadiusMiles;
    const preferredProvider = preferences.preferredProvider;
    const minimumRating = preferences.minimumRating;
    const requiresE85 = Boolean(preferences.requiresE85);
    const criteria = [fuelType, radiusMiles, preferredProvider, requiresE85, minimumRating, fuelSearchCriteriaSignature, fuelResetToken, preferences.preferredBrands, preferences.fuelMemberships];
    const scope = JSON.stringify([latitude, longitude, ...criteria]);
    const continuityKey = stationContinuityKey({ criteria, manualLocation: manualLocationOverride,
        locationSource: resolvedFuelSearchContext?.locationSource, latitude, longitude });
    const project = useCallback((origin, snapshot, e85Snapshot) => buildLabStations(
        localizeStationSnapshot(snapshot, origin),
        { origin, radiusMiles, minimumRating, fuelGrade: fuelType, requiresE85,
            preferredBrands: preferences.preferredBrands, fuelMemberships: preferences.fuelMemberships },
        localizeStationSnapshot(e85Snapshot, origin)),
    [radiusMiles, minimumRating, fuelType, requiresE85, preferences.preferredBrands, preferences.fuelMemberships]);


    useEffect(() => {
        if (!active) return;
        let cancelled = false;
        let refreshing = false;
        let expiryTimer;
        const scheduleExpiry = (origin, snapshot, e85Snapshot, stations) => {
            clearTimeout(expiryTimer);
            const delay = stationExpiryDelay(stations);
            if (delay !== null) {
                // Kept independently of cache/network completion: movement and
                // an offline refresh must not extend a reported price's lifetime.
                expiryTimer = setTimeout(() => publish(origin, snapshot, e85Snapshot), delay);
            }
        };
        const publish = (origin, snapshot, e85Snapshot) => {
            if (cancelled) return;
            const stations = project(origin, snapshot, e85Snapshot);
            const next = { scope, continuityKey, origin: { latitude: origin.latitude, longitude: origin.longitude },
                snapshot, e85Snapshot, stations, loaded: true };
            committedSnapshot.current = next;
            setResult(next);
            scheduleExpiry(origin, snapshot, e85Snapshot, stations);
        };
        const getRetained = () => committedSnapshot.current?.continuityKey === continuityKey
            ? committedSnapshot.current : null;
        const retained = getRetained();
        if (retained) {
            const origin = Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : retained.origin;
            scheduleExpiry(origin, retained.snapshot, retained.e85Snapshot, project(origin, retained.snapshot, retained.e85Snapshot));
        } else if (committedSnapshot.current) {
            // A later return to an old setting cannot resurrect its prior session.
            committedSnapshot.current = null;
            setResult(null);
        }
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
                    if (cancelled) return;
                    publish(origin, cached, cachedE85 || getRetained()?.e85Snapshot);
                }
                const primaryRefresh = refreshFuelPriceSnapshot(query);
                const extraRefresh = e85Query ? refreshFuelPriceSnapshot(e85Query).catch(error => {
                    console.warn('[Home] E85 refresh failed:', error.message);
                    return { snapshot: cachedE85 || getRetained()?.e85Snapshot };
                }) : null;
                const fresh = await primaryRefresh;
                if (cancelled) return;
                if (onboardingHandoff.getSnapshot() === 'preparing') await flushCachedEntry(fresh.snapshot.cacheKey);
                if (cancelled) return;
                publish(origin, fresh.snapshot, cachedE85 || getRetained()?.e85Snapshot);
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
                    setResult(previous => previous?.continuityKey === continuityKey && previous.loaded ? previous : {
                        scope, continuityKey, origin: null, stations: [], loaded: false, error: error.message || 'Station load failed',
                    });
                }
            } finally { refreshing = false; }
        };
        refresh();
        const timer = setInterval(refresh, 5 * 60_000);
        const subscription = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
        return () => { cancelled = true; clearInterval(timer); clearTimeout(expiryTimer); subscription.remove(); };
    }, [recoveryGeneration, connected, active, scope, continuityKey, latitude, longitude, fuelType, radiusMiles, minimumRating, preferredProvider, requiresE85, setResolvedFuelSearchContext, preferences.preferredBrands, preferences.fuelMemberships, project]);

    return useMemo(() => {
        const origin = Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } :
            mapOrigin?.scope === scope ? { latitude: mapOrigin.latitude, longitude: mapOrigin.longitude } : null;
        if (result?.continuityKey !== continuityKey) return { origin, stations: [], loaded: false };
        if (!active) return { ...result, origin: result.origin || origin };
        // Rebase and re-filter synchronously, before an asynchronous cache read.
        // Stable station IDs keep native chips and the selected card mounted.
        return { ...result, origin, stations: result.loaded && origin ? project(origin, result.snapshot, result.e85Snapshot) : [] };
    }, [result, mapOrigin, scope, continuityKey, latitude, longitude, active, project]);
}
