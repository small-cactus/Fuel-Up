import {
    getPredictiveLocationPermissionStateAsync,
    openPredictiveLocationSettingsAsync,
    requestPredictiveLocationPermissionsAsync,
} from './predictiveLocation';
import {
    getPredictiveDrivingActivityAuthorizationStatusAsync,
    isPredictiveDrivingActivityAvailable,
    isPredictiveDrivingActivitySupportedAsync,
    requestPredictiveDrivingActivityAccessAsync,
    startPredictiveDrivingActivityUpdatesAsync,
} from './predictiveDrivingActivity';

function normalizeTrackingPermissionState({
    locationPermissionState,
    motionAuthorizationStatus,
    motionActivityAvailable,
}) {
    const motionGranted = motionAuthorizationStatus === 'authorized';
    const motionNeedsSettings = motionActivityAvailable && (
        motionAuthorizationStatus === 'denied' ||
        motionAuthorizationStatus === 'restricted'
    );

    return {
        ...locationPermissionState,
        motionActivityAvailable,
        motionAuthorizationStatus,
        motionGranted,
        isReady: Boolean(locationPermissionState?.isReady && (!motionActivityAvailable || motionGranted)),
        needsSettings: Boolean(locationPermissionState?.needsSettings || motionNeedsSettings),
    };
}

export async function getPredictiveTrackingPermissionStateAsync() {
    const [locationPermissionState, motionAuthorizationStatus, motionActivitySupported] = await Promise.all([
        getPredictiveLocationPermissionStateAsync(),
        getPredictiveDrivingActivityAuthorizationStatusAsync(),
        isPredictiveDrivingActivityAvailable()
            ? isPredictiveDrivingActivitySupportedAsync().catch(() => false)
            : Promise.resolve(false),
    ]);

    return normalizeTrackingPermissionState({
        locationPermissionState,
        motionAuthorizationStatus,
        motionActivityAvailable: Boolean(isPredictiveDrivingActivityAvailable() && motionActivitySupported),
    });
}

export async function enablePredictiveTrackingAsync() {
    const locationPermissionState = await requestPredictiveLocationPermissionsAsync();
    const motionActivityAvailable = isPredictiveDrivingActivityAvailable()
        ? await isPredictiveDrivingActivitySupportedAsync().catch(() => false)
        : false;
    let motionAuthorizationStatus = await getPredictiveDrivingActivityAuthorizationStatusAsync();

    if (motionActivityAvailable && motionAuthorizationStatus === 'notDetermined') {
        motionAuthorizationStatus = await requestPredictiveDrivingActivityAccessAsync();
    }

    if (motionActivityAvailable && motionAuthorizationStatus === 'authorized') {
        await startPredictiveDrivingActivityUpdatesAsync();
    }

    return normalizeTrackingPermissionState({
        locationPermissionState,
        motionAuthorizationStatus,
        motionActivityAvailable,
    });
}

export async function openPredictiveTrackingSettingsAsync() {
    return openPredictiveLocationSettingsAsync();
}
