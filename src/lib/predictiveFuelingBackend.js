const { getDrivingRouteAsync } = require('./FuelUpMapKitRouting');
const {
  clearQueuedPredictiveTaskEventsAsync,
  drainQueuedPredictiveTaskEventsAsync,
  ensurePredictiveLocationTrackingActiveAsync,
  stopPredictiveGeofencingAsync,
  stopPredictiveLocationUpdatesAsync,
  subscribeToPredictiveGeofenceEvents,
  subscribeToPredictiveLocationUpdates,
  syncPredictiveGeofencesAsync,
} = require('./predictiveLocation');
const {
  clearPredictiveDrivingSessionAsync,
} = require('./predictiveDrivingSessionStore.js');
const {
  addLiveActivityInteractionListener,
  addPredictiveNotificationResponseListener,
  ensurePredictiveNotificationCategoryAsync,
  openNavigationForStation,
  PREDICTIVE_NOTIFICATION_ACTION_DISMISS,
  PREDICTIVE_NOTIFICATION_ACTION_NAVIGATE,
} = require('./notifications.js');
const {
  clearPredictiveFuelingProfileAsync,
} = require('./predictiveFuelingProfileStore.js');
const {
  clearPredictiveFuelingStateAsync,
} = require('./predictiveFuelingStateStore.js');
const {
  createPredictiveFuelingRuntime,
} = require('./predictiveFuelingRuntime.js');
const { refreshFuelPriceSnapshotAlongTrajectory } = require('../services/fuel');

let runtime = null;
let listenerCleanupFns = [];
let started = false;
let runtimeSubscriptionCleanup = null;
let lastTrackingMode = null;
let runtimeShutdownPromise = null;
const backendListeners = new Set();
const backendDebugListeners = new Set();
let backendDebugState = {
  started: false,
  lastLifecycle: null,
  lastQueuedDrain: null,
};

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

function emitBackendDebugState() {
  backendDebugListeners.forEach(listener => {
    try {
      listener(backendDebugState);
    } catch (error) {
      console.warn('Predictive backend debug listener failed:', error?.message || error);
    }
  });
}

function updateBackendDebugState(patch = {}) {
  backendDebugState = {
    ...backendDebugState,
    ...patch,
  };
  emitBackendDebugState();
}

function emitBackendState(snapshot = null) {
  const payload = snapshot || runtime?.getState() || null;
  backendListeners.forEach(listener => {
    try {
      listener(payload);
    } catch (error) {
      console.warn('Predictive backend listener failed:', error?.message || error);
    }
  });
}

function attachRuntimeSubscription() {
  if (runtimeSubscriptionCleanup) {
    try {
      runtimeSubscriptionCleanup();
    } catch (error) {
      console.warn('Predictive runtime subscription cleanup failed:', error?.message || error);
    }
    runtimeSubscriptionCleanup = null;
  }

  if (!runtime || typeof runtime.subscribe !== 'function') {
    return;
  }

  runtimeSubscriptionCleanup = runtime.subscribe(snapshot => {
    const trackingMode = snapshot?.tracking?.mode || null;
    if (trackingMode && trackingMode !== lastTrackingMode) {
      lastTrackingMode = trackingMode;
      void ensurePredictiveLocationTrackingActiveAsync({ mode: trackingMode }).catch(error => {
        console.warn('Predictive location tracking sync failed:', error?.message || error);
      });
    }
    emitBackendState(snapshot);
  });
}

async function drainQueuedTaskEvents() {
  const queuedEvents = await drainQueuedPredictiveTaskEventsAsync();
  updateBackendDebugState({
    lastQueuedDrain: {
      at: Date.now(),
      drainedCount: queuedEvents.length,
      reason: queuedEvents.length > 0 ? 'replayed-queued-events' : 'queue-empty',
    },
  });

  for (const event of queuedEvents) {
    if (!runtime) {
      return;
    }

    if (event?.kind === 'location') {
      await runtime.processLocationPayload(event.payload);
      continue;
    }

    if (event?.kind === 'geofence') {
      await runtime.processGeofenceEvent(event.payload);
    }
  }
}

function disposeListeners() {
  listenerCleanupFns.forEach(cleanup => {
    try {
      cleanup();
    } catch (error) {
      console.warn('Predictive fueling cleanup failed:', error?.message || error);
    }
  });
  listenerCleanupFns = [];
}

function buildRuntime(preferences) {
  return createPredictiveFuelingRuntime({
    preferences,
    notifications: {
      addPredictiveNotificationResponseListener,
      endLiveActivity: require('./notifications.js').endLiveActivity,
      openNavigationForStation,
      schedulePredictiveRecommendationNotification: require('./notifications.js').schedulePredictiveRecommendationNotification,
      startPredictiveLiveActivity: require('./notifications.js').startPredictiveLiveActivity,
      updatePredictiveLiveActivity: require('./notifications.js').updatePredictiveLiveActivity,
    },
    prefetchSnapshot: (input) => refreshFuelPriceSnapshotAlongTrajectory({
      ...input,
      routeProvider: getDrivingRouteAsync,
    }),
    syncGeofences: async (regions) => syncPredictiveGeofencesAsync(regions),
  });
}

