import AsyncStorage from '@react-native-async-storage/async-storage';

export const LAST_DEVICE_LOCATION_STORAGE_KEY = 'fuelup:last-device-location';

function parseTimestamp(rawValue) {
    const numericValue = Number(rawValue);
    if (Number.isFinite(numericValue) && numericValue > 0) {
        return numericValue;
    }

    if (typeof rawValue === 'string') {
        const parsedDate = Date.parse(rawValue);
        if (Number.isFinite(parsedDate) && parsedDate > 0) {
            return parsedDate;
        }
    }

    return null;
}

export function parseCachedDeviceLocation(rawValue) {
    if (!rawValue) {
        return null;
    }

    try {
        const parsedValue = JSON.parse(rawValue);
        const latitude = Number(parsedValue?.latitude);
        const longitude = Number(parsedValue?.longitude);
        const latitudeDelta = Number(parsedValue?.latitudeDelta);
        const longitudeDelta = Number(parsedValue?.longitudeDelta);

        if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude) ||
            !Number.isFinite(latitudeDelta) ||
            !Number.isFinite(longitudeDelta)
        ) {
            return null;
        }

        return {
            latitude,
            longitude,
            latitudeDelta,
            longitudeDelta,
        };
    } catch (error) {
        return null;
    }
}

export function parseCachedDeviceLocationSnapshot(rawValue) {
    if (!rawValue) {
        return null;
    }

    try {
        const parsedValue = JSON.parse(rawValue);
        const latitude = Number(parsedValue?.latitude);
        const longitude = Number(parsedValue?.longitude);
        const latitudeDelta = Number(parsedValue?.latitudeDelta);
        const longitudeDelta = Number(parsedValue?.longitudeDelta);

        if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude) ||
            !Number.isFinite(latitudeDelta) ||
            !Number.isFinite(longitudeDelta)
        ) {
            return null;
        }

        return {
            region: {
                latitude,
                longitude,
                latitudeDelta,
                longitudeDelta,
            },
            capturedAt: parseTimestamp(parsedValue?.capturedAt),
            capturedAccuracyMeters: Number.isFinite(Number(parsedValue?.capturedAccuracyMeters))
                ? Number(parsedValue.capturedAccuracyMeters)
                : null,
        };
    } catch (error) {
        return null;
    }
}

export async function getLastDeviceLocationRegion() {
    try {
        const rawValue = await AsyncStorage.getItem(LAST_DEVICE_LOCATION_STORAGE_KEY);
        return parseCachedDeviceLocation(rawValue);
    } catch (error) {
        return null;
    }
}

export async function getLastDeviceLocationSnapshot() {
    try {
        const rawValue = await AsyncStorage.getItem(LAST_DEVICE_LOCATION_STORAGE_KEY);
        return parseCachedDeviceLocationSnapshot(rawValue);
    } catch (error) {
        return null;
    }
}

export async function persistLastDeviceLocationRegion(nextRegion, meta = null) {
    if (!nextRegion) {
        return;
    }

    try {
        const resolvedCapturedAt = parseTimestamp(meta?.capturedAt) ?? Date.now();
        const resolvedAccuracyMeters = Number.isFinite(Number(meta?.accuracyMeters))
            ? Number(meta.accuracyMeters)
            : null;

        await AsyncStorage.setItem(
            LAST_DEVICE_LOCATION_STORAGE_KEY,
            JSON.stringify({
                latitude: nextRegion.latitude,
                longitude: nextRegion.longitude,
                latitudeDelta: nextRegion.latitudeDelta,
                longitudeDelta: nextRegion.longitudeDelta,
                capturedAt: resolvedCapturedAt,
                capturedAccuracyMeters: resolvedAccuracyMeters,
            })
        );
    } catch (error) {
        // Best-effort cache write for faster next launch.
    }
}
