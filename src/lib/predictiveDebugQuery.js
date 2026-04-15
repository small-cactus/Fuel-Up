import { AppState } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Location from 'expo-location';

import {
    getPredictiveDrivingActivityAuthorizationStatusAsync,
    getLatestPredictiveDrivingActivityAsync,
    isPredictiveDrivingActivityAutomotive,
    isPredictiveDrivingActivityAvailable,
    isPredictiveDrivingActivitySupportedAsync,
} from './predictiveDrivingActivity';
import { getPredictiveFuelingDriveGateDebugState } from './predictiveFuelingDriveGate';
import {
    getPredictiveLocationDebugState,
    PREDICTIVE_GEOFENCING_TASK_NAME,
    PREDICTIVE_LOCATION_TASK_NAME,
} from './predictiveLocation';
import { getPredictiveTrackingPermissionStateAsync } from './predictiveTrackingAccess';

const {
    getPredictiveFuelingBackendDebugState,
    getPredictiveFuelingBackendState,
} = require('./predictiveFuelingBackend');

const PREDICTIVE_DEBUG_QUERY_REPORT_FILE_NAME = 'predictive-debug-query.json';
const DEFAULT_LOOKBACK_MS = 12 * 60 * 1000;
const DEFAULT_STOP_GRACE_MS = 3 * 60 * 1000;
const DRIVING_SPEED_THRESHOLD_MPS = 8;
const DRIVING_ACCURACY_THRESHOLD_METERS = 120;

function getReportUri() {
    if (!FileSystem.documentDirectory) {
        return null;
    }

    return `${FileSystem.documentDirectory}${PREDICTIVE_DEBUG_QUERY_REPORT_FILE_NAME}`;
}

function toFiniteNumber(value) {
    if (value == null || value === '') {
        return null;
    }

    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
}

function isTaskMissingError(error) {
    const message = String(error?.message || error || '');
    return message.includes('not found for app ID');
}

async function readTaskStartedStateAsync(taskName, reader) {
    try {
        return {
            started: Boolean(await reader(taskName)),
            error: null,
        };
    } catch (error) {
        if (isTaskMissingError(error)) {
            return {
                started: false,
                error: null,
            };
        }

        return {
            started: false,
            error: error?.message || String(error),
        };
    }
}

function pickPayload(query, payloads) {
    switch (query) {
        case 'driving':
            return payloads.driving;
        case 'backend':
            return payloads.backend;
        case 'permissions':
            return payloads.permissions;
        case 'tasks':
            return payloads.tasks;
        case 'location':
            return payloads.location;
        default:
            return payloads.all;
    }
}

function inferDrivingFromSample(sample) {
    const speedMps = toFiniteNumber(sample?.speed);
    const accuracyMeters = toFiniteNumber(sample?.accuracy);

    if (!Number.isFinite(speedMps) || speedMps < DRIVING_SPEED_THRESHOLD_MPS) {
        return false;
    }

    if (Number.isFinite(accuracyMeters) && accuracyMeters > DRIVING_ACCURACY_THRESHOLD_METERS) {
        return false;
    }

    return true;
}

