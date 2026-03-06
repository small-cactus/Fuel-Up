import AsyncStorage from '@react-native-async-storage/async-storage';

export const LAST_DEVICE_LOCATION_STORAGE_KEY = 'fuelup:last-device-location';

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

export async function getLastDeviceLocationRegion() {
    try {
        const rawValue = await AsyncStorage.getItem(LAST_DEVICE_LOCATION_STORAGE_KEY);
        return parseCachedDeviceLocation(rawValue);
    } catch (error) {
        return null;
    }
}

export async function persistLastDeviceLocationRegion(nextRegion) {
    if (!nextRegion) {
        return;
    }

    try {
        await AsyncStorage.setItem(
            LAST_DEVICE_LOCATION_STORAGE_KEY,
            JSON.stringify({
                latitude: nextRegion.latitude,
                longitude: nextRegion.longitude,
                latitudeDelta: nextRegion.latitudeDelta,
                longitudeDelta: nextRegion.longitudeDelta,
            })
        );
    } catch (error) {
        // Best-effort cache write for faster next launch.
    }
}
