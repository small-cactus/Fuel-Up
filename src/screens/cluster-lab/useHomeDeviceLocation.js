import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import { useAppState } from '../../AppStateContext';
import { usePreferences } from '../../PreferencesContext';
import { startHomeDeviceLocation } from '../../lib/homeDeviceLocation';
import { buildResolvedFuelSearchContext } from '../../lib/fuelSearchState';
import { persistLastDeviceLocationRegion } from '../../lib/deviceLocationCache';

export default function useHomeDeviceLocation(active) {
    const { manualLocationOverride, resolvedFuelSearchContext, setResolvedFuelSearchContext } = useAppState();
    const { preferences } = usePreferences();
    const latest = useRef(null);
    latest.current = { origin: resolvedFuelSearchContext, preferences };
    const manual = Boolean(manualLocationOverride);
    useEffect(() => {
        if (!active || manual) return;
        return startHomeDeviceLocation({
            Location, AppState,
            getOrigin: () => latest.current.origin,
            onLocation: fix => {
                const origin = { latitude: fix.coords.latitude, longitude: fix.coords.longitude,
                    latitudeDelta: 0.06, longitudeDelta: 0.06 };
                latest.current.origin = origin;
                setResolvedFuelSearchContext(buildResolvedFuelSearchContext({
                    origin, locationSource: 'device', ...latest.current.preferences,
                }));
                void persistLastDeviceLocationRegion(origin, { capturedAt: fix.timestamp, accuracyMeters: fix.coords.accuracy });
            },
            onError: error => console.warn('[Home] Location update failed:', error?.message || error),
        });
    }, [active, manual, setResolvedFuelSearchContext]);
}
