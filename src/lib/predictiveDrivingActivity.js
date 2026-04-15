import { NativeEventEmitter, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

const nativeModule = Platform.OS === 'ios'
    ? requireOptionalNativeModule('FuelUpDrivingActivity')
    : null;
const eventEmitter = nativeModule ? new NativeEventEmitter(nativeModule) : null;

function createUnavailableError() {
    const error = new Error('FuelUpDrivingActivity is unavailable on this platform.');
    error.code = 'ERR_DRIVING_ACTIVITY_UNAVAILABLE';
    return error;
}

function normalizeActivityPayload(payload) {
    if (!payload || typeof payload !== 'object') {
        return null;
    }

    return {
        automotive: Boolean(payload.automotive),
        cycling: Boolean(payload.cycling),
        running: Boolean(payload.running),
        stationary: Boolean(payload.stationary),
        unknown: Boolean(payload.unknown),
        walking: Boolean(payload.walking),
        confidence: String(payload.confidence || 'unknown'),
        timestamp: Number(payload.timestamp) || Date.now(),
    };
}

export function isPredictiveDrivingActivityAvailable() {
    return typeof nativeModule?.startActivityUpdatesAsync === 'function';
}

export async function isPredictiveDrivingActivitySupportedAsync() {
    if (typeof nativeModule?.isActivityAvailableAsync !== 'function') {
        return false;
    }

    return Boolean(await nativeModule.isActivityAvailableAsync());
}

export async function getPredictiveDrivingActivityAuthorizationStatusAsync() {
    if (typeof nativeModule?.getAuthorizationStatusAsync !== 'function') {
        return 'unavailable';
    }

    return String(await nativeModule.getAuthorizationStatusAsync());
}

export async function requestPredictiveDrivingActivityAccessAsync() {
    if (typeof nativeModule?.requestAuthorizationAsync !== 'function') {
        throw createUnavailableError();
    }

    const result = await nativeModule.requestAuthorizationAsync();
    return String(result?.authorizationStatus || 'unknown');
}

export async function startPredictiveDrivingActivityUpdatesAsync() {
    if (typeof nativeModule?.startActivityUpdatesAsync !== 'function') {
        throw createUnavailableError();
    }

    return nativeModule.startActivityUpdatesAsync();
}

export async function stopPredictiveDrivingActivityUpdatesAsync() {
    if (typeof nativeModule?.stopActivityUpdatesAsync !== 'function') {
        return { stopped: false };
    }

    return nativeModule.stopActivityUpdatesAsync();
}

export async function getLatestPredictiveDrivingActivityAsync(options = {}) {
    if (typeof nativeModule?.getLatestActivityAsync !== 'function') {
        return null;
    }

    const activity = await nativeModule.getLatestActivityAsync(
        Number.isFinite(Number(options.lookbackMs)) ? Number(options.lookbackMs) : undefined
    );
    return normalizeActivityPayload(activity);
}

export function subscribeToPredictiveDrivingActivityUpdates(listener) {
    if (!eventEmitter || typeof listener !== 'function') {
        return () => { };
    }

    const subscription = eventEmitter.addListener('onActivityUpdate', payload => {
        listener(normalizeActivityPayload(payload));
    });

    return () => {
        subscription.remove();
    };
}

export function isPredictiveDrivingActivityAutomotive(activity) {
    return Boolean(activity?.automotive) && String(activity?.confidence || 'unknown') !== 'low';
}

export function isPredictiveDrivingActivityConfidentlyNonAutomotive(activity) {
    if (!activity || activity.automotive) {
        return false;
    }

    if (String(activity.confidence || 'unknown') === 'low') {
        return false;
    }

    return Boolean(
        activity.stationary ||
        activity.walking ||
        activity.running ||
        activity.cycling
    );
}

export default {
    getLatestPredictiveDrivingActivityAsync,
    getPredictiveDrivingActivityAuthorizationStatusAsync,
    isPredictiveDrivingActivityAutomotive,
    isPredictiveDrivingActivityAvailable,
    isPredictiveDrivingActivityConfidentlyNonAutomotive,
    isPredictiveDrivingActivitySupportedAsync,
    requestPredictiveDrivingActivityAccessAsync,
    startPredictiveDrivingActivityUpdatesAsync,
    stopPredictiveDrivingActivityUpdatesAsync,
    subscribeToPredictiveDrivingActivityUpdates,
};
