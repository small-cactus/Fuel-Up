import { Linking, Platform } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import AsyncStorageModule from '@react-native-async-storage/async-storage';
import {
    getLatestPredictiveDrivingActivityAsync,
    isPredictiveDrivingActivityAutomotive,
} from './predictiveDrivingActivity';
const {
    loadPredictiveDrivingSessionAsync,
    markPredictiveDrivingAutomotiveAsync,
} = require('./predictiveDrivingSessionStore.js');
const {
    loadPredictiveFuelingBackgroundConfigAsync,
} = require('./predictiveFuelingPreferencesStore.js');

export const PREDICTIVE_LOCATION_TASK_NAME = 'fuelup.predictive-location-updates';
export const PREDICTIVE_GEOFENCING_TASK_NAME = 'fuelup.predictive-geofencing';

const PREDICTIVE_LOCATION_OPTIONS_SIGNATURE_KEY = '@fuelup/predictive-location-options-signature';
const PREDICTIVE_TASK_EVENT_INBOX_KEY = '@fuelup/predictive-task-event-inbox';
const MAX_QUEUED_TASK_EVENTS = 20;
const PREDICTIVE_DRIVE_ACTIVITY_LOOKBACK_MS = 12 * 60 * 1000;
const PREDICTIVE_DRIVE_STOP_GRACE_MS = 3 * 60 * 1000;

const backgroundLocationListeners = new Set();
const geofencingListeners = new Set();
const AsyncStorage = AsyncStorageModule?.default || AsyncStorageModule;
let inboxMutationPromise = Promise.resolve();
let appliedLocationOptionsSignature = null;
const predictiveLocationDebugListeners = new Set();
let predictiveLocationDebugState = {
    queueSize: 0,
    lastDispatch: null,
    lastTaskPayload: null,
    lastBackgroundDecision: null,
    lastTrackingActivation: null,
    lastGeofenceSync: null,
    lastQueueMutation: null,
};

const ANDROID_FOREGROUND_SERVICE_OPTIONS = Object.freeze({
    notificationTitle: 'Fuel Up is tracking fuel opportunities',
    notificationBody: 'Background location stays on so Fuel Up can predict the best stop.',
    killServiceOnDestroy: false,
});

const TRACKING_MODE_OPTIONS = Object.freeze({
    monitoring: {
        accuracy: Location.Accuracy.Balanced,
        activityType: Location.ActivityType.AutomotiveNavigation,
        distanceInterval: 125,
        deferredUpdatesDistance: 250,
        deferredUpdatesInterval: 180_000,
        pausesUpdatesAutomatically: true,
        showsBackgroundLocationIndicator: false,
    },
    engaged: {
        accuracy: Location.Accuracy.High,
        activityType: Location.ActivityType.AutomotiveNavigation,
        distanceInterval: 40,
        deferredUpdatesDistance: 90,
        deferredUpdatesInterval: 45_000,
        pausesUpdatesAutomatically: true,
        showsBackgroundLocationIndicator: false,
    },
});

function emitPredictiveLocationDebugState() {
    predictiveLocationDebugListeners.forEach(listener => {
        try {
            listener(predictiveLocationDebugState);
        } catch (error) {
            console.warn('Predictive location debug listener failed:', error?.message || error);
        }
    });
}

function updatePredictiveLocationDebugState(patch = {}) {
    predictiveLocationDebugState = {
        ...predictiveLocationDebugState,
        ...patch,
    };
    emitPredictiveLocationDebugState();
}

function summarizeTaskPayload(kind, payload) {
    if (kind === 'geofence') {
        return {
            at: Date.now(),
            kind,
            eventType: payload?.eventType ?? null,
            regionIdentifier: String(payload?.region?.identifier || ''),
        };
    }

    const locations = Array.isArray(payload?.locations) ? payload.locations : [];
    const latestLocation = locations[locations.length - 1];
    return {
        at: Date.now(),
        kind,
        sampleCount: locations.length,
        speedMps: Number(latestLocation?.coords?.speed ?? latestLocation?.speed) || 0,
        accuracyMeters: Number(latestLocation?.coords?.accuracy ?? latestLocation?.accuracy) || null,
        timestamp: Number(latestLocation?.timestamp ?? latestLocation?.coords?.timestamp) || null,
        eventType: latestLocation?.eventType || null,
    };
}

