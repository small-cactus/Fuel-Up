const AsyncStorageModule = require('@react-native-async-storage/async-storage');

const AsyncStorage = AsyncStorageModule.default || AsyncStorageModule;

const PREDICTIVE_FUELING_STATE_STORAGE_KEY = '@fuelup/predictive-fueling-state';
const MAX_RECENT_SAMPLES = 20;
const MAX_KNOWN_STATIONS = 16;

function toFiniteNumber(value) {
  if (value == null || value === '') {
    return null;
  }
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function normalizeSample(sample) {
  const latitude = toFiniteNumber(sample?.latitude);
  const longitude = toFiniteNumber(sample?.longitude);
  if (latitude === null || longitude === null) {
    return null;
  }

  return {
    latitude,
    longitude,
    speed: toFiniteNumber(sample?.speed) ?? 0,
    heading: toFiniteNumber(sample?.heading) ?? null,
    accuracy: toFiniteNumber(sample?.accuracy) ?? null,
    timestamp: toFiniteNumber(sample?.timestamp) ?? Date.now(),
    eventType: sample?.eventType ? String(sample.eventType) : undefined,
  };
}

function normalizeStation(station) {
  const stationId = String(station?.stationId || '').trim();
  const latitude = toFiniteNumber(station?.latitude);
  const longitude = toFiniteNumber(station?.longitude);
  if (!stationId || latitude === null || longitude === null) {
    return null;
  }

  return {
    stationId,
    stationName: String(station?.stationName || station?.name || '').trim(),
    brand: String(station?.brand || '').trim(),
    latitude,
    longitude,
    price: toFiniteNumber(station?.price),
    effectivePrice: toFiniteNumber(station?.effectivePrice),
    address: String(station?.address || '').trim(),
    routeApproach: station?.routeApproach
      ? {
        alongRouteDistanceMeters: toFiniteNumber(station.routeApproach.alongRouteDistanceMeters),
        offsetFromRouteMeters: toFiniteNumber(station.routeApproach.offsetFromRouteMeters),
        sideOfRoad: station.routeApproach.sideOfRoad || null,
        maneuverPenaltyPrice: toFiniteNumber(station.routeApproach.maneuverPenaltyPrice) ?? 0,
        nextStepDirections: Array.isArray(station.routeApproach.nextStepDirections)
          ? station.routeApproach.nextStepDirections.slice(0, 4)
          : [],
        isOnRoute: Boolean(station.routeApproach.isOnRoute),
      }
      : null,
  };
}

function normalizeRecommendation(recommendation) {
  if (!recommendation?.stationId) {
    return null;
  }

  return {
    stationId: String(recommendation.stationId),
    type: recommendation.type ? String(recommendation.type) : null,
    reason: recommendation.reason ? String(recommendation.reason) : null,
    confidence: toFiniteNumber(recommendation.confidence) ?? 0,
    forwardDistance: toFiniteNumber(recommendation.forwardDistance),
    savings: toFiniteNumber(recommendation.savings),
    stationSide: recommendation.stationSide ? String(recommendation.stationSide) : null,
    triggeredAt: toFiniteNumber(recommendation.triggeredAt),
    pendingSince: toFiniteNumber(recommendation.pendingSince),
    presentation: recommendation.presentation
      ? {
        surfaceNow: Boolean(recommendation.presentation.surfaceNow),
        attentionState: recommendation.presentation.attentionState
          ? String(recommendation.presentation.attentionState)
          : null,
        noticeabilityScore: toFiniteNumber(recommendation.presentation.noticeabilityScore),
      }
      : null,
  };
}

function cloneDefaultState() {
  return {
    recentSamples: [],
    knownStations: [],
    pendingRecommendation: null,
    activeRecommendation: null,
    lastLocationSample: null,
    lastMileageSample: null,
    lastProcessedAt: null,
    lastNotificationAt: null,
    lastNotificationStationId: null,
    suppressedStations: {},
    geofences: [],
    arrivalSession: null,
    liveActivity: {
      active: false,
      stationId: null,
      phase: 'idle',
      initialForwardDistance: null,
      lastForwardDistance: null,
      source: null,
      lastUpdatedAt: null,
    },
  };
}

function createDefaultPredictiveFuelingState() {
  return cloneDefaultState();
}

function normalizeSuppressedStations(value) {
  const entries = Object.entries(value || {})
    .map(([stationId, expiryMs]) => {
      const normalizedExpiry = toFiniteNumber(expiryMs);
      return normalizedExpiry === null
        ? null
        : [String(stationId), normalizedExpiry];
    })
    .filter(Boolean);

  return Object.fromEntries(entries);
}

function normalizeGeofenceRegion(region) {
  const latitude = toFiniteNumber(region?.latitude);
  const longitude = toFiniteNumber(region?.longitude);
  const radius = toFiniteNumber(region?.radius);
  if (latitude === null || longitude === null || radius === null) {
    return null;
  }

  return {
    identifier: String(region?.identifier || '').trim(),
    latitude,
    longitude,
    radius,
    notifyOnEnter: region?.notifyOnEnter !== false,
    notifyOnExit: region?.notifyOnExit !== false,
  };
}

function normalizePredictiveFuelingState(state = {}) {
  const nextState = cloneDefaultState();

  nextState.recentSamples = (Array.isArray(state?.recentSamples) ? state.recentSamples : [])
    .map(normalizeSample)
    .filter(Boolean)
    .slice(-MAX_RECENT_SAMPLES);
  nextState.knownStations = (Array.isArray(state?.knownStations) ? state.knownStations : [])
    .map(normalizeStation)
    .filter(Boolean)
    .slice(-MAX_KNOWN_STATIONS);
  nextState.pendingRecommendation = normalizeRecommendation(state?.pendingRecommendation);
  nextState.activeRecommendation = normalizeRecommendation(state?.activeRecommendation);
  nextState.lastLocationSample = normalizeSample(state?.lastLocationSample);
  nextState.lastMileageSample = normalizeSample(state?.lastMileageSample);
  nextState.lastProcessedAt = toFiniteNumber(state?.lastProcessedAt);
  nextState.lastNotificationAt = toFiniteNumber(state?.lastNotificationAt);
  nextState.lastNotificationStationId = state?.lastNotificationStationId
    ? String(state.lastNotificationStationId)
    : null;
  nextState.suppressedStations = normalizeSuppressedStations(state?.suppressedStations);
  nextState.geofences = (Array.isArray(state?.geofences) ? state.geofences : [])
    .map(normalizeGeofenceRegion)
    .filter(Boolean)
    .slice(0, 8);
  nextState.arrivalSession = state?.arrivalSession?.stationId
    ? {
      stationId: String(state.arrivalSession.stationId),
      enteredAt: toFiniteNumber(state.arrivalSession.enteredAt) ?? Date.now(),
      regionIdentifier: String(state.arrivalSession.regionIdentifier || ''),
    }
    : null;
  nextState.liveActivity = {
    active: Boolean(state?.liveActivity?.active),
    stationId: state?.liveActivity?.stationId ? String(state.liveActivity.stationId) : null,
    phase: state?.liveActivity?.phase ? String(state.liveActivity.phase) : 'idle',
    initialForwardDistance: toFiniteNumber(state?.liveActivity?.initialForwardDistance),
    lastForwardDistance: toFiniteNumber(state?.liveActivity?.lastForwardDistance),
    source: state?.liveActivity?.source ? String(state.liveActivity.source) : null,
    lastUpdatedAt: toFiniteNumber(state?.liveActivity?.lastUpdatedAt),
  };

  return nextState;
}

async function loadPredictiveFuelingStateAsync() {
  try {
    const rawValue = await AsyncStorage.getItem(PREDICTIVE_FUELING_STATE_STORAGE_KEY);
    if (!rawValue) {
      return cloneDefaultState();
    }

    return normalizePredictiveFuelingState(JSON.parse(rawValue));
  } catch (error) {
    return cloneDefaultState();
  }
}

async function savePredictiveFuelingStateAsync(state) {
  const normalizedState = normalizePredictiveFuelingState(state);
  await AsyncStorage.setItem(
    PREDICTIVE_FUELING_STATE_STORAGE_KEY,
    JSON.stringify(normalizedState)
  );
  return normalizedState;
}

async function clearPredictiveFuelingStateAsync() {
  await AsyncStorage.removeItem(PREDICTIVE_FUELING_STATE_STORAGE_KEY);
  return createDefaultPredictiveFuelingState();
}

module.exports = {
  clearPredictiveFuelingStateAsync,
  createDefaultPredictiveFuelingState,
  MAX_KNOWN_STATIONS,
  MAX_RECENT_SAMPLES,
  PREDICTIVE_FUELING_STATE_STORAGE_KEY,
  loadPredictiveFuelingStateAsync,
  normalizePredictiveFuelingState,
  normalizeStation,
  savePredictiveFuelingStateAsync,
};