export async function runPredictiveDebugQueryAsync({
    token = 'default',
    query = 'all',
    lookbackMs = DEFAULT_LOOKBACK_MS,
} = {}) {
    const reportUri = getReportUri();
    const nowMs = Date.now();
    const [
        permissionState,
        motionAuthorizationStatus,
        motionActivitySupported,
        latestActivity,
        locationTaskState,
        geofencingTaskState,
    ] = await Promise.all([
        getPredictiveTrackingPermissionStateAsync().catch(error => ({
            error: error?.message || String(error),
        })),
        getPredictiveDrivingActivityAuthorizationStatusAsync().catch(error => `error:${error?.message || String(error)}`),
        isPredictiveDrivingActivityAvailable()
            ? isPredictiveDrivingActivitySupportedAsync().catch(() => false)
            : Promise.resolve(false),
        getLatestPredictiveDrivingActivityAsync({ lookbackMs }).catch(() => null),
        readTaskStartedStateAsync(
            PREDICTIVE_LOCATION_TASK_NAME,
            Location.hasStartedLocationUpdatesAsync
        ),
        readTaskStartedStateAsync(
            PREDICTIVE_GEOFENCING_TASK_NAME,
            Location.hasStartedGeofencingAsync
        ),
    ]);

    const backendState = getPredictiveFuelingBackendState();
    const backendDebugState = getPredictiveFuelingBackendDebugState();
    const driveGateDebugState = getPredictiveFuelingDriveGateDebugState();
    const locationDebugState = getPredictiveLocationDebugState();
    const lastAutomotiveAt = toFiniteNumber(driveGateDebugState?.lastAutomotiveAt) || 0;
    const withinStopGrace = lastAutomotiveAt > 0 && (nowMs - lastAutomotiveAt) < DEFAULT_STOP_GRACE_MS;
    const motionDriving = Boolean(isPredictiveDrivingActivityAutomotive(latestActivity));
    const latestRuntimeSample = (
        backendState?.runtimeState?.lastLocationSample ||
        backendState?.runtimeState?.recentSamples?.[backendState?.runtimeState?.recentSamples?.length - 1] ||
        null
    );
    const locationDriving = inferDrivingFromSample(latestRuntimeSample);
    const runtimeRunning = Boolean(backendState);
    const driveGateBackendRunning = Boolean(driveGateDebugState?.backendRunning);
    const effectiveBackendRunning = runtimeRunning || driveGateBackendRunning;
    const effectiveDriving = motionDriving || withinStopGrace || locationDriving;
    let effectiveDrivingReason = 'not-driving';
    if (motionDriving) {
        effectiveDrivingReason = 'motion-automotive';
    } else if (withinStopGrace) {
        effectiveDrivingReason = 'within-stop-grace';
    } else if (locationDriving) {
        effectiveDrivingReason = 'location-speed-heuristic';
    }

    const payloads = {
        driving: {
            appState: AppState.currentState,
            motionDriving,
            locationDriving,
            effectiveDriving,
            effectiveDrivingReason,
            withinStopGrace,
            backendRunning: effectiveBackendRunning,
            runtimeRunning,
            driveGateBackendRunning,
            activityUpdatesRunning: Boolean(driveGateDebugState?.activityUpdatesRunning),
            latestActivity,
            latestRuntimeSample,
            lastAutomotiveAt,
            driveGateDecision: driveGateDebugState?.lastDecision || null,
            lastRuntimeSync: driveGateDebugState?.lastRuntimeSync || null,
            locationBackgroundDecision: locationDebugState?.lastBackgroundDecision || null,
        },
        backend: {
            runtimeState: backendState,
            backendDebugState,
            driveGateDebugState,
            locationDebugState,
        },
        permissions: {
            trackingPermissionState: permissionState,
            motionAuthorizationStatus,
            motionActivityAvailable: Boolean(isPredictiveDrivingActivityAvailable()),
            motionActivitySupported: Boolean(motionActivitySupported),
        },
        tasks: {
            locationTask: locationTaskState,
            geofencingTask: geofencingTaskState,
        },
        location: {
            locationDebugState,
            locationTask: locationTaskState,
            geofencingTask: geofencingTaskState,
        },
    };

    payloads.all = {
        appState: AppState.currentState,
        generatedAt: new Date(nowMs).toISOString(),
        driving: payloads.driving,
        backend: payloads.backend,
        permissions: payloads.permissions,
        tasks: payloads.tasks,
    };

    const report = {
        status: 'completed',
        token,
        query,
        generatedAt: new Date(nowMs).toISOString(),
        payload: pickPayload(query, payloads),
    };

    if (reportUri) {
        await FileSystem.writeAsStringAsync(reportUri, JSON.stringify(report, null, 2));
    }

    return report;
}

export function getPredictiveDebugQueryReportFilename() {
    return PREDICTIVE_DEBUG_QUERY_REPORT_FILE_NAME;
}
