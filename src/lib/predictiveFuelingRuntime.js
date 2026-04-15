const {
  createPredictiveLocationPrefetchController,
} = require('./predictiveLocationPrefetchController.js');
const {
  createPredictiveRecommender,
} = require('./predictiveRecommender.js');
const {
  estimateFuelState,
} = require('./rangeEstimator.js');
const {
  calculateDistanceMeters,
  isTrajectoryRouteUnavailableError,
} = require('./trajectoryFuelFetch.js');
const {
  createDefaultPredictiveFuelingProfile,
  loadPredictiveFuelingProfileAsync,
  normalizePredictiveFuelingProfile,
  recordStationVisit,
  savePredictiveFuelingProfileAsync,
  updateProfileMileage,
} = require('./predictiveFuelingProfileStore.js');
const {
  createDefaultPredictiveFuelingState,
  loadPredictiveFuelingStateAsync,
  normalizePredictiveFuelingState,
  savePredictiveFuelingStateAsync,
} = require('./predictiveFuelingStateStore.js');

const DEFAULT_NOTIFICATION_COOLDOWN_MS = 10 * 60 * 1000;
const DEFAULT_STATION_SUPPRESS_MS = 30 * 60 * 1000;
const DEFAULT_STATION_VISIT_DWELL_MS = 2 * 60 * 1000;
const DEFAULT_STATION_FUEL_DWELL_MS = 4.5 * 60 * 1000;
const DEFAULT_LIVE_ACTIVITY_UPDATE_MIN_INTERVAL_MS = 15 * 1000;
const DEFAULT_GEOFENCE_RADIUS_METERS = 180;
const DEFAULT_FOCUS_GEOFENCE_RADIUS_METERS = 240;
const DEFAULT_MAX_GEOFENCES = 4;
const DEFAULT_PASSIVE_PREFETCH_COOLDOWN_MS = 4 * 60 * 1000;
const DEFAULT_ENGAGED_PREFETCH_COOLDOWN_MS = 75 * 1000;
const DEFAULT_STATE_PERSIST_INTERVAL_MS = 60 * 1000;

function toFiniteNumber(value) {
  if (value == null || value === '') {
    return null;
  }
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function uniqueBy(items, getKey) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    const key = getKey(item);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }

  return result;
}

function normalizeLocationObject(locationObject) {
  const coords = locationObject?.coords || locationObject || {};
  const latitude = toFiniteNumber(coords.latitude);
  const longitude = toFiniteNumber(coords.longitude);
  if (latitude === null || longitude === null) {
    return null;
  }

  return {
    latitude,
    longitude,
    speed: toFiniteNumber(coords.speed ?? locationObject?.speed) ?? 0,
    heading: toFiniteNumber(coords.heading ?? coords.course ?? locationObject?.heading ?? locationObject?.course),
    accuracy: toFiniteNumber(coords.accuracy ?? locationObject?.accuracy),
    timestamp: toFiniteNumber(coords.timestamp ?? locationObject?.timestamp) ?? Date.now(),
    eventType: locationObject?.eventType ? String(locationObject.eventType) : undefined,
  };
}

function normalizeLocationPayload(payload) {
  return (Array.isArray(payload?.locations) ? payload.locations : [])
    .map(normalizeLocationObject)
    .filter(Boolean);
}

function buildStationLookup(knownStations) {
  return new Map((knownStations || [])
    .filter(station => station?.stationId)
    .map(station => [String(station.stationId), station]));
}

function estimateGallonsFromProfile(profile) {
  const historicalGallons = (profile?.fillUpHistory || [])
    .map(entry => toFiniteNumber(entry?.gallons))
    .filter(value => value !== null && value >= 4);

  if (historicalGallons.length === 0) {
    return null;
  }

  return historicalGallons.reduce((sum, value) => sum + value, 0) / historicalGallons.length;
}

function estimateTotalSavingsDollars(recommendation, gallonsEstimate) {
  const savingsPerGallon = toFiniteNumber(recommendation?.savings);
  const normalizedGallonsEstimate = toFiniteNumber(gallonsEstimate);
  if (
    savingsPerGallon === null ||
    savingsPerGallon <= 0 ||
    normalizedGallonsEstimate === null ||
    normalizedGallonsEstimate <= 0
  ) {
    return null;
  }

  return savingsPerGallon * normalizedGallonsEstimate;
}

function buildNotificationCopy({ recommendation, station, gallonsEstimate }) {
  const forwardDistanceMeters = toFiniteNumber(recommendation?.forwardDistance);
  const stationName = String(station?.stationName || station?.brand || '').trim();
  const savingsPerGallon = toFiniteNumber(recommendation?.savings);
  const totalSavings = estimateTotalSavingsDollars(recommendation, gallonsEstimate);

  if (!stationName || forwardDistanceMeters === null || forwardDistanceMeters < 0) {
    return null;
  }

  const forwardDistanceMiles = forwardDistanceMeters / 1609.344;

  if (totalSavings !== null && totalSavings > 0.1) {
    return {
      title: `Save $${totalSavings.toFixed(2)} at ${stationName}`,
      body: `${forwardDistanceMiles.toFixed(1)} mi ahead. Open directions when it’s safe.`,
    };
  }

  if (savingsPerGallon !== null && savingsPerGallon > 0) {
    return {
      title: `${stationName} is $${savingsPerGallon.toFixed(2)}/gal cheaper`,
      body: `${forwardDistanceMiles.toFixed(1)} mi ahead. Open directions when it’s safe.`,
    };
  }

  return {
    title: `${stationName} is likely your next stop`,
    body: `${forwardDistanceMiles.toFixed(1)} mi ahead. Decide while you’re stopped, not while you’re moving.`,
  };
}

