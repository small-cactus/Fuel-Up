import { AppState } from 'react-native';
import {
    getLatestPredictiveDrivingActivityAsync,
    getPredictiveDrivingActivityAuthorizationStatusAsync,
    isPredictiveDrivingActivityAutomotive,
    isPredictiveDrivingActivityAvailable,
    isPredictiveDrivingActivityConfidentlyNonAutomotive,
    isPredictiveDrivingActivitySupportedAsync,
    startPredictiveDrivingActivityUpdatesAsync,
    stopPredictiveDrivingActivityUpdatesAsync,
    subscribeToPredictiveDrivingActivityUpdates,
} from './predictiveDrivingActivity';
const {
    loadPredictiveDrivingSessionAsync,
    markPredictiveDrivingAutomotiveAsync,
} = require('./predictiveDrivingSessionStore.js');

const {
    ensurePredictiveFuelingBootstrapActiveAsync,
    ensurePredictiveFuelingBackendStarted,
    getPredictiveFuelingBackendState,
    isPredictiveFuelingBackendRunning,
    stopPredictiveFuelingBackend,
    updatePredictiveFuelingBackendConfig,
} = require('./predictiveFuelingBackend.js');

const DEFAULT_ACTIVITY_LOOKBACK_MS = 12 * 60 * 1000;
const DEFAULT_STOP_GRACE_MS = 3 * 60 * 1000;
const DEFAULT_RUNTIME_DRIVING_LOOKBACK_MS = 90 * 1000;
const DEFAULT_RUNTIME_DRIVING_SPEED_MPS = 8;
const DEFAULT_RUNTIME_DRIVING_ACCURACY_METERS = 120;
const driveGateDebugListeners = new Set();
let driveGateDebugState = {
    activityUpdatesRunning: false,
    backendRunning: false,
    lastAutomotiveAt: 0,
    latestActivity: null,
    lastDecision: null,
    lastRefresh: null,
    lastSupportCheck: null,
    lastRuntimeSync: null,
    motionAuthorizationStatus: 'unknown',
    motionAvailable: false,
    motionSupported: false,
    started: false,
};

function emitDriveGateDebugState() {
    driveGateDebugListeners.forEach(listener => {
        try {
            listener(driveGateDebugState);
        } catch (error) {
            console.warn('Predictive drive gate debug listener failed:', error?.message || error);
        }
    });
}

function updateDriveGateDebugState(patch = {}) {
    driveGateDebugState = {
        ...driveGateDebugState,
        ...patch,
    };
    emitDriveGateDebugState();
}

export function getPredictiveFuelingDriveGateDebugState() {
    return driveGateDebugState;
}

export function subscribeToPredictiveFuelingDriveGateDebugState(listener) {
    if (typeof listener !== 'function') {
        return () => { };
    }

    driveGateDebugListeners.add(listener);
    try {
        listener(driveGateDebugState);
    } catch (error) {
        console.warn('Predictive drive gate debug initial emit failed:', error?.message || error);
    }

    return () => {
        driveGateDebugListeners.delete(listener);
    };
}