export function getPredictiveLocationDebugState() {
    return predictiveLocationDebugState;
}

export function subscribeToPredictiveLocationDebugState(listener) {
    if (typeof listener !== 'function') {
        return () => { };
    }

    predictiveLocationDebugListeners.add(listener);
    try {
        listener(predictiveLocationDebugState);
    } catch (error) {
        console.warn('Predictive location debug initial emit failed:', error?.message || error);
    }

    return () => {
        predictiveLocationDebugListeners.delete(listener);
    };
}

function emitTaskPayload(listeners, payload) {
    listeners.forEach(listener => {
        try {
            listener(payload);
        } catch (error) {
            console.error('Predictive location listener failed:', error);
        }
    });
}

function mutateTaskInboxAsync(mutation) {
    const run = inboxMutationPromise
        .catch(() => { })
        .then(mutation);
    inboxMutationPromise = run.catch(() => { });
    return run;
}

async function appendQueuedPredictiveTaskEventAsync(event) {
    if (!AsyncStorage) {
        return;
    }

    await mutateTaskInboxAsync(async () => {
        let existingEvents = [];
        try {
            const rawValue = await AsyncStorage.getItem(PREDICTIVE_TASK_EVENT_INBOX_KEY);
            existingEvents = rawValue ? JSON.parse(rawValue) : [];
        } catch (error) {
            existingEvents = [];
        }
        const nextEvents = [
            ...(Array.isArray(existingEvents) ? existingEvents : []),
            event,
        ].slice(-MAX_QUEUED_TASK_EVENTS);
        await AsyncStorage.setItem(PREDICTIVE_TASK_EVENT_INBOX_KEY, JSON.stringify(nextEvents));
        updatePredictiveLocationDebugState({
            queueSize: nextEvents.length,
            lastQueueMutation: {
                at: Date.now(),
                action: 'append',
                queueSize: nextEvents.length,
                kind: event?.kind || null,
            },
        });
    });
}

async function dispatchPredictiveTaskPayloadAsync(kind, payload) {
    const listeners = kind === 'location'
        ? backgroundLocationListeners
        : geofencingListeners;
    updatePredictiveLocationDebugState({
        lastTaskPayload: summarizeTaskPayload(kind, payload),
    });

    if (listeners.size > 0) {
        emitTaskPayload(listeners, payload);
        updatePredictiveLocationDebugState({
            lastDispatch: {
                at: Date.now(),
                kind,
                path: 'listener',
                listenerCount: listeners.size,
                reason: 'active-listeners',
            },
        });
        return;
    }

    const backgroundResult = await processPredictiveTaskPayloadInBackgroundAsync(kind, payload);
    updatePredictiveLocationDebugState({
        lastDispatch: {
            at: Date.now(),
            kind,
            path: backgroundResult?.handled
                ? 'background'
                : (backgroundResult?.queue === false ? 'discarded' : 'queued'),
            listenerCount: listeners.size,
            reason: backgroundResult?.reason || 'unknown',
        },
    });
    if (backgroundResult?.handled || backgroundResult?.queue === false) {
        return;
    }

    await appendQueuedPredictiveTaskEventAsync({
        kind,
        payload,
        receivedAt: Date.now(),
    });
}