async function ensurePredictiveFuelingBootstrapActiveAsync() {
  try {
    const result = await ensurePredictiveLocationTrackingActiveAsync({ mode: 'monitoring' });
    updateBackendDebugState({
      lastLifecycle: {
        at: Date.now(),
        action: 'bootstrap-location',
        reason: result?.started ? 'location-bootstrap-active' : 'location-bootstrap-inactive',
      },
    });
    return result;
  } catch (error) {
    console.warn('Predictive location bootstrap failed:', error?.message || error);
    updateBackendDebugState({
      lastLifecycle: {
        at: Date.now(),
        action: 'bootstrap-location',
        reason: 'location-bootstrap-failed',
        error: error?.message || String(error),
      },
    });
    throw error;
  }
}

async function ensurePredictiveFuelingBackendStarted(preferences = {}) {
  if (runtimeShutdownPromise) {
    await runtimeShutdownPromise;
  }

  if (!runtime) {
    runtime = buildRuntime(preferences);
    updateBackendDebugState({
      lastLifecycle: {
        at: Date.now(),
        action: 'build-runtime',
        reason: 'created-runtime-instance',
      },
    });
  } else {
    runtime.updateConfig({ preferences });
    updateBackendDebugState({
      lastLifecycle: {
        at: Date.now(),
        action: 'update-runtime-config',
        reason: 'runtime-already-existed',
      },
    });
  }

  await runtime.bootstrap();
  attachRuntimeSubscription();
  const initialSnapshot = runtime.getState();
  lastTrackingMode = initialSnapshot?.tracking?.mode || null;
  emitBackendState(initialSnapshot);
  if (lastTrackingMode) {
    try {
      await ensurePredictiveLocationTrackingActiveAsync({ mode: lastTrackingMode });
    } catch (error) {
      console.warn('Predictive location tracking start failed:', error?.message || error);
    }
  }

  if (started) {
    await drainQueuedTaskEvents();
    return runtime;
  }

  started = true;
  updateBackendDebugState({
    started: true,
    lastLifecycle: {
      at: Date.now(),
      action: 'start-backend',
      reason: 'listeners-attached',
    },
  });

  try {
    await ensurePredictiveNotificationCategoryAsync();
  } catch (error) {
    console.warn('Predictive notification category setup failed:', error?.message || error);
  }

  listenerCleanupFns.push(
    subscribeToPredictiveLocationUpdates(payload => {
      void runtime.processLocationPayload(payload).catch(error => {
        console.warn('Predictive fueling location processing failed:', error?.message || error);
      });
    })
  );

  listenerCleanupFns.push(
    subscribeToPredictiveGeofenceEvents(payload => {
      void runtime.processGeofenceEvent(payload).catch(error => {
        console.warn('Predictive fueling geofence processing failed:', error?.message || error);
      });
    })
  );

  listenerCleanupFns.push(
    addLiveActivityInteractionListener({
      onNavigate: () => {
        void runtime.handleNavigateToStation().catch(error => {
          console.warn('Predictive live activity navigate failed:', error?.message || error);
        });
      },
      onCancel: () => {
        void runtime.dismissRecommendation().catch(error => {
          console.warn('Predictive live activity cancel failed:', error?.message || error);
        });
      },
    })
  );

  listenerCleanupFns.push(
    addPredictiveNotificationResponseListener(response => {
      const stationId = response?.data?.station?.stationId || response?.data?.stationId || null;
      if (response?.actionIdentifier === PREDICTIVE_NOTIFICATION_ACTION_NAVIGATE) {
        void runtime.handleNavigateToStation(stationId).catch(error => {
          console.warn('Predictive notification navigate failed:', error?.message || error);
        });
        return;
      }

      if (response?.actionIdentifier === PREDICTIVE_NOTIFICATION_ACTION_DISMISS) {
        void runtime.dismissRecommendation(stationId).catch(error => {
          console.warn('Predictive notification dismiss failed:', error?.message || error);
        });
      }
    })
  );

  await drainQueuedTaskEvents();
  return runtime;
}

async function processPredictiveFuelingLocationPayloadAsync(payload, preferences = {}) {
  const runtimeInstance = await ensurePredictiveFuelingBackendStarted(preferences);
  return runtimeInstance.processLocationPayload(payload);
}

async function processPredictiveFuelingGeofenceEventAsync(payload, preferences = {}) {
  const runtimeInstance = await ensurePredictiveFuelingBackendStarted(preferences);
  return runtimeInstance.processGeofenceEvent(payload);
}

