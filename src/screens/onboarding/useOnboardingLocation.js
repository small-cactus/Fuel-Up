import { useEffect, useState } from 'react';
import * as Location from 'expo-location';

export default function useOnboardingLocation(permissionState) {
    const [coordinate, setCoordinate] = useState(null);
    useEffect(() => {
        if (!permissionState?.foregroundGranted) { setCoordinate(null); return; }
        let cancelled = false;
        let subscription;
        let receivedLiveFix = false;
        let newestTimestamp = -Infinity;
        const accept = (fix, isLive = false) => {
            const point = fix?.coords;
            if (cancelled || !Number.isFinite(point?.latitude) || !Number.isFinite(point?.longitude)
                || Math.abs(point.latitude) > 90 || Math.abs(point.longitude) > 180) return;
            if (!isLive && receivedLiveFix) return;
            const timestamp = Number.isFinite(fix.timestamp) ? fix.timestamp : null;
            if (timestamp !== null && timestamp < newestTimestamp) return;
            if (isLive) receivedLiveFix = true;
            if (timestamp !== null) newestTimestamp = timestamp;
            setCoordinate(previous => previous?.latitude === point.latitude && previous?.longitude === point.longitude
                ? previous : { latitude: point.latitude, longitude: point.longitude });
        };
        void Location.getLastKnownPositionAsync({ maxAge: 60000 }).then(accept).catch(() => {});
        void Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, distanceInterval: 25 }, fix => accept(fix, true))
            .then(result => { if (cancelled) result.remove(); else subscription = result; })
            .catch(() => {});
        return () => { cancelled = true; subscription?.remove(); };
    }, [permissionState?.foregroundGranted]);
    return coordinate;
}