export function createPredictiveFuelingDriveGate(options = {}) {
    const now = typeof options.now === 'function' ? options.now : () => Date.now();
    const activityLookbackMs = options.activityLookbackMs || DEFAULT_ACTIVITY_LOOKBACK_MS;
    const stopGraceMs = options.stopGraceMs || DEFAULT_STOP_GRACE_MS;
    const activityApi = options.activityApi || {
        getAuthorizationStatusAsync: getPredictiveDrivingActivityAuthorizationStatusAsync,
        getLatestActivityAsync: getLatestPredictiveDrivingActivityAsync,
        isAutomotive: isPredictiveDrivingActivityAutomotive,
        isAvailable: isPredictiveDrivingActivityAvailable,
        isConfidentlyNonAutomotive: isPredictiveDrivingActivityConfidentlyNonAutomotive,
        isSupportedAsync: isPredictiveDrivingActivitySupportedAsync,
        startUpdatesAsync: startPredictiveDrivingActivityUpdatesAsync,
        stopUpdatesAsync: stopPredictiveDrivingActivityUpdatesAsync,
        subscribe: subscribeToPredictiveDrivingActivityUpdates,
    };
    const backendApi = options.backendApi || {
        ensureBootstrapActive: ensurePredictiveFuelingBootstrapActiveAsync,
        getState: getPredictiveFuelingBackendState,
        ensureStarted: ensurePredictiveFuelingBackendStarted,
        isRunning: isPredictiveFuelingBackendRunning,
        stop: stopPredictiveFuelingBackend,
        updateConfig: updatePredictiveFuelingBackendConfig,
    };
    const appStateApi = options.appStateApi || AppState;
    const sessionApi = options.sessionApi || {
        loadAsync: loadPredictiveDrivingSessionAsync,
        markAutomotiveAsync: markPredictiveDrivingAutomotiveAsync,
    };

    let started = false;
    let backendRunning = false;
    let activityUpdatesRunning = false;
    let lastAutomotiveAt = 0;
    let latestActivity = null;
    let preferences = {};
    let activitySubscriptionCleanup = null;
    let appStateSubscription = null;

    function isRuntimeStateDrivingCandidate(runtimeState, currentTime = now()) {
        const latestSample = runtimeState?.runtimeState?.lastLocationSample
            || runtimeState?.runtimeState?.recentSamples?.[runtimeState?.runtimeState?.recentSamples?.length - 1]
            || null;
        const sampleSpeed = Number(latestSample?.speed);
        const sampleAccuracy = Number(latestSample?.accuracy);
        const sampleTimestamp = Number(latestSample?.timestamp) || 0;
        const lastProcessedAt = Number(runtimeState?.runtimeState?.lastProcessedAt) || sampleTimestamp;
        const freshnessTimestamp = Math.max(sampleTimestamp, lastProcessedAt);

        if (!Number.isFinite(sampleSpeed) || sampleSpeed < DEFAULT_RUNTIME_DRIVING_SPEED_MPS) {
            return false;
        }

        if (Number.isFinite(sampleAccuracy) && sampleAccuracy > DEFAULT_RUNTIME_DRIVING_ACCURACY_METERS) {
            return false;
        }

        if (!Number.isFinite(freshnessTimestamp) || freshnessTimestamp <= 0) {
            return false;
        }

        return (currentTime - freshnessTimestamp) <= DEFAULT_RUNTIME_DRIVING_LOOKBACK_MS;
    }

    function syncBackendRunningState(reason = 'state-check') {
        const actualBackendRunning = typeof backendApi.isRunning === 'function'
            ? Boolean(backendApi.isRunning())
            : backendRunning;

        if (actualBackendRunning === backendRunning) {
            return backendRunning;
        }

        backendRunning = actualBackendRunning;
        updateDriveGateDebugState({
            backendRunning: actualBackendRunning,
            lastRuntimeSync: {
                at: now(),
                backendRunning: actualBackendRunning,
                reason,
            },
        });
        return backendRunning;
    }

    async function startBackendIfNeeded() {
        syncBackendRunningState('start-backend-if-needed');
        if (backendRunning) {
            backendApi.updateConfig(preferences);
            updateDriveGateDebugState({
                backendRunning: true,
                lastDecision: {
                    at: now(),
                    action: 'retain-backend',
                    reason: 'already-running',
                },
            });
            return;
        }

        await backendApi.ensureStarted(preferences);
        backendRunning = true;
        updateDriveGateDebugState({
            backendRunning: true,
            lastDecision: {
                at: now(),
                action: 'start-backend',
                reason: 'drive-detected',
            },
        });
    }

    function stopBackendIfNeeded(reason = 'not-driving') {
        syncBackendRunningState(`stop-backend-if-needed:${reason}`);
        if (!backendRunning) {
            updateDriveGateDebugState({
                lastDecision: {
                    at: now(),
                    action: 'retain-stopped',
                    reason,
                },
            });
            return;
        }

        backendApi.stop();
        backendRunning = false;
        updateDriveGateDebugState({
            backendRunning: false,
            lastDecision: {
                at: now(),
                action: 'stop-backend',
                reason,
            },
        });
    }

    async function canMonitorDrivingActivityAsync() {
        const isAvailable = activityApi.isAvailable();
        if (!isAvailable) {
            updateDriveGateDebugState({
                lastSupportCheck: {
                    at: now(),
                    available: false,
                    supported: false,
                    reason: 'api-unavailable',
                },
                motionAvailable: false,
                motionSupported: false,
            });
            return false;
        }

        if (typeof activityApi.isSupportedAsync !== 'function') {
            updateDriveGateDebugState({
                lastSupportCheck: {
                    at: now(),
                    available: true,
                    supported: true,
                    reason: 'support-api-missing-assume-supported',
                },
                motionAvailable: true,
                motionSupported: true,
            });
            return true;
        }

        try {
            const isSupported = Boolean(await activityApi.isSupportedAsync());
            updateDriveGateDebugState({
                lastSupportCheck: {
                    at: now(),
                    available: true,
                    supported: isSupported,
                    reason: isSupported ? 'supported' : 'unsupported',
                },
                motionAvailable: true,
                motionSupported: isSupported,
            });
            return isSupported;
        } catch (error) {
            updateDriveGateDebugState({
                lastSupportCheck: {
                    at: now(),
                    available: true,
                    supported: false,
                    reason: 'support-check-failed',
                    error: error?.message || String(error),
                },
                motionAvailable: true,
                motionSupported: false,
            });
            return false;
        }
    }

    async function syncActivityUpdatesAsync() {
        const canMonitor = await canMonitorDrivingActivityAsync();

        if (!canMonitor) {
            if (activityUpdatesRunning) {
                await activityApi.stopUpdatesAsync().catch(() => { });
                activityUpdatesRunning = false;
            }
            updateDriveGateDebugState({
                activityUpdatesRunning: false,
                lastRefresh: {
                    at: now(),
                    monitoring: false,
                    reason: 'cannot-monitor-motion',
                },
            });
            return false;
        }

        const authorizationStatus = await activityApi.getAuthorizationStatusAsync();
        updateDriveGateDebugState({
            motionAuthorizationStatus: authorizationStatus,
        });
        if (authorizationStatus !== 'authorized') {
            if (activityUpdatesRunning) {
                await activityApi.stopUpdatesAsync().catch(() => { });
                activityUpdatesRunning = false;
                updateDriveGateDebugState({ activityUpdatesRunning: false });
            }
            updateDriveGateDebugState({
                lastRefresh: {
                    at: now(),
                    monitoring: false,
                    reason: 'motion-not-authorized',
                    authorizationStatus,
                },
            });
            return false;
        }

        if (!activityUpdatesRunning) {
            await activityApi.startUpdatesAsync();
            activityUpdatesRunning = true;
            updateDriveGateDebugState({ activityUpdatesRunning: true });
        }

        updateDriveGateDebugState({
            lastRefresh: {
                at: now(),
                monitoring: true,
                reason: activityUpdatesRunning ? 'motion-updates-running' : 'motion-updates-started',
                authorizationStatus,
            },
        });

        return true;
    }

    async function reconcile(activity) {
        latestActivity = activity || latestActivity;
        updateDriveGateDebugState({
            latestActivity,
        });
        const currentTime = now();

        if (activityApi.isAutomotive(activity)) {
            lastAutomotiveAt = Number(activity?.timestamp) || currentTime;
            void sessionApi.markAutomotiveAsync(lastAutomotiveAt).catch(() => { });
            updateDriveGateDebugState({ lastAutomotiveAt });
            await startBackendIfNeeded();
            updateDriveGateDebugState({
                lastDecision: {
                    at: currentTime,
                    action: 'start-backend',
                    reason: 'automotive-activity',
                },
            });
            return;
        }

        if (!activity) {
            if (lastAutomotiveAt > 0 && (currentTime - lastAutomotiveAt) < stopGraceMs) {
                await startBackendIfNeeded();
                updateDriveGateDebugState({
                    lastDecision: {
                        at: currentTime,
                        action: 'retain-backend',
                        reason: 'within-stop-grace-without-fresh-activity',
                    },
                });
                return;
            }

            stopBackendIfNeeded('no-recent-activity');
            return;
        }

        if (activityApi.isConfidentlyNonAutomotive(activity)) {
            if (lastAutomotiveAt > 0 && (currentTime - lastAutomotiveAt) < stopGraceMs) {
                await startBackendIfNeeded();
                updateDriveGateDebugState({
                    lastDecision: {
                        at: currentTime,
                        action: 'retain-backend',
                        reason: 'non-automotive-but-within-stop-grace',
                    },
                });
                return;
            }

            stopBackendIfNeeded('confidently-non-automotive');
            return;
        }

        if (backendRunning || (lastAutomotiveAt > 0 && (currentTime - lastAutomotiveAt) < stopGraceMs)) {
            await startBackendIfNeeded();
            updateDriveGateDebugState({
                lastDecision: {
                    at: currentTime,
                    action: 'retain-backend',
                    reason: backendRunning
                        ? 'backend-already-running-with-ambiguous-activity'
                        : 'ambiguous-activity-within-stop-grace',
                },
            });
            return;
        }

        stopBackendIfNeeded('ambiguous-non-driving-activity');
    }

    async function refreshLatestActivity() {
        const isMonitoring = await syncActivityUpdatesAsync();
        if (!isMonitoring) {
            syncBackendRunningState('refresh-latest-activity:monitoring-unavailable');
            const backendState = typeof backendApi.getState === 'function'
                ? backendApi.getState()
                : null;
            if (backendRunning && isRuntimeStateDrivingCandidate(backendState)) {
                updateDriveGateDebugState({
                    lastDecision: {
                        at: now(),
                        action: 'retain-backend',
                        reason: 'monitoring-unavailable-runtime-driving',
                    },
                });
                return null;
            }
            stopBackendIfNeeded('monitoring-unavailable');
            return null;
        }

        const activity = await activityApi.getLatestActivityAsync({
            lookbackMs: activityLookbackMs,
        });
        updateDriveGateDebugState({
            lastRefresh: {
                at: now(),
                monitoring: true,
                reason: activity ? 'activity-fetched' : 'no-recent-activity',
                authorizationStatus: driveGateDebugState.motionAuthorizationStatus,
                latestActivity: activity,
            },
        });
        await reconcile(activity);
        return activity;
    }

    async function start() {
        if (!started) {
            started = true;
            updateDriveGateDebugState({ started: true });
            activitySubscriptionCleanup = activityApi.subscribe(activity => {
                void reconcile(activity);
            });
            appStateSubscription = appStateApi.addEventListener('change', nextState => {
                if (nextState === 'active') {
                    void refreshLatestActivity();
                }
            });
        } else {
            backendApi.updateConfig(preferences);
        }

        syncBackendRunningState('start');
        if (typeof sessionApi.loadAsync === 'function') {
            try {
                const persistedSession = await sessionApi.loadAsync();
                const persistedAutomotiveAt = Number(persistedSession?.lastAutomotiveAt) || 0;
                if (persistedAutomotiveAt > lastAutomotiveAt) {
                    lastAutomotiveAt = persistedAutomotiveAt;
                    updateDriveGateDebugState({ lastAutomotiveAt });
                }
            } catch (error) {
                // Ignore session hydration failures; live motion still drives runtime state.
            }
        }

        if (typeof backendApi.ensureBootstrapActive === 'function') {
            await backendApi.ensureBootstrapActive().catch(() => { });
        }
        await refreshLatestActivity();
    }

    function updatePreferences(nextPreferences = {}) {
        preferences = { ...nextPreferences };
        syncBackendRunningState('update-preferences');
        if (backendRunning) {
            backendApi.updateConfig(preferences);
        }
    }

    async function stop() {
        started = false;
        updateDriveGateDebugState({
            started: false,
        });

        if (activitySubscriptionCleanup) {
            activitySubscriptionCleanup();
            activitySubscriptionCleanup = null;
        }

        if (appStateSubscription) {
            appStateSubscription.remove();
            appStateSubscription = null;
        }

        await activityApi.stopUpdatesAsync().catch(() => { });
        activityUpdatesRunning = false;
        updateDriveGateDebugState({
            activityUpdatesRunning: false,
        });
        stopBackendIfNeeded('drive-gate-stopped');
    }

    function getState() {
        syncBackendRunningState('get-state');
        return {
            activityUpdatesRunning,
            backendRunning,
            latestActivity,
            lastAutomotiveAt,
            started,
        };
    }

    return {
        getState,
        refreshLatestActivity,
        start,
        stop,
        updatePreferences,
    };
}

export default {
    createPredictiveFuelingDriveGate,
    getPredictiveFuelingDriveGateDebugState,
    subscribeToPredictiveFuelingDriveGateDebugState,
};
