import { useEffect, useMemo, useState } from 'react';
import * as Location from 'expo-location';
import { useAppState } from '../../AppStateContext';
import { usePreferences } from '../../PreferencesContext';
import { getLastDeviceLocationRegion } from '../../lib/deviceLocationCache';
import { getCachedFuelPriceSnapshot, refreshFuelPriceSnapshot } from '../../services/fuel';
import { buildLabStations } from './stationCardModel';

// Data crosses the bridge once per search. The Swift view owns all camera and
// animation work; no JS region events, timers, markers, or frame updates.
export default function useClusterLabStations(active) {
    const { resolvedFuelSearchContext, manualLocationOverride, fuelResetToken } = useAppState();
    const { preferences } = usePreferences();
    const [result, setResult] = useState(null);
    const latitude = manualLocationOverride?.latitude ?? resolvedFuelSearchContext?.latitude;
    const longitude = manualLocationOverride?.longitude ?? resolvedFuelSearchContext?.longitude;
    const fuelType = preferences.preferredOctane;
    const radiusMiles = preferences.searchRadiusMiles;
    const preferredProvider = preferences.preferredProvider;
    const requiresE85 = Boolean(preferences.requiresE85);
    const scope = JSON.stringify([latitude, longitude, fuelType, radiusMiles, preferredProvider, requiresE85, fuelResetToken]);

    useEffect(() => {
        if (!active) return;
        let cancelled = false;
        const publish = (origin, snapshot) => {
            if (cancelled) return;
            setResult({ scope, origin: { latitude: origin.latitude, longitude: origin.longitude }, stations: buildLabStations(snapshot) });
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
    }, [active, scope, latitude, longitude, fuelType, radiusMiles, preferredProvider, requiresE85]);

    return useMemo(() => result?.scope === scope ? result : { origin: null, stations: [] }, [result, scope]);
}
