import { useEffect, useState } from 'react';
import * as Location from 'expo-location';

export default function useOnboardingLocation(permissionState) {
    const [coordinate, setCoordinate] = useState(null);
    useEffect(() => {
        if (!permissionState?.foregroundGranted) { setCoordinate(null); return; }
        let cancelled = false;
        let subscription;
        const accept = fix => {
            const point = fix?.coords;
            if (!cancelled && Number.isFinite(point?.latitude) && Number.isFinite(point?.longitude)) {
                setCoordinate({ latitude: point.latitude, longitude: point.longitude });
            }
        };
        void Location.getLastKnownPositionAsync({ maxAge: 60000 }).then(accept).catch(() => {});
        void Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, distanceInterval: 25 }, accept)
            .then(result => { if (cancelled) result.remove(); else subscription = result; })
            .catch(() => {});
        return () => { cancelled = true; subscription?.remove(); };
    }, [permissionState?.foregroundGranted]);
    return coordinate;
}
