import { hasMovedBeyondThreshold } from './locationRefresh.js';

// One foreground subscription for Home. Cached search coordinates are only a
// launch seed, never a substitute for asking Core Location for a new fix.
export function startHomeDeviceLocation({ Location, AppState, getOrigin, onLocation, onError = () => {}, now = Date.now }) {
    let disposed = false;
    let generation = 0;
    let watch;
    let newestTimestamp = 0;
    const stopWatch = () => {
        generation += 1;
        watch?.remove();
        watch = null;
    };
    const start = async () => {
        stopWatch();
        const run = generation;
        const live = () => !disposed && run === generation && AppState.currentState !== 'background';
        const accept = fix => {
            if (!live()) return;
            const { latitude, longitude } = fix?.coords || {};
            const timestamp = fix?.timestamp;
            if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return;
            if (!Number.isFinite(timestamp) || timestamp < newestTimestamp || now() - timestamp > 120_000) return;
            newestTimestamp = timestamp;
            if (hasMovedBeyondThreshold({ fromRegion: getOrigin(), toRegion: fix.coords, thresholdMeters: 100 })) onLocation(fix);
        };
        try {
            const permission = await Location.getForegroundPermissionsAsync();
            if (!live() || permission.status !== 'granted') return;
            // Do not let a slow one-shot fix delay movement updates; a later,
            // older result cannot overwrite a newer subscription sample.
            void Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).then(accept).catch(onError);
            const nextWatch = await Location.watchPositionAsync({
                accuracy: Location.Accuracy.Balanced, distanceInterval: 100, timeInterval: 5000,
            }, accept, onError);
            if (live()) watch = nextWatch;
            else nextWatch.remove();
        } catch (error) { if (live()) onError(error); }
    };
    if (AppState.currentState !== 'background') void start();
    const listener = AppState.addEventListener('change', state => {
        if (state === 'active') void start();
        else if (state === 'background') stopWatch();
    });
    return () => { disposed = true; stopWatch(); listener.remove(); };
}