function resolveObservedSpeedMps(recentSamples, currentSample) {
  const currentSpeed = toFiniteNumber(currentSample?.speed);
  if (currentSpeed !== null && currentSpeed > 0.5) {
    return currentSpeed;
  }

  const samples = Array.isArray(recentSamples) ? recentSamples : [];
  for (let index = samples.length - 1; index >= 0; index -= 1) {
    const sampleSpeed = toFiniteNumber(samples[index]?.speed);
    if (sampleSpeed !== null && sampleSpeed > 0.5) {
      return sampleSpeed;
    }
  }

  return null;
}

function buildLiveActivityProps({
  recommendation,
  station,
  profile,
  source = 'pending',
  phase = 'approaching',
  currentSample = null,
  initialForwardDistance = null,
  recentSamples = [],
}) {
  const stationName = String(station?.stationName || station?.brand || '').trim();
  const resolvedPrice = toFiniteNumber(station?.effectivePrice ?? station?.price);
  const forwardDistanceMeters = toFiniteNumber(recommendation?.forwardDistance);
  const gallonsEstimate = estimateGallonsFromProfile(profile);
  const observedSpeedMps = resolveObservedSpeedMps(recentSamples, currentSample);

  if (
    !stationName ||
    resolvedPrice === null ||
    forwardDistanceMeters === null ||
    forwardDistanceMeters < 0 ||
    observedSpeedMps === null
  ) {
    return null;
  }

  const distanceMiles = forwardDistanceMeters / 1609.344;
  const etaMinutes = Math.max(0, forwardDistanceMeters / observedSpeedMps / 60);
  const totalSavings = estimateTotalSavingsDollars(recommendation, gallonsEstimate);
  const denominator = Math.max(
    forwardDistanceMeters,
    toFiniteNumber(initialForwardDistance) || forwardDistanceMeters || 1
  );
  const progress = denominator > 0
    ? clamp(1 - (forwardDistanceMeters / denominator), 0, 1)
    : 0;

  let status = source === 'active'
    ? 'Good time to choose'
    : 'Watching this stop ahead';
  if (phase === 'arrived') {
    status = 'At the station';
  } else if (phase === 'arriving') {
    status = 'Almost there';
  } else if (source === 'pending' && recommendation?.presentation?.attentionState === 'traffic_light_pause') {
    status = 'You’re stopped. Decide now.';
  }

  return {
    stationName,
    subtitle: station?.brand && station?.stationName && station.brand !== station.stationName
      ? String(station.brand).trim()
      : String(station?.address || '').trim(),
    price: resolvedPrice,
    savingsPerGallon: toFiniteNumber(recommendation?.savings),
    totalSavings: totalSavings !== null && totalSavings > 0 ? totalSavings.toFixed(2) : '',
    distanceMiles: distanceMiles.toFixed(distanceMiles >= 10 ? 0 : 1),
    etaMinutes: etaMinutes < 1 && etaMinutes > 0 ? '<1' : Math.round(etaMinutes).toString(),
    progress,
    status,
    phase,
  };
}

function normalizePreferences(preferences = {}) {
  return {
    preferredOctane: String(preferences?.preferredOctane || 'regular'),
    preferredProvider: String(preferences?.preferredProvider || 'gasbuddy'),
    searchRadiusMiles: Math.max(2, Math.min(15, Math.round(Number(preferences?.searchRadiusMiles) || 10))),
    navigationApp: String(preferences?.navigationApp || 'apple-maps'),
  };
}

function geofenceSignature(regions) {
  return JSON.stringify((regions || []).map(region => ({
    id: region.identifier,
    lat: Number(region.latitude).toFixed(5),
    lng: Number(region.longitude).toFixed(5),
    radius: Math.round(Number(region.radius) || 0),
  })));
}

function buildRecommenderProfile(profile, preferences) {
  return normalizePredictiveFuelingProfile({
    ...profile,
    preferredGrade: preferences.preferredOctane,
  });
}

function cloneRuntimeDebugState() {
  return {
    lifecycle: {
      bootstrappedAt: null,
      lastConfigUpdateAt: null,
      lastResetAt: null,
      lastShutdownAt: null,
    },
    lastTrackingDecision: null,
    lastLocationBatch: null,
    lastPrefetch: null,
    lastRecommendationDecision: null,
    lastNotificationDecision: null,
    lastLiveActivityDecision: null,
    lastGeofenceSync: null,
    lastGeofenceEvent: null,
    lastPersistence: null,
    trace: [],
  };
}