async function processPredictiveTaskPayloadInBackgroundAsync(kind, payload) {
    let backgroundConfig = null;
    try {
        backgroundConfig = await loadPredictiveFuelingBackgroundConfigAsync();
    } catch (error) {
        updatePredictiveLocationDebugState({
            lastBackgroundDecision: {
                at: Date.now(),
                kind,
                outcome: 'queued',
                reason: 'preferences-unavailable',
            },
        });
        return { handled: false, queue: true, reason: 'preferences-unavailable' };
    }

    if (!backgroundConfig?.enabled) {
        updatePredictiveLocationDebugState({
            lastBackgroundDecision: {
                at: Date.now(),
                kind,
                outcome: 'discarded',
                reason: 'predictive-disabled',
            },
        });
        return { handled: false, queue: false, reason: 'predictive-disabled' };
    }

    const {
        ensurePredictiveFuelingBootstrapActiveAsync,
        processPredictiveFuelingGeofenceEventAsync,
        processPredictiveFuelingLocationPayloadAsync,
        stopPredictiveFuelingBackend,
    } = require('./predictiveFuelingBackend.js');

    try {
        await ensurePredictiveFuelingBootstrapActiveAsync();
    } catch (error) {
        updatePredictiveLocationDebugState({
            lastBackgroundDecision: {
                at: Date.now(),
                kind,
                outcome: 'queued',
                reason: 'bootstrap-failed',
                error: error?.message || String(error),
            },
        });
        return { handled: false, queue: true, reason: 'bootstrap-failed' };
    }

    if (kind === 'geofence') {
        try {
            await processPredictiveFuelingGeofenceEventAsync(payload, backgroundConfig.preferences);
            updatePredictiveLocationDebugState({
                lastBackgroundDecision: {
                    at: Date.now(),
                    kind,
                    outcome: 'handled',
                    reason: 'processed-geofence',
                    regionIdentifier: String(payload?.region?.identifier || ''),
                    eventType: payload?.eventType ?? null,
                },
            });
            return { handled: true, queue: false, reason: 'processed-geofence' };
        } catch (error) {
            updatePredictiveLocationDebugState({
                lastBackgroundDecision: {
                    at: Date.now(),
                    kind,
                    outcome: 'queued',
                    reason: 'geofence-processing-failed',
                    error: error?.message || String(error),
                },
            });
            return { handled: false, queue: true, reason: 'geofence-processing-failed' };
        }
    }

    let latestActivity = null;
    try {
        latestActivity = await getLatestPredictiveDrivingActivityAsync({
            lookbackMs: PREDICTIVE_DRIVE_ACTIVITY_LOOKBACK_MS,
        });
    } catch (error) {
        latestActivity = null;
    }

    const nowMs = Date.now();
    if (isPredictiveDrivingActivityAutomotive(latestActivity)) {
        const activityTimestamp = Number(latestActivity?.timestamp) || nowMs;
        void markPredictiveDrivingAutomotiveAsync(activityTimestamp).catch(() => { });
    }

    let lastAutomotiveAt = 0;
    try {
        const session = await loadPredictiveDrivingSessionAsync();
        lastAutomotiveAt = Number(session?.lastAutomotiveAt) || 0;
    } catch (error) {
        lastAutomotiveAt = 0;
    }

    const withinGrace = lastAutomotiveAt > 0 && (nowMs - lastAutomotiveAt) < PREDICTIVE_DRIVE_STOP_GRACE_MS;
    const drivingHeuristic = inferDrivingFromLocationPayload(payload);
    const latestLocation = Array.isArray(payload?.locations) ? payload.locations[payload.locations.length - 1] : null;
    const speedMps = Number(latestLocation?.coords?.speed ?? latestLocation?.speed) || 0;
    const accuracyMeters = Number(latestLocation?.coords?.accuracy ?? latestLocation?.accuracy) || null;
    const shouldProcessLocation = (
        isPredictiveDrivingActivityAutomotive(latestActivity) ||
        withinGrace ||
        drivingHeuristic
    );

    if (!shouldProcessLocation) {
        stopPredictiveFuelingBackend();
        updatePredictiveLocationDebugState({
            lastBackgroundDecision: {
                at: Date.now(),
                kind,
                outcome: 'discarded',
                reason: 'not-driving',
                automotive: Boolean(isPredictiveDrivingActivityAutomotive(latestActivity)),
                withinGrace,
                drivingHeuristic,
                speedMps,
                accuracyMeters,
            },
        });
        return { handled: false, queue: false, reason: 'not-driving' };
    }

    try {
        await processPredictiveFuelingLocationPayloadAsync(payload, backgroundConfig.preferences);
        updatePredictiveLocationDebugState({
            lastBackgroundDecision: {
                at: Date.now(),
                kind,
                outcome: 'handled',
                reason: 'processed-location',
                automotive: Boolean(isPredictiveDrivingActivityAutomotive(latestActivity)),
                withinGrace,
                drivingHeuristic,
                speedMps,
                accuracyMeters,
            },
        });
        return { handled: true, queue: false, reason: 'processed-location' };
    } catch (error) {
        updatePredictiveLocationDebugState({
            lastBackgroundDecision: {
                at: Date.now(),
                kind,
                outcome: 'queued',
                reason: 'location-processing-failed',
                automotive: Boolean(isPredictiveDrivingActivityAutomotive(latestActivity)),
                withinGrace,
                drivingHeuristic,
                speedMps,
                accuracyMeters,
                error: error?.message || String(error),
            },
        });
        return { handled: false, queue: true, reason: 'location-processing-failed' };
    }
}