function updatePredictiveFuelingBackendConfig(preferences = {}) {
  if (!runtime) {
    return;
  }

  runtime.updateConfig({ preferences });
}

function subscribeToPredictiveFuelingBackend(listener) {
  if (typeof listener !== 'function') {
    return () => {};
  }

  backendListeners.add(listener);
  try {
    listener(runtime?.getState() || null);
  } catch (error) {
    console.warn('Predictive backend listener initial emit failed:', error?.message || error);
  }

  return () => {
    backendListeners.delete(listener);
  };
}

function getPredictiveFuelingBackendDebugState() {
  return backendDebugState;
}

function subscribeToPredictiveFuelingBackendDebug(listener) {
  if (typeof listener !== 'function') {
    return () => {};
  }

  backendDebugListeners.add(listener);
  try {
    listener(backendDebugState);
  } catch (error) {
    console.warn('Predictive backend debug initial emit failed:', error?.message || error);
  }

  return () => {
    backendDebugListeners.delete(listener);
  };
}

function getPredictiveFuelingBackendState() {
  return runtime?.getState() || null;
}

function isPredictiveFuelingBackendRunning() {
  return Boolean(runtime);
}

async function resetPredictiveFuelingBackendData() {
  if (runtime && typeof runtime.resetAllData === 'function') {
    const snapshot = await runtime.resetAllData();
    emitBackendState(snapshot);
    return snapshot;
  }

  await Promise.all([
    clearPredictiveFuelingStateAsync(),
    clearPredictiveFuelingProfileAsync(),
  ]);
  emitBackendState(null);
  return null;
}

function stopPredictiveFuelingBackend() {
  const runtimeToShutdown = runtime;

  disposeListeners();
  if (runtimeSubscriptionCleanup) {
    try {
      runtimeSubscriptionCleanup();
    } catch (error) {
      console.warn('Predictive runtime subscription cleanup failed:', error?.message || error);
    }
    runtimeSubscriptionCleanup = null;
  }
  if (runtimeToShutdown && typeof runtimeToShutdown.shutdown === 'function') {
    const shutdownPromise = runtimeToShutdown.shutdown().catch(error => {
      console.warn('Predictive backend shutdown failed:', error?.message || error);
    }).finally(() => {
      if (runtimeShutdownPromise === shutdownPromise) {
        runtimeShutdownPromise = null;
      }
    });
    runtimeShutdownPromise = shutdownPromise;
  }
  void stopPredictiveGeofencingAsync().catch(error => {
    if (isPredictiveTaskMissingError(error)) {
      return;
    }
    console.warn('Predictive geofencing stop failed:', error?.message || error);
  });
  void ensurePredictiveLocationTrackingActiveAsync({ mode: 'monitoring' }).catch(error => {
    console.warn('Predictive location monitoring reset failed:', error?.message || error);
  });
  started = false;
  lastTrackingMode = null;
  runtime = null;
  updateBackendDebugState({
    started: false,
    lastLifecycle: {
      at: Date.now(),
      action: 'stop-backend',
      reason: 'backend-stopped',
    },
  });
  emitBackendState(null);
}

async function disablePredictiveFuelingInfrastructureAsync() {
  stopPredictiveFuelingBackend();
  await Promise.all([
    clearQueuedPredictiveTaskEventsAsync().catch(error => {
      console.warn('Predictive queued event clear failed:', error?.message || error);
    }),
    stopPredictiveLocationUpdatesAsync().catch(error => {
      if (isPredictiveTaskMissingError(error)) {
        return;
      }
      console.warn('Predictive location stop failed:', error?.message || error);
    }),
    stopPredictiveGeofencingAsync().catch(error => {
      if (isPredictiveTaskMissingError(error)) {
        return;
      }
      console.warn('Predictive geofencing stop failed:', error?.message || error);
    }),
    clearPredictiveDrivingSessionAsync().catch(error => {
      console.warn('Predictive driving session clear failed:', error?.message || error);
    }),
  ]);
  updateBackendDebugState({
    started: false,
    lastLifecycle: {
      at: Date.now(),
      action: 'disable-infrastructure',
      reason: 'predictive-disabled-or-reset',
    },
  });
}

module.exports = {
  disablePredictiveFuelingInfrastructureAsync,
  ensurePredictiveFuelingBootstrapActiveAsync,
  ensurePredictiveFuelingBackendStarted,
  getPredictiveFuelingBackendDebugState,
  getPredictiveFuelingBackendState,
  isPredictiveFuelingBackendRunning,
  processPredictiveFuelingGeofenceEventAsync,
  processPredictiveFuelingLocationPayloadAsync,
  resetPredictiveFuelingBackendData,
  stopPredictiveFuelingBackend,
  subscribeToPredictiveFuelingBackend,
  subscribeToPredictiveFuelingBackendDebug,
  updatePredictiveFuelingBackendConfig,
};