function createPredictiveFuelingRuntime(options = {}) {
  const notifications = options.notifications || {};
  let config = {
    preferences: normalizePreferences(options.preferences),
  };
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const loadStateAsync = options.loadStateAsync || loadPredictiveFuelingStateAsync;
  const saveStateAsync = options.saveStateAsync || savePredictiveFuelingStateAsync;
  const loadProfileAsync = options.loadProfileAsync || loadPredictiveFuelingProfileAsync;
  const saveProfileAsync = options.saveProfileAsync || savePredictiveFuelingProfileAsync;
  const updateProfileMileageImpl = options.updateProfileMileage || updateProfileMileage;
  const recordStationVisitImpl = options.recordStationVisit || recordStationVisit;
  const estimateFuelStateImpl = options.estimateFuelState || estimateFuelState;
  const stationVisitDwellMs = options.stationVisitDwellMs || DEFAULT_STATION_VISIT_DWELL_MS;
  const stationFuelDwellMs = options.stationFuelDwellMs || DEFAULT_STATION_FUEL_DWELL_MS;
  const stationSuppressMs = options.stationSuppressMs || DEFAULT_STATION_SUPPRESS_MS;
  const notificationCooldownMs = options.notificationCooldownMs || DEFAULT_NOTIFICATION_COOLDOWN_MS;
  const liveActivityUpdateMinIntervalMs = options.liveActivityUpdateMinIntervalMs || DEFAULT_LIVE_ACTIVITY_UPDATE_MIN_INTERVAL_MS;
  const geofenceRadiusMeters = options.geofenceRadiusMeters || DEFAULT_GEOFENCE_RADIUS_METERS;
  const focusGeofenceRadiusMeters = options.focusGeofenceRadiusMeters || DEFAULT_FOCUS_GEOFENCE_RADIUS_METERS;
  const maxGeofences = options.maxGeofences || DEFAULT_MAX_GEOFENCES;
  const statePersistIntervalMs = options.statePersistIntervalMs || DEFAULT_STATE_PERSIST_INTERVAL_MS;
  const syncGeofences = typeof options.syncGeofences === 'function'
    ? options.syncGeofences
    : async () => {};
  const createPrefetchController = options.createPrefetchController || createPredictiveLocationPrefetchController;
  const createRecommender = options.createRecommender || createPredictiveRecommender;

  if (typeof options.prefetchSnapshot !== 'function') {
    throw new Error('predictive fueling runtime requires a prefetchSnapshot implementation.');
  }

  let bootPromise = null;
  let runtimeState = normalizePredictiveFuelingState();
  let profile = normalizePredictiveFuelingProfile();
  let controller = null;
  let recommender = null;
  let liveActivityInstance = null;
  let latestGeofenceSignature = geofenceSignature(runtimeState.geofences);
  let lastPersistAt = 0;
  let operationQueue = Promise.resolve();
  let debugState = cloneRuntimeDebugState();
  const listeners = new Set();

  function emit() {
    const snapshot = getState();
    listeners.forEach(listener => {
      try {
        listener(snapshot);
      } catch (error) {
        console.error('Predictive fueling runtime listener failed:', error);
      }
    });
  }

  function getUrgency() {
    return estimateFuelStateImpl(profile.fillUpHistory || [], {
      milesSinceLastFill: profile.estimatedMilesSinceLastFill,
      typicalIntervalMiles: profile.typicalFillUpIntervalMiles,
    });
  }

  function pushDebugEvent(type, details = {}) {
    debugState.trace = [
      ...debugState.trace,
      {
        at: now(),
        type,
        ...details,
      },
    ].slice(-18);
  }

  function setTrackingDebug(reason) {
    const urgency = getUrgency();
    debugState.lastTrackingDecision = {
      at: now(),
      mode: getTrackingMode(),
      reason,
      urgency: toFiniteNumber(urgency?.urgency) || 0,
      milesSinceLastFill: toFiniteNumber(profile?.estimatedMilesSinceLastFill),
      hasArrivalSession: Boolean(runtimeState.arrivalSession?.stationId),
      hasActiveRecommendation: Boolean(runtimeState.activeRecommendation?.stationId),
      hasPendingRecommendation: Boolean(runtimeState.pendingRecommendation?.stationId),
    };
  }

  function getTrackingMode() {
    const urgency = toFiniteNumber(getUrgency()?.urgency) || 0;
    if (runtimeState.arrivalSession?.stationId) {
      return 'engaged';
    }
    if (runtimeState.activeRecommendation?.stationId || runtimeState.pendingRecommendation?.stationId) {
      return 'engaged';
    }
    return urgency >= 0.72 ? 'engaged' : 'monitoring';
  }

  function getPrefetchCooldownMs() {
    return getTrackingMode() === 'engaged'
      ? DEFAULT_ENGAGED_PREFETCH_COOLDOWN_MS
      : DEFAULT_PASSIVE_PREFETCH_COOLDOWN_MS;
  }

  function enqueueOperation(operation) {
    const run = operationQueue
      .catch(() => { })
      .then(operation);
    operationQueue = run.catch(() => { });
    return run;
  }

  function getStationById(stationId) {
    return buildStationLookup(runtimeState.knownStations).get(String(stationId)) || null;
  }

  function rememberStations(stations) {
    const normalizedStations = (Array.isArray(stations) ? stations : [])
      .filter(station => station?.stationId);
    runtimeState.knownStations = uniqueBy([
      ...normalizedStations,
      ...runtimeState.knownStations,
    ], station => station?.stationId).slice(0, 16);
  }

  function appendRecentSamples(samples) {
    runtimeState.recentSamples = [
      ...runtimeState.recentSamples,
      ...samples,
    ].slice(-20);
    runtimeState.lastLocationSample = runtimeState.recentSamples[runtimeState.recentSamples.length - 1] || null;
  }

  function pruneSuppressedStations() {
    const currentTime = now();
    runtimeState.suppressedStations = Object.fromEntries(
      Object.entries(runtimeState.suppressedStations || {})
        .filter(([, expiryMs]) => (toFiniteNumber(expiryMs) || 0) > currentTime)
    );
  }

  function isStationSuppressed(stationId) {
    pruneSuppressedStations();
    const expiryMs = runtimeState.suppressedStations[String(stationId)] || 0;
    return now() < expiryMs;
  }

  function suppressStation(stationId, durationMs = stationSuppressMs) {
    if (!stationId) {
      return;
    }

    runtimeState.suppressedStations = {
      ...(runtimeState.suppressedStations || {}),
      [String(stationId)]: now() + durationMs,
    };
  }

  function rebuildRecommender() {
    recommender = createRecommender({
      cooldownMs: notificationCooldownMs,
      enforcePresentationTiming: true,
    });
    recommender.setProfile(buildRecommenderProfile(profile, config.preferences));
    recommender.setStations(runtimeState.knownStations);
    for (const sample of runtimeState.recentSamples) {
      recommender.pushLocation(sample, { urgency: getUrgency().urgency || 0 });
    }
  }

  async function persist({ force = false } = {}) {
    runtimeState = normalizePredictiveFuelingState(runtimeState);
    profile = normalizePredictiveFuelingProfile(profile);
    const currentTime = now();
    if (!force && (currentTime - lastPersistAt) < statePersistIntervalMs) {
      debugState.lastPersistence = {
        at: currentTime,
        forced: false,
        persisted: false,
        reason: 'interval-throttled',
      };
      return false;
    }
    try {
      await Promise.all([
        saveStateAsync(runtimeState),
        saveProfileAsync(profile),
      ]);
      lastPersistAt = currentTime;
      debugState.lastPersistence = {
        at: currentTime,
        forced: Boolean(force),
        persisted: true,
        reason: force ? 'forced' : 'interval-allowed',
      };
    } catch (error) {
      console.warn('Predictive fueling persistence failed:', error?.message || error);
      debugState.lastPersistence = {
        at: currentTime,
        forced: Boolean(force),
        persisted: false,
        reason: 'save-failed',
        error: error?.message || String(error),
      };
    }
    return true;
  }

  async function bootstrap() {
    if (bootPromise) {
      return bootPromise;
    }

    bootPromise = (async () => {
      runtimeState = normalizePredictiveFuelingState(await loadStateAsync());
      profile = normalizePredictiveFuelingProfile(await loadProfileAsync());
      controller = createPrefetchController({
        prefetchSnapshot: options.prefetchSnapshot,
      });
      latestGeofenceSignature = geofenceSignature(runtimeState.geofences);
      rebuildRecommender();
      lastPersistAt = 0;
      debugState.lifecycle.bootstrappedAt = now();
      pushDebugEvent('lifecycle', { action: 'bootstrap' });
      setTrackingDebug('bootstrap');
      emit();
      return getState();
    })().catch(error => {
      bootPromise = null;
      throw error;
    });

    return bootPromise;
  }

  async function syncGeofencesForKnownStations(focusStationId = null) {
    const focusStation = focusStationId ? getStationById(focusStationId) : null;
    const candidateStations = (runtimeState.knownStations || [])
      .filter(station => {
        const alongDistance = toFiniteNumber(station?.routeApproach?.alongRouteDistanceMeters);
        return alongDistance === null || (alongDistance >= 0 && alongDistance <= 8_000);
      })
      .sort((left, right) => {
        if (left.stationId === focusStationId) return -1;
        if (right.stationId === focusStationId) return 1;
        const leftDistance = toFiniteNumber(left?.routeApproach?.alongRouteDistanceMeters) ?? Number.POSITIVE_INFINITY;
        const rightDistance = toFiniteNumber(right?.routeApproach?.alongRouteDistanceMeters) ?? Number.POSITIVE_INFINITY;
        return leftDistance - rightDistance;
      })
      .slice(0, maxGeofences);

    const regions = candidateStations.map(station => ({
      identifier: `fuelup-station:${station.stationId}:${station.stationId === focusStationId ? 'focus' : 'candidate'}`,
      latitude: station.latitude,
      longitude: station.longitude,
      radius: station.stationId === focusStationId ? focusGeofenceRadiusMeters : geofenceRadiusMeters,
      notifyOnEnter: true,
      notifyOnExit: true,
    }));
    const nextSignature = geofenceSignature(regions);

    if (nextSignature === latestGeofenceSignature) {
      debugState.lastGeofenceSync = {
        at: now(),
        outcome: 'skipped',
        reason: 'signature-unchanged',
        focusStationId,
        regionCount: regions.length,
      };
      return;
    }

    try {
      await syncGeofences(regions);
      latestGeofenceSignature = nextSignature;
      runtimeState.geofences = regions;
      debugState.lastGeofenceSync = {
        at: now(),
        outcome: 'synced',
        reason: 'signature-changed',
        focusStationId,
        regionCount: regions.length,
      };
      pushDebugEvent('geofence-sync', {
        outcome: 'synced',
        focusStationId,
        regionCount: regions.length,
      });
    } catch (error) {
      console.warn('Predictive geofence sync failed:', error?.message || error);
      debugState.lastGeofenceSync = {
        at: now(),
        outcome: 'failed',
        reason: 'sync-error',
        focusStationId,
        regionCount: regions.length,
        error: error?.message || String(error),
      };
    }
  }

  async function clearLiveActivity() {
    if (liveActivityInstance && typeof notifications.endLiveActivity === 'function') {
      try {
        notifications.endLiveActivity(liveActivityInstance);
      } catch (error) {
        console.warn('Failed to end predictive live activity:', error?.message || error);
      }
    }

    liveActivityInstance = null;
    runtimeState.liveActivity = {
      active: false,
      stationId: null,
      phase: 'idle',
      initialForwardDistance: null,
      lastForwardDistance: null,
      source: null,
      lastUpdatedAt: now(),
    };
    debugState.lastLiveActivityDecision = {
      at: now(),
      outcome: 'cleared',
      reason: 'clear-live-activity',
      stationId: null,
      phase: 'idle',
      source: null,
    };
  }

  async function ensureLiveActivity({ recommendation, station, source = 'pending', phase = 'approaching' }) {
    if (
      typeof notifications.startPredictiveLiveActivity !== 'function' ||
      typeof notifications.updatePredictiveLiveActivity !== 'function'
    ) {
      return;
    }

    const lastUpdatedAt = toFiniteNumber(runtimeState.liveActivity?.lastUpdatedAt) || 0;
    if (
      runtimeState.liveActivity?.active &&
      runtimeState.liveActivity.stationId === recommendation.stationId &&
      (now() - lastUpdatedAt) < liveActivityUpdateMinIntervalMs &&
      phase === runtimeState.liveActivity.phase
    ) {
      debugState.lastLiveActivityDecision = {
        at: now(),
        outcome: 'skipped',
        reason: 'min-update-interval',
        stationId: recommendation.stationId,
        phase,
        source,
      };
      return;
    }

    const props = buildLiveActivityProps({
      recommendation,
      station,
      profile,
      source,
      phase,
      currentSample: runtimeState.lastLocationSample,
      recentSamples: runtimeState.recentSamples,
      initialForwardDistance: runtimeState.liveActivity?.stationId === recommendation.stationId
        ? runtimeState.liveActivity.initialForwardDistance
        : toFiniteNumber(recommendation.forwardDistance),
    });

    if (!props) {
      debugState.lastLiveActivityDecision = {
        at: now(),
        outcome: 'skipped',
        reason: 'insufficient-live-activity-props',
        stationId: recommendation.stationId,
        phase,
        source,
      };
      return;
    }

    const hadLiveActivityInstance = Boolean(liveActivityInstance);

    try {
      if (!liveActivityInstance) {
        liveActivityInstance = notifications.startPredictiveLiveActivity(props);
      } else {
        const updatedExistingActivity = notifications.updatePredictiveLiveActivity(liveActivityInstance, props);
        if (!updatedExistingActivity) {
          liveActivityInstance = notifications.startPredictiveLiveActivity(props);
        }
      }
    } catch (error) {
      console.warn('Predictive live activity update failed:', error?.message || error);
      debugState.lastLiveActivityDecision = {
        at: now(),
        outcome: 'failed',
        reason: 'live-activity-update-error',
        stationId: recommendation.stationId,
        phase,
        source,
        error: error?.message || String(error),
      };
    }

    runtimeState.liveActivity = {
      active: Boolean(liveActivityInstance),
      stationId: recommendation.stationId,
      phase,
      initialForwardDistance: runtimeState.liveActivity?.stationId === recommendation.stationId
        ? runtimeState.liveActivity.initialForwardDistance
        : toFiniteNumber(recommendation.forwardDistance),
      lastForwardDistance: toFiniteNumber(recommendation.forwardDistance),
      source,
      lastUpdatedAt: now(),
    };
    debugState.lastLiveActivityDecision = {
      at: now(),
      outcome: hadLiveActivityInstance ? 'updated' : 'started',
      reason: hadLiveActivityInstance ? 'live-activity-updated' : 'live-activity-started',
      stationId: recommendation.stationId,
      phase,
      source,
    };
    pushDebugEvent('live-activity', {
      outcome: debugState.lastLiveActivityDecision.outcome,
      stationId: recommendation.stationId,
      phase,
      source,
    });
  }

  async function scheduleNotificationForRecommendation(recommendation, station) {
    if (typeof notifications.schedulePredictiveRecommendationNotification !== 'function') {
      debugState.lastNotificationDecision = {
        at: now(),
        outcome: 'skipped',
        reason: 'notification-api-missing',
        stationId: recommendation?.stationId || null,
      };
      return;
    }

    const currentTime = now();
    if (
      runtimeState.lastNotificationStationId === recommendation.stationId &&
      currentTime - (runtimeState.lastNotificationAt || 0) < notificationCooldownMs
    ) {
      debugState.lastNotificationDecision = {
        at: currentTime,
        outcome: 'skipped',
        reason: 'cooldown',
        stationId: recommendation.stationId,
        cooldownRemainingMs: Math.max(0, notificationCooldownMs - (currentTime - (runtimeState.lastNotificationAt || 0))),
      };
      return;
    }

    const copy = buildNotificationCopy({
      recommendation,
      station,
      gallonsEstimate: estimateGallonsFromProfile(profile),
    });

    if (!copy) {
      debugState.lastNotificationDecision = {
        at: currentTime,
        outcome: 'skipped',
        reason: 'missing-notification-copy',
        stationId: recommendation.stationId,
      };
      return;
    }

    try {
      await notifications.schedulePredictiveRecommendationNotification({
        ...copy,
        station: {
          stationId: station?.stationId,
          stationName: station?.stationName,
          brand: station?.brand,
          latitude: station?.latitude,
          longitude: station?.longitude,
          price: station?.effectivePrice ?? station?.price,
        },
        recommendation: {
          stationId: recommendation.stationId,
          type: recommendation.type,
          confidence: recommendation.confidence,
          forwardDistance: recommendation.forwardDistance,
          savings: recommendation.savings,
        },
        navigationApp: config.preferences.navigationApp,
      });
    } catch (error) {
      console.warn('Predictive recommendation notification failed:', error?.message || error);
      debugState.lastNotificationDecision = {
        at: currentTime,
        outcome: 'failed',
        reason: 'schedule-error',
        stationId: recommendation.stationId,
        error: error?.message || String(error),
      };
      return;
    }

    runtimeState.lastNotificationAt = currentTime;
    runtimeState.lastNotificationStationId = recommendation.stationId;
    debugState.lastNotificationDecision = {
      at: currentTime,
      outcome: 'scheduled',
      reason: 'active-recommendation',
      stationId: recommendation.stationId,
      title: copy.title,
    };
    pushDebugEvent('notification', {
      outcome: 'scheduled',
      stationId: recommendation.stationId,
    });
  }

  async function applyPendingRecommendation(pendingRecommendation) {
    if (!pendingRecommendation || isStationSuppressed(pendingRecommendation.stationId)) {
      runtimeState.pendingRecommendation = null;
      debugState.lastRecommendationDecision = {
        at: now(),
        phase: 'cleared',
        reason: pendingRecommendation ? 'station-suppressed' : 'missing-pending-recommendation',
        stationId: pendingRecommendation?.stationId || null,
      };
      return;
    }

    runtimeState.pendingRecommendation = pendingRecommendation;
    runtimeState.activeRecommendation = null;
    const station = getStationById(pendingRecommendation.stationId);
    debugState.lastRecommendationDecision = {
      at: now(),
      phase: 'pending',
      reason: pendingRecommendation.reason || pendingRecommendation.type || 'recommender-pending',
      stationId: pendingRecommendation.stationId,
      confidence: toFiniteNumber(pendingRecommendation.confidence) || 0,
      attentionState: pendingRecommendation?.presentation?.attentionState || null,
      surfaceNow: Boolean(pendingRecommendation?.presentation?.surfaceNow),
    };
    pushDebugEvent('recommendation', {
      phase: 'pending',
      stationId: pendingRecommendation.stationId,
      reason: debugState.lastRecommendationDecision.reason,
    });

    await ensureLiveActivity({
      recommendation: pendingRecommendation,
      station,
      source: 'pending',
      phase: 'approaching',
    });
    await syncGeofencesForKnownStations(pendingRecommendation.stationId);
  }

  async function applyActiveRecommendation(activeRecommendation) {
    if (!activeRecommendation || isStationSuppressed(activeRecommendation.stationId)) {
      runtimeState.activeRecommendation = null;
      debugState.lastRecommendationDecision = {
        at: now(),
        phase: 'cleared',
        reason: activeRecommendation ? 'station-suppressed' : 'missing-active-recommendation',
        stationId: activeRecommendation?.stationId || null,
      };
      return;
    }

    runtimeState.activeRecommendation = activeRecommendation;
    runtimeState.pendingRecommendation = null;
    const station = getStationById(activeRecommendation.stationId);
    debugState.lastRecommendationDecision = {
      at: now(),
      phase: 'active',
      reason: activeRecommendation.reason || activeRecommendation.type || 'recommender-triggered',
      stationId: activeRecommendation.stationId,
      confidence: toFiniteNumber(activeRecommendation.confidence) || 0,
      attentionState: activeRecommendation?.presentation?.attentionState || null,
      surfaceNow: Boolean(activeRecommendation?.presentation?.surfaceNow),
    };
    pushDebugEvent('recommendation', {
      phase: 'active',
      stationId: activeRecommendation.stationId,
      reason: debugState.lastRecommendationDecision.reason,
    });

    await ensureLiveActivity({
      recommendation: activeRecommendation,
      station,
      source: 'active',
      phase: 'approaching',
    });
    await scheduleNotificationForRecommendation(activeRecommendation, station);
    await syncGeofencesForKnownStations(activeRecommendation.stationId);
  }

  function updateMileageFromSamples(samples) {
    let nextProfile = profile;
    let anchorSample = runtimeState.lastMileageSample;

    for (const sample of samples) {
      if (anchorSample) {
        const deltaMeters = calculateDistanceMeters(anchorSample, sample);
        const elapsedSeconds = Math.max(1, ((sample.timestamp || 0) - (anchorSample.timestamp || 0)) / 1000);
        const inferredSpeedMps = deltaMeters / elapsedSeconds;
        if (
          Number.isFinite(deltaMeters) &&
          deltaMeters >= 3 &&
          deltaMeters <= 2_500 &&
          inferredSpeedMps <= 70
        ) {
          nextProfile = updateProfileMileageImpl(nextProfile, deltaMeters / 1609.344);
        }
      }
      anchorSample = sample;
    }

    runtimeState.lastMileageSample = anchorSample || runtimeState.lastMileageSample;
    profile = nextProfile;
  }

  async function processLocationPayloadInternal(payload) {
    await bootstrap();
    pruneSuppressedStations();

    const normalizedLocations = normalizeLocationPayload(payload);
    if (normalizedLocations.length === 0) {
      debugState.lastLocationBatch = {
        at: now(),
        sampleCount: 0,
        reason: 'no-valid-locations',
      };
      return getState();
    }

    updateMileageFromSamples(normalizedLocations);
    appendRecentSamples(normalizedLocations);
    runtimeState.lastProcessedAt = now();
    const previousPendingStationId = runtimeState.pendingRecommendation?.stationId || null;
    const previousActiveStationId = runtimeState.activeRecommendation?.stationId || null;
    const previousGeofenceSignature = geofenceSignature(runtimeState.geofences);
    const previousLiveActivityStationId = runtimeState.liveActivity?.stationId || null;
    const previousLiveActivityPhase = runtimeState.liveActivity?.phase || 'idle';
    const previousNotificationAt = runtimeState.lastNotificationAt || null;
    const previousKnownStationCount = runtimeState.knownStations.length;

    let mergedStations = runtimeState.knownStations;
    try {
      const prefetchResult = await controller.handleLocationPayload(payload, {
        cooldownMs: getPrefetchCooldownMs(),
        radiusMiles: config.preferences.searchRadiusMiles,
        fuelType: config.preferences.preferredOctane,
        preferredProvider: config.preferences.preferredProvider,
      });
      debugState.lastPrefetch = {
        at: now(),
        queued: Boolean(prefetchResult?.queued),
        reason: prefetchResult?.reason || 'unknown',
        trajectorySpeedMps: toFiniteNumber(prefetchResult?.trajectorySeed?.speedMps),
        trajectoryHeading: toFiniteNumber(prefetchResult?.trajectorySeed?.courseDegrees),
        topStationCount: Array.isArray(prefetchResult?.result?.snapshot?.topStations)
          ? prefetchResult.result.snapshot.topStations.length
          : 0,
        cooldownMs: getPrefetchCooldownMs(),
      };
      pushDebugEvent('prefetch', {
        queued: Boolean(prefetchResult?.queued),
        reason: prefetchResult?.reason || 'unknown',
      });
      const topStations = prefetchResult?.result?.snapshot?.topStations;
      if (Array.isArray(topStations) && topStations.length > 0) {
        rememberStations(topStations);
        mergedStations = runtimeState.knownStations;
      }
    } catch (error) {
      const routeUnavailable = isTrajectoryRouteUnavailableError(error);
      if (!routeUnavailable) {
        console.warn('Predictive fueling prefetch failed:', error?.message || error);
      }
      debugState.lastPrefetch = {
        at: now(),
        queued: false,
        reason: routeUnavailable ? 'route-unavailable' : 'prefetch-error',
        error: error?.message || String(error),
        cooldownMs: getPrefetchCooldownMs(),
      };
    }

    recommender.setStations(mergedStations);
    recommender.setProfile(buildRecommenderProfile(profile, config.preferences));

    const fuelState = getUrgency();
    let triggeredEvent = null;
    for (const sample of normalizedLocations) {
      const nextEvent = recommender.pushLocation(sample, {
        urgency: fuelState.urgency || 0,
      });
      if (nextEvent && !isStationSuppressed(nextEvent.stationId)) {
        triggeredEvent = nextEvent;
      }
    }

    if (triggeredEvent) {
      await applyActiveRecommendation(triggeredEvent);
    } else {
      const pendingRecommendation = recommender.getPendingRecommendation();
      if (pendingRecommendation) {
        await applyPendingRecommendation(pendingRecommendation);
      } else if (runtimeState.activeRecommendation) {
        await ensureLiveActivity({
          recommendation: runtimeState.activeRecommendation,
          station: getStationById(runtimeState.activeRecommendation.stationId),
          source: 'active',
          phase: 'approaching',
        });
        await syncGeofencesForKnownStations(runtimeState.activeRecommendation.stationId);
        debugState.lastRecommendationDecision = {
          at: now(),
          phase: 'active',
          reason: 'retain-active-recommendation',
          stationId: runtimeState.activeRecommendation.stationId,
          confidence: toFiniteNumber(runtimeState.activeRecommendation.confidence) || 0,
          attentionState: runtimeState.activeRecommendation?.presentation?.attentionState || null,
          surfaceNow: Boolean(runtimeState.activeRecommendation?.presentation?.surfaceNow),
        };
      } else {
        runtimeState.pendingRecommendation = null;
        await syncGeofencesForKnownStations(null);
        await clearLiveActivity();
        debugState.lastRecommendationDecision = {
          at: now(),
          phase: 'idle',
          reason: 'no-trigger-no-pending',
          stationId: null,
        };
      }
    }

    const latestSample = normalizedLocations[normalizedLocations.length - 1] || null;
    debugState.lastLocationBatch = {
      at: now(),
      sampleCount: normalizedLocations.length,
      latestSampleSpeedMps: toFiniteNumber(latestSample?.speed) || 0,
      latestSampleAccuracyMeters: toFiniteNumber(latestSample?.accuracy),
      latestSampleTimestamp: toFiniteNumber(latestSample?.timestamp),
      knownStationCount: runtimeState.knownStations.length,
      triggeredStationId: triggeredEvent?.stationId || null,
      recommendationPhase: runtimeState.activeRecommendation?.stationId
        ? 'active'
        : (runtimeState.pendingRecommendation?.stationId ? 'pending' : 'idle'),
      urgency: toFiniteNumber(fuelState?.urgency) || 0,
    };
    setTrackingDebug('location-processed');
    pushDebugEvent('location-batch', {
      sampleCount: normalizedLocations.length,
      recommendationPhase: debugState.lastLocationBatch.recommendationPhase,
      triggeredStationId: triggeredEvent?.stationId || null,
    });

    const shouldForcePersist = (
      previousPendingStationId !== (runtimeState.pendingRecommendation?.stationId || null) ||
      previousActiveStationId !== (runtimeState.activeRecommendation?.stationId || null) ||
      previousGeofenceSignature !== geofenceSignature(runtimeState.geofences) ||
      previousLiveActivityStationId !== (runtimeState.liveActivity?.stationId || null) ||
      previousLiveActivityPhase !== (runtimeState.liveActivity?.phase || 'idle') ||
      previousNotificationAt !== (runtimeState.lastNotificationAt || null) ||
      previousKnownStationCount !== runtimeState.knownStations.length
    );

    await persist({ force: shouldForcePersist });
    emit();
    return getState();
  }

  function parseGeofenceStationId(regionIdentifier) {
    const parts = String(regionIdentifier || '').split(':');
    if (parts.length < 2) {
      return null;
    }

    return parts[1] === 'station' ? parts[2] || null : parts[1] || null;
  }

  async function processGeofenceEventInternal(event) {
    await bootstrap();

    const regionIdentifier = String(event?.region?.identifier || '');
    const stationId = parseGeofenceStationId(regionIdentifier);
    if (!stationId) {
      debugState.lastGeofenceEvent = {
        at: now(),
        outcome: 'ignored',
        reason: 'missing-station-id',
        eventType: event?.eventType ?? null,
        stationId: null,
      };
      return getState();
    }

    const eventType = Number(event?.eventType);
    const enterEvent = eventType === 1 || String(event?.eventType).toLowerCase() === 'enter';
    const exitEvent = eventType === 2 || String(event?.eventType).toLowerCase() === 'exit';
    const station = getStationById(stationId);

    if (enterEvent) {
      runtimeState.arrivalSession = {
        stationId,
        enteredAt: now(),
        regionIdentifier,
      };

      if (runtimeState.activeRecommendation?.stationId === stationId || runtimeState.pendingRecommendation?.stationId === stationId) {
        await ensureLiveActivity({
          recommendation: runtimeState.activeRecommendation || runtimeState.pendingRecommendation,
          station,
          source: 'active',
          phase: 'arriving',
        });
      }
      await persist({ force: true });
      debugState.lastGeofenceEvent = {
        at: now(),
        outcome: 'enter',
        reason: 'arrival-session-started',
        eventType: eventType,
        stationId,
      };
      setTrackingDebug('geofence-enter');
      pushDebugEvent('geofence', {
        outcome: 'enter',
        stationId,
      });
      emit();
      return getState();
    }

    if (exitEvent && runtimeState.arrivalSession?.stationId === stationId) {
      const dwellMs = now() - (runtimeState.arrivalSession.enteredAt || now());
      const didFuel = dwellMs >= stationFuelDwellMs;

      if (dwellMs >= stationVisitDwellMs) {
        profile = recordStationVisitImpl(profile, station, {
          timestampMs: runtimeState.arrivalSession.enteredAt,
          didFuel,
          odometerMiles: profile.odometerMiles,
          pricePerGallon: station?.price,
        });
        recommender.setProfile(buildRecommenderProfile(profile, config.preferences));
      }

      runtimeState.arrivalSession = null;
      if (runtimeState.activeRecommendation?.stationId === stationId || runtimeState.pendingRecommendation?.stationId === stationId) {
        runtimeState.activeRecommendation = null;
        runtimeState.pendingRecommendation = null;
        await clearLiveActivity();
      }

      await persist({ force: true });
      debugState.lastGeofenceEvent = {
        at: now(),
        outcome: 'exit',
        reason: didFuel ? 'dwell-qualified-as-fill' : 'arrival-session-ended',
        eventType: eventType,
        stationId,
        dwellMs,
        didFuel,
      };
      setTrackingDebug('geofence-exit');
      pushDebugEvent('geofence', {
        outcome: 'exit',
        stationId,
        didFuel,
      });
      emit();
    }

    return getState();
  }

  async function handleNavigateToStationInternal(stationId) {
    await bootstrap();
    const station = getStationById(stationId) || getStationById(runtimeState.activeRecommendation?.stationId) || getStationById(runtimeState.pendingRecommendation?.stationId);
    if (!station || typeof notifications.openNavigationForStation !== 'function') {
      return false;
    }

    return notifications.openNavigationForStation(station, {
      prefer: config.preferences.navigationApp === 'google-maps' ? 'google' : 'apple',
    });
  }

  async function dismissRecommendationInternal(stationId) {
    await bootstrap();
    const targetStationId = stationId || runtimeState.activeRecommendation?.stationId || runtimeState.pendingRecommendation?.stationId;
    suppressStation(targetStationId);
    runtimeState.pendingRecommendation = null;
    runtimeState.activeRecommendation = null;
    runtimeState.arrivalSession = null;
    await clearLiveActivity();
    await syncGeofencesForKnownStations(null);
    await persist({ force: true });
    debugState.lastRecommendationDecision = {
      at: now(),
      phase: 'dismissed',
      reason: 'user-dismissed',
      stationId: targetStationId || null,
    };
    setTrackingDebug('recommendation-dismissed');
    pushDebugEvent('recommendation', {
      phase: 'dismissed',
      stationId: targetStationId || null,
    });
    emit();
    return getState();
  }

  async function shutdownInternal() {
    await bootstrap();
    runtimeState.pendingRecommendation = null;
    runtimeState.activeRecommendation = null;
    runtimeState.arrivalSession = null;
    runtimeState.recentSamples = [];
    runtimeState.knownStations = [];
    runtimeState.lastLocationSample = null;
    runtimeState.lastMileageSample = null;
    runtimeState.lastProcessedAt = null;
    runtimeState.lastNotificationAt = null;
    runtimeState.lastNotificationStationId = null;
    runtimeState.suppressedStations = {};
    latestGeofenceSignature = geofenceSignature([]);
    try {
      await syncGeofences([]);
      runtimeState.geofences = [];
    } catch (error) {
      console.warn('Predictive geofence shutdown failed:', error?.message || error);
      runtimeState.geofences = [];
    }
    await clearLiveActivity();
    rebuildRecommender();
    await persist({ force: true });
    debugState.lifecycle.lastShutdownAt = now();
    pushDebugEvent('lifecycle', { action: 'shutdown' });
    setTrackingDebug('shutdown');
    emit();
    return getState();
  }

  async function resetAllDataInternal() {
    await bootstrap();
    await clearLiveActivity();

    try {
      await syncGeofences([]);
    } catch (error) {
      console.warn('Predictive geofence reset failed:', error?.message || error);
    }

    runtimeState = createDefaultPredictiveFuelingState();
    profile = createDefaultPredictiveFuelingProfile();
    debugState = cloneRuntimeDebugState();
    debugState.lifecycle.lastResetAt = now();
    latestGeofenceSignature = geofenceSignature(runtimeState.geofences);
    rebuildRecommender();
    await persist({ force: true });
    pushDebugEvent('lifecycle', { action: 'reset' });
    setTrackingDebug('reset');
    emit();
    return getState();
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function getState() {
    return {
      config,
      profile,
      tracking: {
        mode: getTrackingMode(),
        prefetchCooldownMs: getPrefetchCooldownMs(),
        reason: debugState.lastTrackingDecision?.reason || null,
        urgency: debugState.lastTrackingDecision?.urgency || 0,
      },
      runtimeState,
      debug: debugState,
    };
  }

  function updateConfig(nextConfig = {}) {
    config = {
      ...config,
      ...nextConfig,
      preferences: normalizePreferences(nextConfig.preferences || config.preferences),
    };
    if (recommender) {
      recommender.setProfile(buildRecommenderProfile(profile, config.preferences));
    }
    debugState.lifecycle.lastConfigUpdateAt = now();
    setTrackingDebug('config-updated');
    pushDebugEvent('config', {
      preferredProvider: config.preferences.preferredProvider,
      preferredOctane: config.preferences.preferredOctane,
      searchRadiusMiles: config.preferences.searchRadiusMiles,
    });
    emit();
  }

  return {
    bootstrap,
    dismissRecommendation(stationId) {
      return enqueueOperation(() => dismissRecommendationInternal(stationId));
    },
    getState,
    handleNavigateToStation(stationId) {
      return enqueueOperation(() => handleNavigateToStationInternal(stationId));
    },
    processGeofenceEvent(event) {
      return enqueueOperation(() => processGeofenceEventInternal(event));
    },
    processLocationPayload(payload) {
      return enqueueOperation(() => processLocationPayloadInternal(payload));
    },
    resetAllData() {
      return enqueueOperation(() => resetAllDataInternal());
    },
    shutdown() {
      return enqueueOperation(() => shutdownInternal());
    },
    subscribe,
    updateConfig,
  };
}

module.exports = {
  buildLiveActivityProps,
  createPredictiveFuelingRuntime,
  normalizeLocationPayload,
};
