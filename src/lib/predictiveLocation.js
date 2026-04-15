import { Linking, Platform } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

export const PREDICTIVE_LOCATION_TASK_NAME = 'fuelup.predictive-location-updates';
export const PREDICTIVE_GEOFENCING_TASK_NAME = 'fuelup.predictive-geofencing';

const backgroundLocationListeners = new Set();
const geofencingListeners = new Set();

const DEFAULT_BACKGROUND_LOCATION_OPTIONS = Object.freeze({
    accuracy: Location.Accuracy.BestForNavigation,
    activityType: Location.ActivityType.AutomotiveNavigation,
    distanceInterval: 25,
    deferredUpdatesDistance: 50,
    deferredUpdatesInterval: 60_000,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
        notificationTitle: 'Fuel Up is tracking fuel opportunities',
        notificationBody: 'Background location stays on so Fuel Up can predict the best stop.',
        killServiceOnDestroy: false,
    },
});

function emitTaskPayload(listeners, payload) {
    listeners.forEach(listener => {
        try {
            listener(payload);
        } catch (error) {
            console.error('Predictive location listener failed:', error);
        }
    });
}

function normalizePermissionState({
    foreground,
    background,
    servicesEnabled,
    backgroundCapabilityAvailable,
}) {
    const foregroundGranted = foreground?.status === 'granted';
    const preciseLocationGranted = Platform.OS === 'ios'
        ? foreground?.ios?.accuracy !== 'reduced'
        : true;
    const backgroundGranted = background?.status === 'granted' || foreground?.ios?.scope === 'always';
    const needsSettings = (
        !servicesEnabled ||
        (foregroundGranted && backgroundCapabilityAvailable && !backgroundGranted) ||
        (Platform.OS === 'ios' && foregroundGranted && !preciseLocationGranted) ||
        (!foregroundGranted && foreground?.canAskAgain === false) ||
        (backgroundCapabilityAvailable && !backgroundGranted && background?.canAskAgain === false)
    );

    return {
        servicesEnabled,
        foreground,
        background,
        backgroundCapabilityAvailable,
        foregroundGranted,
        backgroundGranted,
        preciseLocationGranted,
        isReady: (
            servicesEnabled &&
            foregroundGranted &&
            preciseLocationGranted &&
            (!backgroundCapabilityAvailable || backgroundGranted)
        ),
        needsSettings,
    };
}

async function getBackgroundCapabilityAvailabilityAsync() {
    try {
        return await Location.isBackgroundLocationAvailableAsync();
    } catch (error) {
        return false;
    }
}

export async function getPredictiveLocationPermissionStateAsync() {
    const [
        servicesEnabled,
        foreground,
        background,
        backgroundCapabilityAvailable,
    ] = await Promise.all([
        Location.hasServicesEnabledAsync(),
        Location.getForegroundPermissionsAsync(),
        Location.getBackgroundPermissionsAsync(),
        getBackgroundCapabilityAvailabilityAsync(),
    ]);

    return normalizePermissionState({
        foreground,
        background,
        servicesEnabled,
        backgroundCapabilityAvailable,
    });
}

export async function requestPredictiveLocationPermissionsAsync() {
    const servicesEnabled = await Location.hasServicesEnabledAsync();
    let foreground = await Location.getForegroundPermissionsAsync();

    if (foreground.status !== 'granted') {
        foreground = await Location.requestForegroundPermissionsAsync();
    }

    const backgroundCapabilityAvailable = await getBackgroundCapabilityAvailabilityAsync();
    let background = await Location.getBackgroundPermissionsAsync();

    if (
        foreground.status === 'granted' &&
        backgroundCapabilityAvailable &&
        background.status !== 'granted'
    ) {
        background = await Location.requestBackgroundPermissionsAsync();
    }

    return normalizePermissionState({
        foreground,
        background,
        servicesEnabled,
        backgroundCapabilityAvailable,
    });
}

export async function enablePredictiveLocationTrackingAsync(options = {}) {
    const permissionState = await requestPredictiveLocationPermissionsAsync();

    if (!permissionState.isReady) {
        return permissionState;
    }

    await startPredictiveLocationUpdatesAsync(options);
    return permissionState;
}