function inferDrivingFromLocationPayload(payload) {
    const locations = Array.isArray(payload?.locations) ? payload.locations : [];
    const latestLocation = locations[locations.length - 1];
    const speedMps = Number(latestLocation?.coords?.speed ?? latestLocation?.speed);
    const accuracyMeters = Number(latestLocation?.coords?.accuracy ?? latestLocation?.accuracy);

    if (!Number.isFinite(speedMps) || speedMps < 8) {
        return false;
    }

    if (Number.isFinite(accuracyMeters) && accuracyMeters > 120) {
        return false;
    }

    return true;
}

export async function drainQueuedPredictiveTaskEventsAsync() {
    if (!AsyncStorage) {
        return [];
    }

    return mutateTaskInboxAsync(async () => {
        let parsedEvents = [];
        try {
            const rawValue = await AsyncStorage.getItem(PREDICTIVE_TASK_EVENT_INBOX_KEY);
            parsedEvents = rawValue ? JSON.parse(rawValue) : [];
        } catch (error) {
            parsedEvents = [];
        }
        await AsyncStorage.removeItem(PREDICTIVE_TASK_EVENT_INBOX_KEY);
        const nextEvents = (Array.isArray(parsedEvents) ? parsedEvents : [])
            .filter(event => event?.kind === 'location' || event?.kind === 'geofence')
            .sort((left, right) => Number(left?.receivedAt || 0) - Number(right?.receivedAt || 0));
        updatePredictiveLocationDebugState({
            queueSize: 0,
            lastQueueMutation: {
                at: Date.now(),
                action: 'drain',
                queueSize: 0,
                drainedCount: nextEvents.length,
            },
        });
        return nextEvents;
    });
}

