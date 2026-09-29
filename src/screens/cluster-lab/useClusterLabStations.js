import { useEffect, useMemo, useState } from 'react';
import * as Location from 'expo-location';
import { useAppState } from '../../AppStateContext';
import { usePreferences } from '../../PreferencesContext';
import { getLastDeviceLocationRegion } from '../../lib/deviceLocationCache';
import { getCachedFuelPriceSnapshot, refreshFuelPriceSnapshot } from '../../services/fuel';
import { buildLabStations, matchingHomeStationSnapshot } from './stationCardModel';

// Data crosses the bridge once per search. The Swift view owns all camera and
// animation work; no JS region events, timers, markers, or frame updates.
export default function useClusterLabStations(active) {
    const { resolvedFuelSearchContext, manualLocationOverride, fuelResetToken, homeStationSnapshot } = useAppState();
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

    const shared = useMemo(() => {
        const snapshot = matchingHomeStationSnapshot(homeStationSnapshot, {
            criteriaSignature: fuelSearchCriteriaSignature, fuelResetToken, latitude, longitude,
        });
        return snapshot ? { origin: snapshot.origin, stations: buildLabStations({ topStations: snapshot.quotes }) } : null;
    }, [homeStationSnapshot, fuelSearchCriteriaSignature, fuelResetToken, latitude, longitude]);

    useEffect(() => {
        if (!active || shared) return;
        let cancelled = false;
        const publish = (origin, snapshot) => {
            if (cancelled) return;
            setResult({ scope, origin: { latitude: origin.latitude, longitude: origin.longitude }, stations: buildLabStations(snapshot, { origin, radiusMiles, minimumRating, fuelGrade: fuelType, requiresE85 }) });
        };
        (async () => {
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
            const query = { latitude: origin.latitude, longitude: origin.longitude, fuelType, radiusMiles, preferredProvider, requiresE85 };
            const cached = await getCachedFuelPriceSnapshot(query);
            if (cancelled) return;
            publish(origin, cached);
            if (!cached?.topStations?.length) {
                const fresh = await refreshFuelPriceSnapshot(query);
                publish(origin, fresh.snapshot);
            }
        })().catch(error => {
            if (!cancelled) console.warn('[Glass Lab] Station load failed:', error.message);
        });
        return () => { cancelled = true; };
    }, [active, shared, scope, latitude, longitude, fuelType, radiusMiles, minimumRating, preferredProvider, requiresE85]);

    return useMemo(() => shared || (result?.scope === scope ? result : { origin: null, stations: [] }), [shared, result, scope]);
}