export function subscribeToPredictiveLocationUpdates(listener) {
    backgroundLocationListeners.add(listener);

    return () => {
        backgroundLocationListeners.delete(listener);
    };
}

export function subscribeToPredictiveGeofenceEvents(listener) {
    geofencingListeners.add(listener);

    return () => {
        geofencingListeners.delete(listener);
    };
}

export async function startPredictiveLocationUpdatesAsync(options = {}) {
    const permissionState = await getPredictiveLocationPermissionStateAsync();

    if (!permissionState.isReady) {
        throw new Error('Predictive location permissions are not fully granted.');
    }

    const isTaskManagerAvailable = await TaskManager.isAvailableAsync();

    if (!isTaskManagerAvailable) {
        throw new Error('Background location requires a development or production build.');
    }

    const hasStarted = await Location.hasStartedLocationUpdatesAsync(PREDICTIVE_LOCATION_TASK_NAME);

    if (hasStarted) {
        return;
    }

    await Location.startLocationUpdatesAsync(
        PREDICTIVE_LOCATION_TASK_NAME,
        {
            ...DEFAULT_BACKGROUND_LOCATION_OPTIONS,
            ...options,
            foregroundService: {
                ...DEFAULT_BACKGROUND_LOCATION_OPTIONS.foregroundService,
                ...(options.foregroundService || {}),
            },
        }
    );
}

function normalizeRegions(regions) {
    if (!Array.isArray(regions)) {
        return [];
    }

    return regions.filter(region => (
        Number.isFinite(region?.latitude) &&
        Number.isFinite(region?.longitude) &&
        Number.isFinite(region?.radius)
    ));
}

export async function syncPredictiveGeofencesAsync(regions) {
    const permissionState = await getPredictiveLocationPermissionStateAsync();

    if (!permissionState.isReady) {
        throw new Error('Predictive location permissions are not fully granted.');
    }

    const isTaskManagerAvailable = await TaskManager.isAvailableAsync();

    if (!isTaskManagerAvailable) {
        throw new Error('Geofencing requires a development or production build.');
    }

    await Location.startGeofencingAsync(
        PREDICTIVE_GEOFENCING_TASK_NAME,
        normalizeRegions(regions)
    );
}

export async function stopPredictiveLocationUpdatesAsync() {
    const hasStarted = await Location.hasStartedLocationUpdatesAsync(PREDICTIVE_LOCATION_TASK_NAME);

    if (hasStarted) {
        await Location.stopLocationUpdatesAsync(PREDICTIVE_LOCATION_TASK_NAME);
    }
}

export async function stopPredictiveGeofencingAsync() {
    const hasStarted = await Location.hasStartedGeofencingAsync(PREDICTIVE_GEOFENCING_TASK_NAME);

    if (hasStarted) {
        await Location.stopGeofencingAsync(PREDICTIVE_GEOFENCING_TASK_NAME);
    }
}

export async function openPredictiveLocationSettingsAsync() {
    await Linking.openSettings();
}

if (!TaskManager.isTaskDefined(PREDICTIVE_LOCATION_TASK_NAME)) {
    TaskManager.defineTask(PREDICTIVE_LOCATION_TASK_NAME, async ({ data, error, executionInfo }) => {
        if (error) {
            console.error('Predictive background location task failed:', error);
            return;
        }

        emitTaskPayload(backgroundLocationListeners, {
            executionInfo,
            locations: Array.isArray(data?.locations) ? data.locations : [],
        });
    });
}

if (!TaskManager.isTaskDefined(PREDICTIVE_GEOFENCING_TASK_NAME)) {
    TaskManager.defineTask(PREDICTIVE_GEOFENCING_TASK_NAME, async ({ data, error, executionInfo }) => {
        if (error) {
            console.error('Predictive geofencing task failed:', error);
            return;
        }

        emitTaskPayload(geofencingListeners, {
            executionInfo,
            eventType: data?.eventType ?? null,
            region: data?.region ?? null,
        });
    });
}