export async function clearQueuedPredictiveTaskEventsAsync() {
    if (!AsyncStorage) {
        return;
    }

    await mutateTaskInboxAsync(async () => {
        await AsyncStorage.removeItem(PREDICTIVE_TASK_EVENT_INBOX_KEY);
        updatePredictiveLocationDebugState({
            queueSize: 0,
            lastQueueMutation: {
                at: Date.now(),
                action: 'clear',
                queueSize: 0,
            },
        });
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

async function readAppliedLocationOptionsSignatureAsync() {
    if (appliedLocationOptionsSignature !== null) {
        return appliedLocationOptionsSignature;
    }

    if (!AsyncStorage) {
        return null;
    }

    try {
        appliedLocationOptionsSignature = await AsyncStorage.getItem(PREDICTIVE_LOCATION_OPTIONS_SIGNATURE_KEY);
    } catch (error) {
        appliedLocationOptionsSignature = null;
    }
    return appliedLocationOptionsSignature;
}

async function writeAppliedLocationOptionsSignatureAsync(signature) {
    appliedLocationOptionsSignature = signature || null;

    if (!AsyncStorage) {
        return;
    }

    if (!signature) {
        await AsyncStorage.removeItem(PREDICTIVE_LOCATION_OPTIONS_SIGNATURE_KEY);
        return;
    }

    await AsyncStorage.setItem(PREDICTIVE_LOCATION_OPTIONS_SIGNATURE_KEY, signature);
}

function createLocationOptionsSignature(options) {
    const foregroundService = options?.foregroundService || {};
    return JSON.stringify({
        accuracy: Number(options?.accuracy) || 0,
        activityType: Number(options?.activityType) || 0,
        deferredUpdatesDistance: Number(options?.deferredUpdatesDistance) || 0,
        deferredUpdatesInterval: Number(options?.deferredUpdatesInterval) || 0,
        distanceInterval: Number(options?.distanceInterval) || 0,
        foregroundNotificationBody: String(foregroundService.notificationBody || ''),
        foregroundNotificationTitle: String(foregroundService.notificationTitle || ''),
        killServiceOnDestroy: Boolean(foregroundService.killServiceOnDestroy),
        pausesUpdatesAutomatically: options?.pausesUpdatesAutomatically !== false,
        showsBackgroundLocationIndicator: Boolean(options?.showsBackgroundLocationIndicator),
    });
}

function isPredictiveTaskMissingError(error) {
    const serializedError = [
        error?.message,
        error?.reason,
        error?.details,
        (() => {
            try {
                return JSON.stringify(error);
            } catch (serializationError) {
                return null;
            }
        })(),
        String(error || ''),
    ]
        .filter(Boolean)
        .join(' | ');

    return serializedError.includes('not found for app ID');
}

export function getPredictiveLocationTaskOptions(mode = 'monitoring', overrides = {}) {
    const baseOptions = TRACKING_MODE_OPTIONS[mode] || TRACKING_MODE_OPTIONS.monitoring;

    return {
        ...baseOptions,
        ...overrides,
        // Keep continuous background updates, but never ask iOS to surface the
        // blue/Dynamic Island background location indicator.
        showsBackgroundLocationIndicator: false,
        foregroundService: {
            ...ANDROID_FOREGROUND_SERVICE_OPTIONS,
            ...(overrides.foregroundService || {}),
        },
    };
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

export async function ensurePredictiveLocationTrackingActiveAsync({
    mode = 'monitoring',
    options = {},
} = {}) {
    const permissionState = await getPredictiveLocationPermissionStateAsync();

    if (!permissionState.isReady) {
        updatePredictiveLocationDebugState({
            lastTrackingActivation: {
                at: Date.now(),
                mode,
                started: false,
                restarted: false,
                reason: 'permission-not-ready',
                permissionReady: false,
            },
        });
        return {
            mode,
            permissionState,
            restarted: false,
            started: false,
        };
    }

    const isTaskManagerAvailable = await TaskManager.isAvailableAsync();

    if (!isTaskManagerAvailable) {
        updatePredictiveLocationDebugState({
            lastTrackingActivation: {
                at: Date.now(),
                mode,
                started: false,
                restarted: false,
                reason: 'task-manager-unavailable',
                permissionReady: true,
            },
        });
        throw new Error('Background location requires a development or production build.');
    }

    const nextOptions = getPredictiveLocationTaskOptions(mode, options);
    const nextSignature = createLocationOptionsSignature(nextOptions);
    let hasStarted = false;
    try {
        hasStarted = await Location.hasStartedLocationUpdatesAsync(PREDICTIVE_LOCATION_TASK_NAME);
    } catch (error) {
        if (!isPredictiveTaskMissingError(error)) {
            throw error;
        }
    }
    const currentSignature = await readAppliedLocationOptionsSignatureAsync();

    if (hasStarted && currentSignature === nextSignature) {
        updatePredictiveLocationDebugState({
            lastTrackingActivation: {
                at: Date.now(),
                mode,
                started: true,
                restarted: false,
                reason: 'already-active',
                permissionReady: true,
            },
        });
        return {
            mode,
            options: nextOptions,
            permissionState,
            restarted: false,
            started: true,
        };
    }

    if (hasStarted) {
        try {
            await Location.stopLocationUpdatesAsync(PREDICTIVE_LOCATION_TASK_NAME);
        } catch (error) {
            if (!isPredictiveTaskMissingError(error)) {
                throw error;
            }
        }
    }

    await Location.startLocationUpdatesAsync(PREDICTIVE_LOCATION_TASK_NAME, nextOptions);
    await writeAppliedLocationOptionsSignatureAsync(nextSignature);
    updatePredictiveLocationDebugState({
        lastTrackingActivation: {
            at: Date.now(),
            mode,
            started: true,
            restarted: hasStarted,
            reason: hasStarted ? 'restarted-with-new-options' : 'started',
            permissionReady: true,
        },
    });

    return {
        mode,
        options: nextOptions,
        permissionState,
        restarted: hasStarted,
        started: true,
    };
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

    const mode = typeof options?.mode === 'string'
        ? options.mode
        : 'monitoring';
    const overrideOptions = { ...(options || {}) };
    delete overrideOptions.mode;

    await ensurePredictiveLocationTrackingActiveAsync({
        mode,
        options: overrideOptions,
    });
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
    updatePredictiveLocationDebugState({
        lastGeofenceSync: {
            at: Date.now(),
            regionCount: normalizeRegions(regions).length,
            reason: 'started-geofencing',
        },
    });
}

export async function stopPredictiveLocationUpdatesAsync() {
    let hasStarted = false;
    try {
        hasStarted = await Location.hasStartedLocationUpdatesAsync(PREDICTIVE_LOCATION_TASK_NAME);
    } catch (error) {
        if (!isPredictiveTaskMissingError(error)) {
            throw error;
        }
    }

    if (hasStarted) {
        try {
            await Location.stopLocationUpdatesAsync(PREDICTIVE_LOCATION_TASK_NAME);
        } catch (error) {
            if (!isPredictiveTaskMissingError(error)) {
                throw error;
            }
            hasStarted = false;
        }
    }

    await writeAppliedLocationOptionsSignatureAsync(null);
    updatePredictiveLocationDebugState({
        lastTrackingActivation: {
            at: Date.now(),
            mode: null,
            started: false,
            restarted: false,
            reason: hasStarted ? 'stopped' : 'already-stopped',
            permissionReady: null,
        },
    });
}

export async function stopPredictiveGeofencingAsync() {
    let hasStarted = false;
    try {
        hasStarted = await Location.hasStartedGeofencingAsync(PREDICTIVE_GEOFENCING_TASK_NAME);
    } catch (error) {
        if (!isPredictiveTaskMissingError(error)) {
            throw error;
        }
    }

    if (hasStarted) {
        try {
            await Location.stopGeofencingAsync(PREDICTIVE_GEOFENCING_TASK_NAME);
        } catch (error) {
            if (!isPredictiveTaskMissingError(error)) {
                throw error;
            }
            hasStarted = false;
        }
    }
    updatePredictiveLocationDebugState({
        lastGeofenceSync: {
            at: Date.now(),
            regionCount: 0,
            reason: hasStarted ? 'stopped-geofencing' : 'geofencing-already-stopped',
        },
    });
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

        await dispatchPredictiveTaskPayloadAsync('location', {
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

        await dispatchPredictiveTaskPayloadAsync('geofence', {
            executionInfo,
            eventType: data?.eventType ?? null,
            region: data?.region ?? null,
        });
    });
}
