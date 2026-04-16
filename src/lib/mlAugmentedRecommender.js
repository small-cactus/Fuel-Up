const { createPredictiveRecommender } = require('./predictiveRecommender.js');
const {
  simulateHiddenIntentStressBatch,
  simulateRealisticCohortBatch,
  SIM_STATIONS,
} = require('./fuelerSimulation.js');

const PROPOSAL_ENGINE_OPTIONS = {
  triggerThreshold: 0.35,
  minStableRecommendationCount: 2,
  minStableRecommendationCountWithHistory: 1,
  minStableRecommendationCountCommitment: 1,
  minTripFuelIntentColdStart: 0.12,
  minTripFuelIntentWithHistory: 0.18,
  lowSpecificityColdStartMinIntentEvidence: 0.38,
  weakPatternHistoryMinIntentEvidence: 0.40,
  enableHistoryRecoveryProposals: true,
};

const REALISTIC_PROPOSAL_ENGINE_OPTIONS = {
  ...PROPOSAL_ENGINE_OPTIONS,
  triggerThreshold: 0.28,
  minStableRecommendationCount: 1,
  minTripFuelIntentColdStart: 0.10,
  minTripFuelIntentWithHistory: 0.15,
  lowSpecificityColdStartMinIntentEvidence: 0.34,
  weakPatternHistoryMinIntentEvidence: 0.36,
};

const PRIMARY_ML_OPTIMIZATION_BENCHMARK = 'realistic_cohort';
const GATE_FEATURE_SIZE = 109;
const SEQUENCE_FEATURE_SIZE = 14;
const DEFAULT_HISTORY_LEVELS = ['none', 'light', 'rich'];
const ROUTE_PURPOSES = [
  'commute',
  'commute_return',
  'shopping',
  'errand',
  'pickup',
  'airport',
  'social',
  'roadtrip',
  'roadtrip_return',
  'city_grid',
];
const ROUTE_SCENARIOS = ['city', 'city_grid', 'suburban', 'highway'];
const TRAFFIC_LEVELS = ['free_flow', 'steady', 'congested', 'gridlock'];
const WEATHER_BUCKETS = ['clear', 'rain', 'wind', 'snow', 'heat'];
const OCCUPANCY_BUCKETS = ['solo', 'passenger', 'kids'];
const EXPOSURE_QUALITIES = ['long_corridor', 'compressed_corridor', 'city_corridor', 'short_horizon'];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, value))));
}

function sigmoidDerivative(sigmoidOutput) {
  return sigmoidOutput * (1 - sigmoidOutput);
}

function mean(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return function next() {
    value += 0x6D2B79F5;
    let result = Math.imul(value ^ (value >>> 15), 1 | value);
    result ^= result + Math.imul(result ^ (result >>> 7), 61 | result);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function classifyHistoryBucket(historyVisitCount) {
  const visits = Number(historyVisitCount) || 0;
  if (visits <= 0) return 'none';
  if (visits <= 5) return 'light';
  return 'rich';
}

function buildMlGateFeatureVector(event = {}) {
  const attentionState = String(event?.presentation?.attentionState || 'unknown');
  const historyBucket = classifyHistoryBucket(event.historyVisitCount);
  const recommendationType = String(event?.type || '');
  const forwardDistance = Number(event.forwardDistance ?? event.triggerDistance) || 0;
  const savings = Number(event.savings) || 0;
  const rawSavings = Number(event.rawSavings) || 0;
  const accessPenaltyPrice = Number(event.accessPenaltyPrice) || 0;
  const noticeabilityScore = Number(event?.presentation?.noticeabilityScore) || 0;
  const historyVisitCount = Number(event.historyVisitCount) || 0;
  const milesSinceLastFill = Number(event.milesSinceLastFill) || 0;
  const tripDurationSeconds = Number(event.tripDurationSeconds) || 0;
  const meanSpeedMps = Number(event.meanSpeedMps) || 0;
  const confidence = Number(event.confidence) || 0;
  const fuelNeedScore = Number(event.fuelNeedScore) || 0;
  const defaultProbability = Number(event.defaultProbability) || 0;
  const mlFeatures = event?.mlFeatures || {};

  return [
    clamp(confidence, 0, 1),
    clamp(fuelNeedScore, 0, 1),
    clamp(forwardDistance / 12000, 0, 1),
    clamp(savings / 0.60, 0, 1),
    clamp(rawSavings / 0.75, 0, 1),
    clamp(accessPenaltyPrice / 0.30, 0, 1),
    clamp(defaultProbability, 0, 1),
    clamp(noticeabilityScore, 0, 1),
    clamp(historyVisitCount / 12, 0, 1),
    clamp(milesSinceLastFill / 420, 0, 1),
    clamp(tripDurationSeconds / 1500, 0, 1),
    clamp(meanSpeedMps / 30, 0, 1),
    event.stationSide === 'right' ? 1 : 0,
    event?.presentation?.surfaceNow ? 1 : 0,
    recommendationType === 'cheaper_alternative' ? 1 : 0,
    recommendationType === 'predicted_stop' ? 1 : 0,
    recommendationType === 'cold_start_best_value' ? 1 : 0,
    recommendationType === 'turn_in_commitment' ? 1 : 0,
    recommendationType === 'urgent_any' ? 1 : 0,
    recommendationType === 'history_recovery_stop' ? 1 : 0,
    historyBucket === 'none' ? 1 : 0,
    historyBucket === 'light' ? 1 : 0,
    historyBucket === 'rich' ? 1 : 0,
    attentionState === 'traffic_light_pause' ? 1 : 0,
    attentionState === 'straight_glanceable' ? 1 : 0,
    attentionState === 'active_drive_complex' ? 1 : 0,
    attentionState === 'gridlock' ? 1 : 0,
    event.predictedDefault && event.predictedDefault === event.stationId ? 1 : 0,
    clamp((Number(mlFeatures.candidateCount) || 0) / 8, 0, 1),
    clamp((Number(mlFeatures.candidateAlongTrack) || 0) / 12000, 0, 1),
    clamp(Math.abs(Number(mlFeatures.candidateCrossTrack) || 0) / 450, 0, 1),
    clamp((Math.abs(Number(mlFeatures.candidateSignedCrossTrack) || 0)) / 450, 0, 1),
    clamp((Number(mlFeatures.candidateAccessPenaltyPrice) || 0) / 0.35, 0, 1),
    clamp((Number(mlFeatures.candidateNetStationCost) || 0) / 4.5, 0, 1),
    clamp((Number(mlFeatures.candidateNetCostDeltaFromBest) || 0) / 0.45, 0, 1),
    clamp(Number(mlFeatures.candidateColdStartScore) || 0, 0, 1),
    clamp(Number(mlFeatures.candidateValueScore) || 0, 0, 1),
    clamp(Number(mlFeatures.candidateIntentEvidence) || 0, 0, 1),
    clamp(Number(mlFeatures.candidatePhysicalIntentScore) || 0, 0, 1),
    clamp(Number(mlFeatures.candidateDestinationProbability) || 0, 0, 1),
    clamp(Number(mlFeatures.candidateEffectiveDestinationProbability) || 0, 0, 1),
    clamp(Number(mlFeatures.candidateHistoryStrength) || 0, 0, 1),
    clamp(Number(mlFeatures.candidateGenericHistoryScore) || 0, 0, 1),
    clamp(Number(mlFeatures.candidateContextualHistoryScore) || 0, 0, 1),
    clamp(Number(mlFeatures.candidateHistoryContextMatch) || 0, 0, 1),
    clamp(Number(mlFeatures.candidateVisitShare) || 0, 0, 1),
    clamp(Number(mlFeatures.candidateObservedConversionRate) || 0, 0, 1),
    clamp(Number(mlFeatures.candidateContextualObservedConversionRate) || 0, 0, 1),
    clamp(Number(mlFeatures.candidateExposureContextMatch) || 0, 0, 1),
    clamp(Number(mlFeatures.candidateObservedSkipScore) || 0, 0, 1),
    clamp(Number(mlFeatures.candidateBrandAffinity) || 0, 0, 1),
    clamp(Number(mlFeatures.candidatePathScore) || 0, 0, 1),
    clamp(Number(mlFeatures.candidateCaptureScore) || 0, 0, 1),
    clamp(Number(mlFeatures.candidateApproachScore) || 0, 0, 1),
    clamp(Number(mlFeatures.candidateDecelScore) || 0, 0, 1),
    clamp(Number(mlFeatures.candidateTurnInCommitmentScore) || 0, 0, 1),
    clamp((Number(mlFeatures.candidateDistanceMeters) || 0) / 4500, 0, 1),
    clamp(1 - (((Number(mlFeatures.candidateValueRank) || 8) - 1) / 7), 0, 1),
    clamp(1 - (((Number(mlFeatures.candidateIntentRank) || 8) - 1) / 7), 0, 1),
    clamp(1 - (((Number(mlFeatures.candidateDestinationRank) || 8) - 1) / 7), 0, 1),
    mlFeatures.predictedDefaultSameStation ? 1 : 0,
    clamp(Number(mlFeatures.predictedDefaultIntentEvidence) || 0, 0, 1),
    clamp(Number(mlFeatures.predictedDefaultValueScore) || 0, 0, 1),
    clamp((Number(mlFeatures.predictedDefaultAlongTrack) || 0) / 12000, 0, 1),
    clamp(Number(mlFeatures.predictedDefaultContextualHistoryScore) || 0, 0, 1),
    clamp(Number(mlFeatures.predictedDefaultHistoryContextMatch) || 0, 0, 1),
    clamp(Number(mlFeatures.predictedDefaultObservedConversionRate) || 0, 0, 1),
    clamp(Number(mlFeatures.predictedDefaultContextualObservedConversionRate) || 0, 0, 1),
    mlFeatures.bestByIntentSameStation ? 1 : 0,
    mlFeatures.bestByValueSameStation ? 1 : 0,
    clamp(Number(mlFeatures.tripFuelIntentScore) || 0, 0, 1),
    clamp(Number(mlFeatures.tripFuelIntentThreshold) || 0, 0, 1),
    clamp(((Number(mlFeatures.tripFuelIntentSurplus) || 0) + 0.4) / 0.8, 0, 1),
    clamp(Number(mlFeatures.historyStrength) || 0, 0, 1),
    clamp(Number(mlFeatures.timePatternStrength) || 0, 0, 1),
    clamp(((Number(mlFeatures.leadMargin) || 0) + 0.05) / 0.45, 0, 1),
    clamp(Number(mlFeatures.urgency) || 0, 0, 1),
    clamp((Number(mlFeatures.effectiveProjectionDistance) || 0) / 18000, 0, 1),
    clamp((Number(mlFeatures.effectiveMinTriggerDistanceMeters) || 0) / 2500, 0, 1),
    clamp((Number(mlFeatures.estimatedRemainingMiles) || 0) / 400, 0, 1),
    clamp((Number(mlFeatures.avgIntervalMiles) || 0) / 450, 0, 1),
    clamp((Number(mlFeatures.intervalUtilization) || 0) / 1.5, 0, 1),
    clamp(Number(mlFeatures.profileHistoryConcentration) || 0, 0, 1),
    clamp((Number(mlFeatures.profileStationCount) || 0) / 12, 0, 1),
    mlFeatures.isHighwayCruise ? 1 : 0,
    mlFeatures.lowSpecificityColdStart ? 1 : 0,
    mlFeatures.speculativeUrbanHistoryMode ? 1 : 0,
    mlFeatures.historyRecoveryEligible ? 1 : 0,
    clamp(Number(mlFeatures.historyRecoveryConfidence) || 0, 0, 1),
  ];
}

function oneHot(value, candidates) {
  return candidates.map(candidate => (String(value || '') === candidate ? 1 : 0));
}

function buildRouteReplayFeatureVector(route = {}) {
  const context = route?.context || {};
  return [
    ...oneHot(route?.purpose, ROUTE_PURPOSES),
    ...oneHot(route?.scenario, ROUTE_SCENARIOS),
    ...oneHot(context?.trafficLevel, TRAFFIC_LEVELS),
    ...oneHot(context?.weather, WEATHER_BUCKETS),
    ...oneHot(context?.occupancy, OCCUPANCY_BUCKETS),
    clamp((Number(route?.estimatedRemainingMiles) || 0) / 400, 0, 1),
    clamp((Number(route?.routeDistanceMiles) || 0) / 120, 0, 1),
    clamp((Number(route?.historyCount) || 0) / 40, 0, 1),
    clamp((Number(route?.stopSignCount) || 0) / 12, 0, 1),
    clamp((Number(route?.trafficLightCount) || 0) / 16, 0, 1),
    clamp((Number(context?.roadComplexity) || 0), 0, 1),
    clamp((Number(context?.timePressure) || 0), 0, 1),
    clamp((Number(context?.routineStrength) || 0), 0, 1),
    clamp((Number(context?.cheapnessBias) || 0), 0, 1),
    clamp((Number(context?.routeConsumptionPressure) || 0), 0, 1),
    clamp((Number(context?.stopProbability) || 0), 0, 1),
    clamp((Number(context?.visibleStationCount) || 0) / 4, 0, 1),
    context?.exposureQuality === 'long_corridor' ? 1 : 0,
    context?.exposureQuality === 'compressed_corridor' ? 1 : 0,
    context?.exposureQuality === 'city_corridor' ? 1 : 0,
    context?.exposureQuality === 'short_horizon' ? 1 : 0,
    route?.observedHistoryBucketAtStart === 'none' ? 1 : 0,
    route?.observedHistoryBucketAtStart === 'light' ? 1 : 0,
    route?.observedHistoryBucketAtStart === 'rich' ? 1 : 0,
  ];
}

function buildCombinedFeatureVector(event, route) {
  return [
    ...buildMlGateFeatureVector(event),
    ...buildRouteReplayFeatureVector(route),
  ];
}

function getDecisionHistoryLevel(route = {}) {
  return String(route?.observedHistoryBucketAtStart || route?.historyLevel || 'none');
}

function normalizeRank(rank, count) {
  if (!Number.isFinite(rank) || rank <= 0 || count <= 1) return 1;
  return clamp(1 - ((rank - 1) / Math.max(1, count - 1)), 0, 1);
}

function buildDecisionCandidateFeatureVector({
  candidate,
  decisionEvent,
  route,
  summary,
  isNoOffer = false,
}) {
  const context = route?.context || {};
  const candidateCount = Math.max(1, Number(summary?.candidateCount) || 1);
  const effectivePrice = Number(candidate?.effective_price);
  const detourMinutes = Number(candidate?.detour_minutes);
  const extraMiles = Number(candidate?.extra_miles);
  const queueMinutes = Number(candidate?.queue_minutes);
  const familiarityScore = Number(candidate?.familiarity_score);
  const visibilityScore = Number(candidate?.visibility_score);
  const loyaltyValue = Number(candidate?.loyalty_value);
  const amenityScore = Number(candidate?.amenity_score);
  const observedPriceAgeMinutes = Number(candidate?.observed_price_age_minutes);
  const bestStationScore = Number(summary?.bestStationScore) || 0;
  const secondBestStationScore = Number(summary?.secondBestStationScore) || 0;
  const candidateStationScore = Number(candidate?.derived_station_score) || 0;
  const noOfferBaseScore = Number(summary?.noOfferBaseScore) || 0;

  return [
    isNoOffer ? 1 : 0,
    !isNoOffer ? 1 : 0,
    clamp((Number(route?.estimatedRemainingMiles) || 0) / 400, 0, 1),
    clamp((Number(route?.routeDistanceMiles) || 0) / 120, 0, 1),
    clamp((Number(route?.startingMilesSinceLastFill) || 0) / 450, 0, 1),
    clamp((Number(route?.historyCount) || 0) / 40, 0, 1),
    clamp((Number(route?.stopSignCount) || 0) / 12, 0, 1),
    clamp((Number(route?.trafficLightCount) || 0) / 16, 0, 1),
    clamp((Number(decisionEvent?.fuel_display_pct) || 0) / 100, 0, 1),
    clamp((Number(decisionEvent?.observed_range_miles) || 0) / 400, 0, 1),
    clamp((Number(decisionEvent?.planned_miles_next_24h) || 0) / 250, 0, 1),
    clamp((Number(decisionEvent?.observed_visible_station_count) || 0) / 6, 0, 1),
    clamp(Number(context?.timePressure) || 0, 0, 1),
    clamp(Number(context?.routineStrength) || 0, 0, 1),
    clamp(Number(context?.roadComplexity) || 0, 0, 1),
    clamp(Number(context?.cheapnessBias) || 0, 0, 1),
    clamp(Number(context?.routeConsumptionPressure) || 0, 0, 1),
    clamp(Number(context?.stopProbability) || 0, 0, 1),
    clamp(Number(context?.weatherPenalty) || 0, 0, 1),
    ...oneHot(route?.purpose, ROUTE_PURPOSES),
    ...oneHot(route?.scenario, ROUTE_SCENARIOS),
    ...oneHot(context?.trafficLevel, TRAFFIC_LEVELS),
    ...oneHot(context?.weather, WEATHER_BUCKETS),
    ...oneHot(context?.occupancy, OCCUPANCY_BUCKETS),
    ...oneHot(context?.exposureQuality, EXPOSURE_QUALITIES),
    ...oneHot(getDecisionHistoryLevel(route), DEFAULT_HISTORY_LEVELS),
    clamp(candidateCount / 6, 0, 1),
    clamp((Number(summary?.priceSpread) || 0) / 0.8, 0, 1),
    clamp((Number(summary?.detourSpread) || 0) / 18, 0, 1),
    clamp((Number(summary?.queueSpread) || 0) / 15, 0, 1),
    clamp(Number(summary?.bestFamiliarity) || 0, 0, 1),
    clamp(Number(summary?.bestVisibility) || 0, 0, 1),
    clamp(Number(summary?.bestBrandMatchRate) || 0, 0, 1),
    clamp(Number(summary?.bestSameSideRate) || 0, 0, 1),
    clamp(bestStationScore, 0, 1),
    clamp(secondBestStationScore, 0, 1),
    clamp(bestStationScore - secondBestStationScore, 0, 1),
    clamp(noOfferBaseScore, 0, 1),
    clamp(bestStationScore - noOfferBaseScore, -1, 1),
    isNoOffer ? clamp(noOfferBaseScore, 0, 1) : 0,
    isNoOffer ? clamp(bestStationScore - noOfferBaseScore, -1, 1) : 0,
    isNoOffer ? clamp(bestStationScore - secondBestStationScore, 0, 1) : 0,
    isNoOffer ? clamp(Number(summary?.priceSpread) || 0, 0, 1) : 0,
    isNoOffer ? clamp(Number(summary?.bestFamiliarity) || 0, 0, 1) : 0,
    isNoOffer ? clamp(Number(summary?.bestVisibility) || 0, 0, 1) : 0,
    isNoOffer ? clamp(Number(summary?.bestDetourMinutes) || 0, 0, 1) : 0,
    !isNoOffer ? clamp((effectivePrice || 0) / 5, 0, 1) : 0,
    !isNoOffer ? clamp(((effectivePrice || 0) - (Number(summary?.minEffectivePrice) || 0)) / 0.8, 0, 1) : 0,
    !isNoOffer ? normalizeRank(candidate?.effective_price_rank, candidateCount) : 0,
    !isNoOffer ? clamp((detourMinutes || 0) / 20, 0, 1) : 0,
    !isNoOffer ? clamp(((detourMinutes || 0) - (Number(summary?.minDetourMinutes) || 0)) / 18, 0, 1) : 0,
    !isNoOffer ? normalizeRank(candidate?.detour_rank, candidateCount) : 0,
    !isNoOffer ? clamp((extraMiles || 0) / 10, 0, 1) : 0,
    !isNoOffer ? clamp((queueMinutes || 0) / 18, 0, 1) : 0,
    !isNoOffer ? clamp(((queueMinutes || 0) - (Number(summary?.minQueueMinutes) || 0)) / 12, 0, 1) : 0,
    !isNoOffer ? clamp(familiarityScore || 0, 0, 1) : 0,
    !isNoOffer ? clamp((Number(summary?.bestFamiliarity) || 0) - (familiarityScore || 0), 0, 1) : 0,
    !isNoOffer ? normalizeRank(candidate?.familiarity_rank, candidateCount) : 0,
    !isNoOffer ? clamp(visibilityScore || 0, 0, 1) : 0,
    !isNoOffer ? clamp((Number(summary?.bestVisibility) || 0) - (visibilityScore || 0), 0, 1) : 0,
    !isNoOffer ? normalizeRank(candidate?.visibility_rank, candidateCount) : 0,
    !isNoOffer ? clamp(loyaltyValue || 0, 0, 1) : 0,
    !isNoOffer ? clamp(amenityScore || 0, 0, 1) : 0,
    !isNoOffer ? clamp((observedPriceAgeMinutes || 0) / 240, 0, 1) : 0,
    !isNoOffer ? (candidate?.same_side_of_road_flag ? 1 : 0) : 0,
    !isNoOffer ? (candidate?.brand_match_flag ? 1 : 0) : 0,
    !isNoOffer ? (candidate?.near_home_flag ? 1 : 0) : 0,
    !isNoOffer ? (candidate?.near_work_flag ? 1 : 0) : 0,
    !isNoOffer ? (candidate?.station_open_flag ? 1 : 0) : 0,
    !isNoOffer ? (candidate?.fuel_compatible_flag ? 1 : 0) : 0,
    !isNoOffer ? clamp(candidateStationScore, 0, 1) : 0,
    !isNoOffer ? clamp(bestStationScore - candidateStationScore, 0, 1) : 0,
    !isNoOffer ? clamp(candidateStationScore - noOfferBaseScore, -1, 1) : 0,
    !isNoOffer ? normalizeRank(candidate?.derived_station_rank, candidateCount) : 0,
  ];
}

function subtractFeatureVectors(left = [], right = []) {
  const size = Math.max(left.length, right.length);
  const diff = new Array(size).fill(0);
  for (let index = 0; index < size; index += 1) {
    diff[index] = (Number(left[index]) || 0) - (Number(right[index]) || 0);
  }
  return diff;
}

function buildPairwiseComparisonFeatureVector(preferred = {}, other = {}) {
  const preferredFeatures = Array.isArray(preferred.features) ? preferred.features : [];
  const otherFeatures = Array.isArray(other.features) ? other.features : [];
  return [
    ...preferredFeatures,
    ...otherFeatures,
    ...subtractFeatureVectors(preferredFeatures, otherFeatures),
  ];
}

function normalizeSigned(value, scale) {
  return clamp(((Number(value) || 0) / Math.max(0.0001, scale) + 1) / 2, 0, 1);
}

function buildNativeSnapshotStationFeatureVector({
  candidate = {},
  decisionSnapshot = {},
  event = {},
  route = {},
}) {
  const routeFeatures = buildRouteReplayFeatureVector(route);
  const selectedCandidate = (decisionSnapshot?.candidates || []).find(entry => entry?.selected) || null;
  const candidateCount = Math.max(1, Number(decisionSnapshot?.candidateCount) || 1);
  const eventConfidence = clamp(Number(event?.confidence) || 0, 0, 1);
  const eventFuelNeedScore = clamp(Number(event?.fuelNeedScore) || 0, 0, 1);
  const eventForwardDistance = Number(event?.forwardDistance ?? event?.triggerDistance) || 0;
  const eventSavings = Number(event?.savings) || 0;
  const eventRawSavings = Number(event?.rawSavings) || 0;
  const attentionState = String(event?.presentation?.attentionState || 'unknown');
  const recommendationType = String(event?.type || '');

  const deltaFromSelected = (field, scale = 1) => {
    if (!selectedCandidate) return 0.5;
    return normalizeSigned((Number(candidate?.[field]) || 0) - (Number(selectedCandidate?.[field]) || 0), scale);
  };

  return [
    ...routeFeatures,
    clamp(eventConfidence, 0, 1),
    clamp(eventFuelNeedScore, 0, 1),
    clamp(eventForwardDistance / 12000, 0, 1),
    clamp(eventSavings / 0.60, 0, 1),
    clamp(eventRawSavings / 0.75, 0, 1),
    recommendationType === 'cheaper_alternative' ? 1 : 0,
    recommendationType === 'predicted_stop' ? 1 : 0,
    recommendationType === 'cold_start_best_value' ? 1 : 0,
    recommendationType === 'turn_in_commitment' ? 1 : 0,
    recommendationType === 'urgent_any' ? 1 : 0,
    recommendationType === 'history_recovery_stop' ? 1 : 0,
    attentionState === 'traffic_light_pause' ? 1 : 0,
    attentionState === 'straight_glanceable' ? 1 : 0,
    attentionState === 'active_drive_complex' ? 1 : 0,
    attentionState === 'gridlock' ? 1 : 0,
    event?.presentation?.surfaceNow ? 1 : 0,
    clamp(candidateCount / 8, 0, 1),
    clamp(Number(decisionSnapshot?.tripFuelIntentScore) || 0, 0, 1),
    clamp(Number(decisionSnapshot?.tripFuelIntentThreshold) || 0, 0, 1),
    clamp(((Number(decisionSnapshot?.tripFuelIntentSurplus) || 0) + 0.4) / 0.8, 0, 1),
    clamp(Number(decisionSnapshot?.historyStrength) || 0, 0, 1),
    clamp(Number(decisionSnapshot?.timePatternStrength) || 0, 0, 1),
    clamp(((Number(decisionSnapshot?.leadMargin) || 0) + 0.05) / 0.45, 0, 1),
    clamp(Number(decisionSnapshot?.urgency) || 0, 0, 1),
    clamp(Number(decisionSnapshot?.fuelNeedScore) || 0, 0, 1),
    decisionSnapshot?.isHighwayCruise ? 1 : 0,
    decisionSnapshot?.lowSpecificityColdStart ? 1 : 0,
    decisionSnapshot?.speculativeUrbanHistoryMode ? 1 : 0,
    decisionSnapshot?.historyRecoveryEligible ? 1 : 0,
    clamp(Number(decisionSnapshot?.historyRecoveryConfidence) || 0, 0, 1),
    clamp((Number(decisionSnapshot?.estimatedRemainingMiles) || 0) / 400, 0, 1),
    clamp((Number(decisionSnapshot?.avgIntervalMiles) || 0) / 450, 0, 1),
    clamp(Number(decisionSnapshot?.profileHistoryConcentration) || 0, 0, 1),
    clamp((Number(decisionSnapshot?.profileStationCount) || 0) / 12, 0, 1),
    clamp((Number(decisionSnapshot?.historyVisitCount) || 0) / 18, 0, 1),
    clamp((Number(candidate?.alongTrack) || 0) / 12000, 0, 1),
    clamp(Math.abs(Number(candidate?.crossTrack) || 0) / 450, 0, 1),
    normalizeSigned(candidate?.signedCrossTrack, 450),
    clamp((Number(candidate?.accessPenaltyPrice) || 0) / 0.35, 0, 1),
    clamp((Number(candidate?.netStationCost) || 0) / 4.5, 0, 1),
    clamp(Number(candidate?.coldStartScore) || 0, 0, 1),
    clamp(Number(candidate?.valueScore) || 0, 0, 1),
    clamp(Number(candidate?.intentEvidence) || 0, 0, 1),
    clamp(Number(candidate?.physicalIntentScore) || 0, 0, 1),
    clamp(Number(candidate?.destinationProbability) || 0, 0, 1),
    clamp(Number(candidate?.effectiveDestinationProbability) || 0, 0, 1),
    clamp(Number(candidate?.historyStrength) || 0, 0, 1),
    clamp(Number(candidate?.genericHistoryScore) || 0, 0, 1),
    clamp(Number(candidate?.contextualHistoryScore) || 0, 0, 1),
    clamp(Number(candidate?.historyContextMatch) || 0, 0, 1),
    clamp(Number(candidate?.visitShare) || 0, 0, 1),
    clamp(Number(candidate?.observedConversionRate) || 0, 0, 1),
    clamp(Number(candidate?.contextualObservedConversionRate) || 0, 0, 1),
    clamp(Number(candidate?.exposureContextMatch) || 0, 0, 1),
    clamp(Number(candidate?.observedSkipScore) || 0, 0, 1),
    clamp(Number(candidate?.brandAffinity) || 0, 0, 1),
    clamp(Number(candidate?.pathScore) || 0, 0, 1),
    clamp(Number(candidate?.captureScore) || 0, 0, 1),
    clamp(Number(candidate?.approachScore) || 0, 0, 1),
    clamp(Number(candidate?.decelScore) || 0, 0, 1),
    clamp(Number(candidate?.turnInCommitmentScore) || 0, 0, 1),
    normalizeRank(candidate?.valueRank, candidateCount),
    normalizeRank(candidate?.intentRank, candidateCount),
    normalizeRank(candidate?.destinationRank, candidateCount),
    normalizeSigned(candidate?.destinationMarginToLeader, 0.5),
    normalizeSigned(candidate?.intentMarginToLeader, 0.5),
    normalizeSigned(candidate?.valueMarginToLeader, 0.5),
    candidate?.predictedDefaultAligned ? 1 : 0,
    normalizeSigned(candidate?.predictedDefaultGap, 0.6),
    candidate?.intentLeaderAligned ? 1 : 0,
    candidate?.valueLeaderAligned ? 1 : 0,
    candidate?.selected ? 1 : 0,
    clamp((Number(candidate?.corridorSeenCount) || 0) / 12, 0, 1),
    clamp((Number(candidate?.corridorSnapshotCoverage) || 0), 0, 1),
    clamp((Number(candidate?.corridorLastSeenStepsAgo) || 0) / 18, 0, 1),
    clamp((Number(candidate?.corridorBestLeadScore) || 0), 0, 1),
    clamp((Number(candidate?.corridorMeanLeadScore) || 0), 0, 1),
    clamp((Number(candidate?.corridorIntentPeak) || 0), 0, 1),
    clamp((Number(candidate?.corridorValuePeak) || 0), 0, 1),
    clamp((Number(candidate?.corridorDestinationPeak) || 0), 0, 1),
    clamp((Number(candidate?.corridorSkipPenaltyMean) || 0), 0, 1),
    clamp((Number(candidate?.corridorSelectedCount) || 0) / 6, 0, 1),
    candidate?.corridorPredictedDefaultEver ? 1 : 0,
    deltaFromSelected('effectiveDestinationProbability', 0.6),
    deltaFromSelected('intentEvidence', 0.6),
    deltaFromSelected('valueScore', 0.6),
    deltaFromSelected('netStationCost', 0.6),
    deltaFromSelected('contextualHistoryScore', 0.6),
    deltaFromSelected('contextualObservedConversionRate', 0.6),
    deltaFromSelected('observedSkipScore', 0.6),
  ];
}

function rankNativeSnapshotCandidates(candidates = []) {
  rankCandidateField(candidates, 'valueScore', 'desc');
  rankCandidateField(candidates, 'intentEvidence', 'desc');
  rankCandidateField(candidates, 'effectiveDestinationProbability', 'desc');
  return candidates;
}

function buildCorridorMemoryCandidates(decisionSnapshots = [], currentIndex = 0, options = {}) {
  const trailingSnapshotCount = Math.max(1, Number(options.trailingSnapshotCount) || 18);
  const startIndex = Math.max(0, currentIndex - trailingSnapshotCount + 1);
  const snapshots = decisionSnapshots.slice(startIndex, currentIndex + 1);
  const stationMap = new Map();

  for (let snapshotIndex = 0; snapshotIndex < snapshots.length; snapshotIndex += 1) {
    const snapshot = snapshots[snapshotIndex];
    const stepsAgo = (snapshots.length - 1) - snapshotIndex;
    for (const candidate of (snapshot?.candidates || [])) {
      if (!candidate?.stationId) continue;
      const existing = stationMap.get(candidate.stationId);
      const leadScore = (
        (Number(candidate.effectiveDestinationProbability) || 0) * 0.45 +
        (Number(candidate.intentEvidence) || 0) * 0.30 +
        (Number(candidate.valueScore) || 0) * 0.25
      );
      if (!existing) {
        stationMap.set(candidate.stationId, {
          ...candidate,
          corridorSeenCount: 1,
          corridorSnapshotCoverage: 0,
          corridorLastSeenStepsAgo: stepsAgo,
          corridorBestLeadScore: leadScore,
          corridorLeadScoreSum: leadScore,
          corridorIntentPeak: Number(candidate.intentEvidence) || 0,
          corridorValuePeak: Number(candidate.valueScore) || 0,
          corridorDestinationPeak: Number(candidate.effectiveDestinationProbability) || 0,
          corridorSkipPenaltySum: Number(candidate.observedSkipScore) || 0,
          corridorSelectedCount: candidate.selected ? 1 : 0,
          corridorPredictedDefaultEver: Boolean(candidate.predictedDefaultAligned),
        });
        continue;
      }

      existing.corridorSeenCount += 1;
      existing.corridorLastSeenStepsAgo = Math.min(existing.corridorLastSeenStepsAgo, stepsAgo);
      existing.corridorBestLeadScore = Math.max(existing.corridorBestLeadScore, leadScore);
      existing.corridorLeadScoreSum += leadScore;
      existing.corridorIntentPeak = Math.max(existing.corridorIntentPeak, Number(candidate.intentEvidence) || 0);
      existing.corridorValuePeak = Math.max(existing.corridorValuePeak, Number(candidate.valueScore) || 0);
      existing.corridorDestinationPeak = Math.max(existing.corridorDestinationPeak, Number(candidate.effectiveDestinationProbability) || 0);
      existing.corridorSkipPenaltySum += Number(candidate.observedSkipScore) || 0;
      existing.corridorSelectedCount += candidate.selected ? 1 : 0;
      existing.corridorPredictedDefaultEver = existing.corridorPredictedDefaultEver || Boolean(candidate.predictedDefaultAligned);

      if (stepsAgo === 0) {
        Object.assign(existing, candidate);
      } else {
        existing.intentEvidence = Math.max(Number(existing.intentEvidence) || 0, Number(candidate.intentEvidence) || 0);
        existing.valueScore = Math.max(Number(existing.valueScore) || 0, Number(candidate.valueScore) || 0);
        existing.effectiveDestinationProbability = Math.max(
          Number(existing.effectiveDestinationProbability) || 0,
          Number(candidate.effectiveDestinationProbability) || 0
        );
        existing.contextualHistoryScore = Math.max(
          Number(existing.contextualHistoryScore) || 0,
          Number(candidate.contextualHistoryScore) || 0
        );
        existing.contextualObservedConversionRate = Math.max(
          Number(existing.contextualObservedConversionRate) || 0,
          Number(candidate.contextualObservedConversionRate) || 0
        );
        existing.netStationCost = Math.min(
          Number(existing.netStationCost) || Number.POSITIVE_INFINITY,
          Number(candidate.netStationCost) || Number.POSITIVE_INFINITY
        );
        existing.accessPenaltyPrice = Math.min(
          Number(existing.accessPenaltyPrice) || Number.POSITIVE_INFINITY,
          Number(candidate.accessPenaltyPrice) || Number.POSITIVE_INFINITY
        );
      }
    }
  }

  const totalSnapshots = Math.max(1, snapshots.length);
  const candidates = [...stationMap.values()].map(candidate => ({
    ...candidate,
    corridorSnapshotCoverage: clamp((Number(candidate.corridorSeenCount) || 0) / totalSnapshots, 0, 1),
    corridorMeanLeadScore: clamp((Number(candidate.corridorLeadScoreSum) || 0) / Math.max(1, Number(candidate.corridorSeenCount) || 1), 0, 1),
    corridorSkipPenaltyMean: clamp((Number(candidate.corridorSkipPenaltySum) || 0) / Math.max(1, Number(candidate.corridorSeenCount) || 1), 0, 1),
  }));
  return rankNativeSnapshotCandidates(candidates);
}

function selectHardNegativeNativeCandidates(candidates = [], targetStationId = null, limit = 4) {
  const targetCandidate = candidates.find(candidate => candidate.stationId === targetStationId);
  if (!targetCandidate) return [];

  const riskScore = candidate => (
    (Number(candidate?.effectiveDestinationProbability) || 0) * 0.35 +
    (Number(candidate?.intentEvidence) || 0) * 0.25 +
    (Number(candidate?.valueScore) || 0) * 0.20 +
    (candidate?.selected ? 0.12 : 0) +
    (candidate?.predictedDefaultAligned ? 0.08 : 0) -
    (Number(candidate?.observedSkipScore) || 0) * 0.10
  );

  const unique = new Map();
  for (const candidate of candidates) {
    if (!candidate?.stationId || candidate.stationId === targetStationId) continue;
    if (!unique.has(candidate.stationId)) {
      unique.set(candidate.stationId, candidate);
    }
  }

  const selectedCandidate = candidates.find(candidate => candidate.selected && candidate.stationId !== targetStationId);
  const prioritized = [];
  if (selectedCandidate) {
    prioritized.push(selectedCandidate);
  }
  prioritized.push(
    ...[...unique.values()]
      .sort((left, right) => riskScore(right) - riskScore(left))
      .filter(candidate => !prioritized.some(existing => existing.stationId === candidate.stationId))
      .slice(0, limit)
  );

  return prioritized.slice(0, limit);
}

function collectProposalSnapshotRerankReplays(routeReplays = []) {
  const eventReplays = [];
  const pairwiseExamples = [];

  for (const route of routeReplays) {
    const decisionSnapshots = Array.isArray(route.decisionSnapshots)
      ? route.decisionSnapshots
      : [];
    for (let eventIndex = 0; eventIndex < decisionSnapshots.length; eventIndex += 1) {
      const decisionSnapshot = decisionSnapshots[eventIndex];
      const matchedEvent = Array.isArray(route.events)
        ? route.events.find(event => (
          event?.decisionSnapshot?.timestampMs != null &&
          event.decisionSnapshot.timestampMs === decisionSnapshot?.timestampMs
        ))
        : null;
      const event = matchedEvent || {
        type: 'decision_snapshot',
        confidence: 0,
        fuelNeedScore: decisionSnapshot?.fuelNeedScore || 0,
        triggerDistance: null,
        forwardDistance: null,
        savings: 0,
        rawSavings: 0,
        presentation: {
          attentionState: 'unknown',
          surfaceNow: false,
          noticeabilityScore: 0,
        },
      };
      const snapshotCandidates = buildCorridorMemoryCandidates(decisionSnapshots, eventIndex);
      if (!snapshotCandidates.length) continue;

      const candidates = snapshotCandidates.map(candidate => ({
        key: `${route.replayId}:${eventIndex}:${candidate.stationId}`,
        optionId: candidate.stationId,
        stationId: candidate.stationId,
        isNoOffer: false,
        label: route.expectsTrigger && candidate.stationId === route.targetStationId ? 1 : 0,
        features: buildNativeSnapshotStationFeatureVector({
          candidate,
          decisionSnapshot,
          event,
          route,
        }),
        candidate,
      }));

      const replay = {
        replayId: `${route.replayId}:event:${eventIndex}`,
        routeReplayId: route.replayId,
        routeId: route.routeId,
        historyLevel: route.historyLevel,
        expectsTrigger: route.expectsTrigger,
        targetStationId: route.targetStationId,
        eventIndex,
        event,
        route,
        decisionSnapshot,
        candidates,
      };
      eventReplays.push(replay);

      if (!route.expectsTrigger || !route.targetStationId) {
        continue;
      }
      const targetCandidate = candidates.find(candidate => candidate.stationId === route.targetStationId);
      if (!targetCandidate) {
        continue;
      }
      const hardNegatives = selectHardNegativeNativeCandidates(
        candidates.map(candidate => candidate.candidate),
        route.targetStationId
      );
      for (const negative of hardNegatives) {
        const negativeCandidate = candidates.find(candidate => candidate.stationId === negative.stationId);
        if (!negativeCandidate) continue;
        pairwiseExamples.push({
          replayId: replay.replayId,
          historyLevel: replay.historyLevel,
          label: 1,
          features: buildPairwiseComparisonFeatureVector(targetCandidate, negativeCandidate),
        });
        pairwiseExamples.push({
          replayId: replay.replayId,
          historyLevel: replay.historyLevel,
          label: 0,
          features: buildPairwiseComparisonFeatureVector(negativeCandidate, targetCandidate),
        });
      }
    }
  }

  return {
    eventReplays,
    pairwiseExamples,
  };
}

function collectTriggeredProposalSnapshotReplays(routeReplays = []) {
  const eventReplays = [];
  for (const route of routeReplays) {
    const decisionSnapshots = Array.isArray(route.decisionSnapshots)
      ? route.decisionSnapshots
      : [];
    for (let eventIndex = 0; eventIndex < route.events.length; eventIndex += 1) {
      const event = route.events[eventIndex];
      const decisionSnapshot = event?.decisionSnapshot;
      const decisionSnapshotIndex = decisionSnapshots.findIndex(snapshot => (
        snapshot?.timestampMs != null &&
        snapshot.timestampMs === decisionSnapshot?.timestampMs
      ));
      const snapshotCandidates = decisionSnapshotIndex >= 0
        ? buildCorridorMemoryCandidates(decisionSnapshots, decisionSnapshotIndex)
        : [];
      if (!snapshotCandidates.length) continue;
      const candidates = snapshotCandidates.map(candidate => ({
        key: `${route.replayId}:${eventIndex}:${candidate.stationId}`,
        optionId: candidate.stationId,
        stationId: candidate.stationId,
        isNoOffer: false,
        label: route.expectsTrigger && candidate.stationId === route.targetStationId ? 1 : 0,
        features: buildNativeSnapshotStationFeatureVector({
          candidate,
          decisionSnapshot,
          event,
          route,
        }),
        candidate,
      }));
      eventReplays.push({
        replayId: `${route.replayId}:trigger:${eventIndex}`,
        routeReplayId: route.replayId,
        routeId: route.routeId,
        historyLevel: route.historyLevel,
        expectsTrigger: route.expectsTrigger,
        targetStationId: route.targetStationId,
        eventIndex,
        event,
        route,
        decisionSnapshot,
        candidates,
      });
    }
  }
  return { eventReplays };
}

function createLogisticGate(featureSize = GATE_FEATURE_SIZE) {
  let weights = new Array(featureSize).fill(0);
  let bias = 0;

  function predict(features) {
    let linear = bias;
    for (let index = 0; index < featureSize; index += 1) {
      linear += (Number(features[index]) || 0) * weights[index];
    }
    return sigmoid(linear);
  }

  function train(examples, options = {}) {
    const {
      epochs = 500,
      learningRate = 0.12,
      l2 = 0.0005,
      positiveWeight = 5.0,
      negativeWeight = 1.0,
    } = options;
    if (!Array.isArray(examples) || examples.length === 0) {
      return { trained: false, loss: null };
    }

    for (let epoch = 0; epoch < epochs; epoch += 1) {
      const weightGradient = new Array(featureSize).fill(0);
      let biasGradient = 0;
      for (const example of examples) {
        const features = Array.isArray(example.features) ? example.features : [];
        const label = Number(example.label) === 1 ? 1 : 0;
        const prediction = predict(features);
        const classWeight = label === 1 ? positiveWeight : negativeWeight;
        const delta = (prediction - label) * classWeight;
        for (let index = 0; index < featureSize; index += 1) {
          weightGradient[index] += delta * (Number(features[index]) || 0);
        }
        biasGradient += delta;
      }
      const batchScale = 1 / examples.length;
      for (let index = 0; index < featureSize; index += 1) {
        weights[index] -= learningRate * ((weightGradient[index] * batchScale) + (weights[index] * l2));
      }
      bias -= learningRate * (biasGradient * batchScale);
    }

    let totalLoss = 0;
    for (const example of examples) {
      const label = Number(example.label) === 1 ? 1 : 0;
      const prediction = clamp(predict(example.features), 1e-6, 1 - 1e-6);
      const classWeight = label === 1 ? positiveWeight : negativeWeight;
      totalLoss += classWeight * (-(label * Math.log(prediction) + ((1 - label) * Math.log(1 - prediction))));
    }

    return {
      trained: true,
      loss: Math.round((totalLoss / examples.length) * 10000) / 10000,
    };
  }

  return {
    train,
    predict,
    export() {
      return {
        weights: weights.slice(),
        bias,
      };
    },
  };
}

function createDenseBinaryClassifier(inputSize, hiddenSizes = [48, 24], options = {}) {
  const layerSizes = [inputSize, ...hiddenSizes, 1];
  const random = mulberry32(Number(options.seed) || 17);
  const weights = [];
  const biases = [];

  for (let layerIndex = 0; layerIndex < layerSizes.length - 1; layerIndex += 1) {
    const inSize = layerSizes[layerIndex];
    const outSize = layerSizes[layerIndex + 1];
    const scale = Math.sqrt(2 / Math.max(1, inSize));
    weights.push(Array.from({ length: inSize * outSize }, () => ((random() * 2) - 1) * scale));
    biases.push(new Array(outSize).fill(0));
  }

  function forward(features) {
    const activations = [features.slice()];
    for (let layerIndex = 0; layerIndex < weights.length; layerIndex += 1) {
      const previous = activations[layerIndex];
      const outSize = layerSizes[layerIndex + 1];
      const current = new Array(outSize).fill(0);
      for (let outIndex = 0; outIndex < outSize; outIndex += 1) {
        let sum = biases[layerIndex][outIndex];
        for (let inIndex = 0; inIndex < previous.length; inIndex += 1) {
          sum += previous[inIndex] * weights[layerIndex][(inIndex * outSize) + outIndex];
        }
        current[outIndex] = sigmoid(sum);
      }
      activations.push(current);
    }
    return activations;
  }

  function predict(features) {
    return forward(features)[weights.length][0];
  }

  function train(examples, trainOptions = {}) {
    const {
      epochs = 220,
      batchSize = 96,
      learningRate = 0.08,
      positiveWeight = 6.5,
      negativeWeight = 1.0,
      l2 = 0.0006,
      shuffleSeed = 29,
    } = trainOptions;
    if (!Array.isArray(examples) || examples.length === 0) {
      return { trained: false, loss: null };
    }

    const shuffler = mulberry32(shuffleSeed);
    for (let epoch = 0; epoch < epochs; epoch += 1) {
      const shuffled = [...examples];
      for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(shuffler() * (index + 1));
        [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
      }

      for (let batchStart = 0; batchStart < shuffled.length; batchStart += batchSize) {
        const batch = shuffled.slice(batchStart, batchStart + batchSize);
        const weightGradients = weights.map(layer => new Array(layer.length).fill(0));
        const biasGradients = biases.map(layer => new Array(layer.length).fill(0));

        for (const example of batch) {
          const features = Array.isArray(example.features) ? example.features : new Array(inputSize).fill(0);
          const label = Number(example.label) === 1 ? 1 : 0;
          const activations = forward(features);
          const deltas = new Array(weights.length);
          const output = activations[weights.length][0];
          const classWeight = label === 1 ? positiveWeight : negativeWeight;
          deltas[weights.length - 1] = [(output - label) * classWeight];

          for (let layerIndex = weights.length - 2; layerIndex >= 0; layerIndex -= 1) {
            const currentActivation = activations[layerIndex + 1];
            const nextDelta = deltas[layerIndex + 1];
            const outSize = layerSizes[layerIndex + 2];
            const currentDelta = new Array(layerSizes[layerIndex + 1]).fill(0);
            for (let nodeIndex = 0; nodeIndex < currentDelta.length; nodeIndex += 1) {
              let propagated = 0;
              for (let nextIndex = 0; nextIndex < nextDelta.length; nextIndex += 1) {
                propagated += weights[layerIndex + 1][(nodeIndex * outSize) + nextIndex] * nextDelta[nextIndex];
              }
              currentDelta[nodeIndex] = propagated * sigmoidDerivative(currentActivation[nodeIndex]);
            }
            deltas[layerIndex] = currentDelta;
          }

          for (let layerIndex = 0; layerIndex < weights.length; layerIndex += 1) {
            const previousActivation = activations[layerIndex];
            const delta = deltas[layerIndex];
            const outSize = layerSizes[layerIndex + 1];
            for (let inIndex = 0; inIndex < previousActivation.length; inIndex += 1) {
              for (let outIndex = 0; outIndex < delta.length; outIndex += 1) {
                weightGradients[layerIndex][(inIndex * outSize) + outIndex] += previousActivation[inIndex] * delta[outIndex];
              }
            }
            for (let outIndex = 0; outIndex < delta.length; outIndex += 1) {
              biasGradients[layerIndex][outIndex] += delta[outIndex];
            }
          }
        }

        const batchScale = 1 / batch.length;
        for (let layerIndex = 0; layerIndex < weights.length; layerIndex += 1) {
          for (let weightIndex = 0; weightIndex < weights[layerIndex].length; weightIndex += 1) {
            weights[layerIndex][weightIndex] -= learningRate * ((weightGradients[layerIndex][weightIndex] * batchScale) + (weights[layerIndex][weightIndex] * l2));
          }
          for (let biasIndex = 0; biasIndex < biases[layerIndex].length; biasIndex += 1) {
            biases[layerIndex][biasIndex] -= learningRate * (biasGradients[layerIndex][biasIndex] * batchScale);
          }
        }
      }
    }

    let totalLoss = 0;
    for (const example of examples) {
      const label = Number(example.label) === 1 ? 1 : 0;
      const prediction = clamp(predict(example.features), 1e-6, 1 - 1e-6);
      const classWeight = label === 1 ? positiveWeight : negativeWeight;
      totalLoss += classWeight * (-(label * Math.log(prediction) + ((1 - label) * Math.log(1 - prediction))));
    }

    return {
      trained: true,
      loss: Math.round((totalLoss / examples.length) * 10000) / 10000,
      hiddenSizes: hiddenSizes.slice(),
    };
  }

  return {
    train,
    predict,
  };
}

function buildScorecard({
  totalCount,
  correctCount,
  tp,
  fp,
  fn,
  tn,
  wrongStationTriggers = 0,
  triggerDistances = [],
  historyBuckets = null,
}) {
  const precision = (tp + fp) > 0 ? tp / (tp + fp) : 0;
  const recall = (tp + fn) > 0 ? tp / (tp + fn) : 0;
  const falsePositiveRate = (fp + tn) > 0 ? fp / (fp + tn) : 0;
  const avgCorrectTriggerDistanceMeters = triggerDistances.length
    ? Math.round(triggerDistances.reduce((sum, value) => sum + value, 0) / triggerDistances.length)
    : 0;

  return {
    accuracy: totalCount > 0 ? Math.round((correctCount / totalCount) * 100) : 0,
    precision: Math.round(precision * 100),
    recall: Math.round(recall * 100),
    falsePositiveRate: Math.round(falsePositiveRate * 100),
    silentRateWhenNoFuel: (fp + tn) > 0 ? Math.round((tn / (fp + tn)) * 100) : 0,
    wrongStationRate: (tp + fn) > 0 ? Math.round((wrongStationTriggers / (tp + fn)) * 100) : 0,
    avgCorrectTriggerDistanceMeters,
    precisionFirstScore: totalCount > 0
      ? Math.round((((tp * 1) + (tn * 1) - (fp * 2) - (fn * 1)) / totalCount) * 100)
      : 0,
    hiddenIntentCount: tp + fn,
    noFuelCount: fp + tn,
    historyBuckets,
  };
}

function summarizeRoutes(routeResults) {
  const hiddenIntentRoutes = routeResults.filter(route => route.expectsTrigger);
  const noFuelRoutes = routeResults.filter(route => !route.expectsTrigger);
  const truePositives = hiddenIntentRoutes.filter(route => route.firstTriggerCorrect).length;
  const falsePositives = noFuelRoutes.filter(route => route.triggered).length;
  const wrongStationTriggers = hiddenIntentRoutes.filter(route => route.triggered && !route.firstTriggerCorrect).length;
  const correctCount = routeResults.filter(route => route.correct).length;
  const triggerDistances = hiddenIntentRoutes
    .filter(route => route.firstTriggerCorrect && route.triggerDistance != null)
    .map(route => route.triggerDistance);

  const historyBuckets = Object.fromEntries(
    DEFAULT_HISTORY_LEVELS.map(level => {
      const bucketRoutes = routeResults.filter(route => route.historyLevel === level);
      if (!bucketRoutes.length) {
        return [level, null];
      }
      const bucketHidden = bucketRoutes.filter(route => route.expectsTrigger);
      const bucketNoFuel = bucketRoutes.filter(route => !route.expectsTrigger);
      const bucketTp = bucketHidden.filter(route => route.firstTriggerCorrect).length;
      const bucketFp = bucketNoFuel.filter(route => route.triggered).length;
      const bucketFn = bucketHidden.length - bucketTp;
      const bucketTn = bucketNoFuel.length - bucketFp;
      const bucketWrong = bucketHidden.filter(route => route.triggered && !route.firstTriggerCorrect).length;
      const bucketTriggerDistances = bucketHidden
        .filter(route => route.firstTriggerCorrect && route.triggerDistance != null)
        .map(route => route.triggerDistance);

      return [level, buildScorecard({
        totalCount: bucketRoutes.length,
        correctCount: bucketRoutes.filter(route => route.correct).length,
        tp: bucketTp,
        fp: bucketFp,
        fn: bucketFn,
        tn: bucketTn,
        wrongStationTriggers: bucketWrong,
        triggerDistances: bucketTriggerDistances,
        historyBuckets: null,
      })];
    })
  );

  return buildScorecard({
    totalCount: routeResults.length,
    correctCount,
    tp: truePositives,
    fp: falsePositives,
    fn: hiddenIntentRoutes.length - truePositives,
    tn: noFuelRoutes.length - falsePositives,
    wrongStationTriggers,
    triggerDistances,
    historyBuckets,
  });
}

function createEngineFactory(engineOptions = {}) {
  return ({ profile, onTrigger, onDecisionSnapshot }) => {
    const recommender = createPredictiveRecommender({
      onTrigger,
      onDecisionSnapshot,
      cooldownMs: 60 * 1000,
      ...engineOptions,
    });
    recommender.setStations(SIM_STATIONS);
    recommender.setProfile(profile);
    return recommender;
  };
}

function collectRouteReplays({
  seeds,
  routeCount = 96,
  historyLevels = DEFAULT_HISTORY_LEVELS,
  engineOptions = {},
  simulationFn = simulateHiddenIntentStressBatch,
  simulationOptions = {},
  collectDecisionSnapshots = false,
}) {
  const routeReplays = [];
  const examples = [];
  for (const seed of seeds) {
    for (const historyLevel of historyLevels) {
      const simulation = simulationFn({
        createEngineFn: createEngineFactory(engineOptions),
        applyNoise: true,
        noiseSeed: seed,
        routeCount,
        historyLevel,
        latentPlanHistoryLevel: 'none',
        freezeVisitHistory: true,
        collectRouteEvents: true,
        collectDecisionSnapshots,
        ...simulationOptions,
      });

      for (const route of simulation.routes) {
        const replayId = `${seed}:${historyLevel}:${route.routeId}`;
        const events = (route.routeEvents || []).map((event, index) => {
          const featureVector = buildCombinedFeatureVector(event, route);
          const label = route.expectsTrigger && event.stationId === route.targetStationId ? 1 : 0;
          examples.push({
            replayId,
            historyLevel,
            label,
            index,
            stationId: event.stationId,
            features: featureVector,
            event,
          });
          return {
            ...event,
            featureVector,
            label,
          };
        });

        routeReplays.push({
          replayId,
          seed,
          historyLevel,
          routeId: route.routeId,
          expectsTrigger: route.expectsTrigger,
          targetStationId: route.targetStationId,
          events,
          decisionSnapshots: collectDecisionSnapshots
            ? (route.decisionSnapshots || []).map(snapshot => ({ ...snapshot }))
            : [],
        });
      }
    }
  }

  return { routeReplays, examples };
}

function computeCandidateDerivedScore(candidateRow = {}) {
  const effectivePrice = Number(candidateRow.effective_price) || 0;
  const detourMinutes = Number(candidateRow.detour_minutes) || 0;
  const extraMiles = Number(candidateRow.extra_miles) || 0;
  const queueMinutes = Number(candidateRow.queue_minutes) || 0;
  const familiarityScore = Number(candidateRow.familiarity_score) || 0;
  const visibilityScore = Number(candidateRow.visibility_score) || 0;
  const loyaltyValue = Number(candidateRow.loyalty_value) || 0;
  const amenityScore = Number(candidateRow.amenity_score) || 0;
  const priceTerm = clamp((4.5 - effectivePrice) / 1.6, 0, 1);
  const detourTerm = clamp(1 - (detourMinutes / 18), 0, 1);
  const queueTerm = clamp(1 - (queueMinutes / 12), 0, 1);
  const mileageTerm = clamp(1 - (extraMiles / 8), 0, 1);
  const sideTerm = candidateRow.same_side_of_road_flag ? 1 : 0;
  const brandTerm = candidateRow.brand_match_flag ? 1 : 0;

  return clamp(
    (priceTerm * 0.26) +
    (detourTerm * 0.18) +
    (queueTerm * 0.08) +
    (mileageTerm * 0.06) +
    (sideTerm * 0.10) +
    (brandTerm * 0.10) +
    (loyaltyValue * 0.04) +
    (familiarityScore * 0.10) +
    (visibilityScore * 0.05) +
    (amenityScore * 0.03),
    0,
    1
  );
}

function rankCandidateField(candidates, field, sortOrder = 'desc') {
  const sorted = [...candidates].sort((left, right) => {
    const leftValue = Number(left?.[field]) || 0;
    const rightValue = Number(right?.[field]) || 0;
    return sortOrder === 'asc' ? leftValue - rightValue : rightValue - leftValue;
  });
  sorted.forEach((candidate, index) => {
    candidate[`${field}_rank`] = index + 1;
  });
}

function buildDecisionSetSummary(candidates = [], decisionEvent = {}, route = {}) {
  const effectivePrices = candidates.map(candidate => Number(candidate.effective_price) || 0);
  const detourMinutes = candidates.map(candidate => Number(candidate.detour_minutes) || 0);
  const queueMinutes = candidates.map(candidate => Number(candidate.queue_minutes) || 0);
  const familiarities = candidates.map(candidate => Number(candidate.familiarity_score) || 0);
  const visibilities = candidates.map(candidate => Number(candidate.visibility_score) || 0);
  const derivedScores = candidates.map(candidate => Number(candidate.derived_station_score) || 0);
  const sortedDerived = [...derivedScores].sort((left, right) => right - left);
  const bestStationScore = sortedDerived[0] || 0;
  const secondBestStationScore = sortedDerived[1] || 0;
  const remainingMiles = Number(route?.estimatedRemainingMiles) || Number(decisionEvent?.observed_range_miles) || 0;
  const fuelDisplayPct = Number(decisionEvent?.fuel_display_pct) || 0;
  const timePressure = Number(route?.context?.timePressure) || 0;
  const roadComplexity = Number(route?.context?.roadComplexity) || 0;
  const visibleStationCount = Math.max(1, Number(decisionEvent?.observed_visible_station_count) || candidates.length || 1);

  return {
    candidateCount: candidates.length,
    minEffectivePrice: effectivePrices.length ? Math.min(...effectivePrices) : 0,
    maxEffectivePrice: effectivePrices.length ? Math.max(...effectivePrices) : 0,
    minDetourMinutes: detourMinutes.length ? Math.min(...detourMinutes) : 0,
    maxDetourMinutes: detourMinutes.length ? Math.max(...detourMinutes) : 0,
    minQueueMinutes: queueMinutes.length ? Math.min(...queueMinutes) : 0,
    maxQueueMinutes: queueMinutes.length ? Math.max(...queueMinutes) : 0,
    priceSpread: effectivePrices.length ? Math.max(...effectivePrices) - Math.min(...effectivePrices) : 0,
    detourSpread: detourMinutes.length ? Math.max(...detourMinutes) - Math.min(...detourMinutes) : 0,
    queueSpread: queueMinutes.length ? Math.max(...queueMinutes) - Math.min(...queueMinutes) : 0,
    bestFamiliarity: familiarities.length ? Math.max(...familiarities) : 0,
    bestVisibility: visibilities.length ? Math.max(...visibilities) : 0,
    bestBrandMatchRate: candidates.length
      ? candidates.filter(candidate => candidate.brand_match_flag).length / candidates.length
      : 0,
    bestSameSideRate: candidates.length
      ? candidates.filter(candidate => candidate.same_side_of_road_flag).length / candidates.length
      : 0,
    bestStationScore,
    secondBestStationScore,
    bestDetourMinutes: detourMinutes.length ? Math.min(...detourMinutes) : 0,
    noOfferBaseScore: clamp(
      (clamp(remainingMiles / 250, 0, 1) * 0.22) +
      (clamp(fuelDisplayPct / 100, 0, 1) * 0.22) +
      (clamp(timePressure, 0, 1) * 0.12) +
      (clamp(roadComplexity, 0, 1) * 0.08) +
      (clamp(visibleStationCount / 5, 0, 1) * 0.08) +
      ((1 - bestStationScore) * 0.18) +
      ((1 - clamp((sortedDerived[0] || 0) - (sortedDerived[1] || 0), 0, 1)) * 0.10),
      0,
      1
    ),
  };
}

function computeObservedDecisionStationUtility(candidate = {}, replay = {}) {
  const route = replay?.route || {};
  const context = route?.context || {};
  const summary = replay?.summary || buildDecisionSetSummary([candidate], {}, route);
  const candidateCount = Math.max(1, Number(summary?.candidateCount) || 1);
  const priceScore = clamp(
    1 - (((Number(candidate?.effective_price) || summary.minEffectivePrice || 0) - (summary.minEffectivePrice || 0)) / Math.max(0.01, summary.priceSpread || 0.4)),
    0,
    1
  );
  const detourScore = clamp(
    1 - (((Number(candidate?.detour_minutes) || summary.minDetourMinutes || 0) - (summary.minDetourMinutes || 0)) / Math.max(0.01, summary.detourSpread || 6)),
    0,
    1
  );
  const queueScore = clamp(
    1 - (((Number(candidate?.queue_minutes) || summary.minQueueMinutes || 0) - (summary.minQueueMinutes || 0)) / Math.max(0.01, summary.queueSpread || 4)),
    0,
    1
  );
  const familiarity = clamp(Number(candidate?.familiarity_score) || 0, 0, 1);
  const visibility = clamp(Number(candidate?.visibility_score) || 0, 0, 1);
  const amenity = clamp(Number(candidate?.amenity_score) || 0, 0, 1);
  const loyalty = clamp(Number(candidate?.loyalty_value) || 0, 0, 1);
  const cheapnessBias = clamp(Number(context?.cheapnessBias) || 0, 0, 1);
  const timePressure = clamp(Number(context?.timePressure) || 0, 0, 1);
  const roadComplexity = clamp(Number(context?.roadComplexity) || 0, 0, 1);
  const remainingMiles = Number(route?.estimatedRemainingMiles) || 0;
  const fuelDisplayPct = Number(route?.observedState?.fuel_display_pct ?? replay?.decisionEvent?.fuel_display_pct ?? 0);
  const urgency = clamp(
    Math.max(
      1 - (remainingMiles / 220),
      1 - (fuelDisplayPct / 100)
    ),
    0,
    1
  );
  const occupancyPenalty = context?.occupancy === 'kids'
    ? 0.12
    : (context?.occupancy === 'passenger' ? 0.05 : 0);
  const highwayScenario = route?.scenario === 'highway';
  const sameSide = candidate?.same_side_of_road_flag ? 1 : 0;
  const brandMatch = candidate?.brand_match_flag ? 1 : 0;
  const freshness = clamp(1 - ((Number(candidate?.observed_price_age_minutes) || 0) / 180), 0, 1);
  const rankAdvantage = normalizeRank(candidate?.derived_station_rank, candidateCount);

  return clamp(
    (priceScore * (0.18 + (cheapnessBias * 0.20))) +
    (detourScore * (0.16 + (urgency * 0.08) + (timePressure * 0.06))) +
    (queueScore * (0.06 + (timePressure * 0.08))) +
    (familiarity * (0.12 + ((context?.weather === 'rain' || context?.weather === 'snow') ? 0.08 : 0))) +
    (visibility * (highwayScenario ? 0.12 : 0.08)) +
    (sameSide * (highwayScenario ? 0.10 : (0.14 + (roadComplexity * 0.06)))) +
    (brandMatch * 0.10) +
    (loyalty * 0.05) +
    (amenity * 0.03) +
    (freshness * 0.04) +
    (rankAdvantage * 0.08) +
    (urgency * (highwayScenario ? 0.10 : 0.06)) -
    (timePressure * (1 - detourScore) * 0.16) -
    (occupancyPenalty * (1 - detourScore)) -
    ((candidate?.station_open_flag ? 0 : 1) * 0.50) -
    ((candidate?.fuel_compatible_flag ? 0 : 1) * 0.50),
    0,
    1
  );
}

function collectDecisionPointReplays({
  seeds,
  historyLevels = DEFAULT_HISTORY_LEVELS,
  simulationFn = simulateRealisticCohortBatch,
  simulationOptions = {},
}) {
  const decisionReplays = [];
  const examples = [];

  for (const seed of seeds) {
    for (const historyLevel of historyLevels) {
      const simulation = simulationFn({
        createEngineFn: createEngineFactory(REALISTIC_PROPOSAL_ENGINE_OPTIONS),
        applyNoise: true,
        noiseSeed: seed,
        historyLevel,
        latentPlanHistoryLevel: 'none',
        collectRouteEvents: false,
        ...simulationOptions,
      });

      const routeByDecisionId = new Map(
        simulation.routes.map(route => [route.decisionId, route])
      );
      const candidatesByDecisionId = new Map();
      for (const candidateRow of simulation.candidate_stations) {
        const decisionId = candidateRow.decision_id;
        if (!candidatesByDecisionId.has(decisionId)) {
          candidatesByDecisionId.set(decisionId, []);
        }
        candidatesByDecisionId.get(decisionId).push({ ...candidateRow });
      }

      for (const decisionEvent of simulation.decision_events) {
        const decisionId = decisionEvent.decision_id;
        const route = routeByDecisionId.get(decisionId);
        if (!route) continue;

        const candidateRows = (candidatesByDecisionId.get(decisionId) || []).map(candidate => ({
          ...candidate,
          derived_station_score: computeCandidateDerivedScore(candidate),
        }));
        rankCandidateField(candidateRows, 'effective_price', 'asc');
        rankCandidateField(candidateRows, 'detour_minutes', 'asc');
        rankCandidateField(candidateRows, 'familiarity_score', 'desc');
        rankCandidateField(candidateRows, 'visibility_score', 'desc');
        rankCandidateField(candidateRows, 'derived_station_score', 'desc');

        const summary = buildDecisionSetSummary(candidateRows, decisionEvent, route);
        const replayId = `${seed}:${historyLevel}:${decisionId}`;
        const historyBucket = getDecisionHistoryLevel(route);
        const candidates = candidateRows.map(candidate => {
          const features = buildDecisionCandidateFeatureVector({
            candidate,
            decisionEvent,
            route,
            summary,
            isNoOffer: false,
          });
          const label = route.expectsTrigger && candidate.station_id === route.targetStationId ? 1 : 0;
          const candidateRecord = {
            key: `${replayId}:${candidate.station_id}`,
            optionId: candidate.station_id,
            stationId: candidate.station_id,
            isNoOffer: false,
            label,
            features,
            candidate,
          };
          examples.push({
            replayId,
            historyLevel,
            label,
            optionId: candidate.station_id,
            isNoOffer: false,
            features,
          });
          return candidateRecord;
        });

        const noOfferFeatures = buildDecisionCandidateFeatureVector({
          candidate: null,
          decisionEvent,
          route,
          summary,
          isNoOffer: true,
        });
        const noOfferLabel = route.expectsTrigger ? 0 : 1;
        examples.push({
          replayId,
          historyLevel,
          label: noOfferLabel,
          optionId: 'no_offer',
          isNoOffer: true,
          features: noOfferFeatures,
        });
        candidates.push({
          key: `${replayId}:no_offer`,
          optionId: 'no_offer',
          stationId: null,
          isNoOffer: true,
          label: noOfferLabel,
          features: noOfferFeatures,
          candidate: null,
        });

        decisionReplays.push({
          replayId,
          seed,
          historyLevel,
          routeId: route.routeId,
          decisionId,
          expectsTrigger: route.expectsTrigger,
          targetStationId: route.targetStationId,
          decisionEvent,
          route,
          summary,
          candidates,
        });
      }
    }
  }

  return { decisionReplays, examples };
}

function collectPairwiseStationExamples(decisionReplays = []) {
  const examples = [];
  for (const replay of decisionReplays) {
    if (!replay.expectsTrigger || !replay.targetStationId) {
      continue;
    }
    const stations = replay.candidates.filter(candidate => !candidate.isNoOffer);
    const chosen = stations.find(candidate => candidate.stationId === replay.targetStationId);
    if (!chosen) {
      continue;
    }
    for (const other of stations) {
      if (other.stationId === chosen.stationId) continue;
      examples.push({
        replayId: replay.replayId,
        historyLevel: replay.historyLevel,
        label: 1,
        features: buildPairwiseComparisonFeatureVector(chosen, other),
      });
      examples.push({
        replayId: replay.replayId,
        historyLevel: replay.historyLevel,
        label: 0,
        features: buildPairwiseComparisonFeatureVector(other, chosen),
      });
    }
  }
  return examples;
}

function evaluateDecisionPointReplays(decisionReplays, scoreFn, thresholdConfig = 0, marginConfig = 0) {
  const getConfigValue = (config, replay, fallback = 0) => {
    if (typeof config === 'number') return config;
    if (config && typeof config === 'object') {
      return Number(config[replay.historyLevel] ?? config.default ?? fallback);
    }
    return fallback;
  };

  const routeResults = decisionReplays.map(replay => {
    const threshold = getConfigValue(thresholdConfig, replay, 0);
    const margin = getConfigValue(marginConfig, replay, 0);
    const scoredCandidates = replay.candidates
      .map(candidate => ({
        ...candidate,
        mlScore: scoreFn(candidate, replay),
      }))
      .sort((left, right) => right.mlScore - left.mlScore);

    const top = scoredCandidates[0] || null;
    const second = scoredCandidates[1] || null;
    const marginScore = top ? (top.mlScore - (second?.mlScore || 0)) : 0;
    const triggeredCandidate = (
      top &&
      !top.isNoOffer &&
      top.mlScore >= threshold &&
      marginScore >= margin
    ) ? top : null;

    const triggered = Boolean(triggeredCandidate);
    const firstTriggerCorrect = Boolean(
      triggeredCandidate &&
      replay.expectsTrigger &&
      triggeredCandidate.stationId === replay.targetStationId
    );
    const correct = replay.expectsTrigger ? firstTriggerCorrect : !triggered;

    return {
      replayId: replay.replayId,
      historyLevel: replay.historyLevel,
      expectsTrigger: replay.expectsTrigger,
      triggered,
      firstTriggerCorrect,
      correct,
      triggerDistance: triggeredCandidate ? (Number(replay.route?.triggerDistance) || 0) : null,
      targetStationId: replay.targetStationId,
      triggeredStationId: triggeredCandidate?.stationId ?? null,
      topOptionId: top?.optionId ?? null,
      topScore: top?.mlScore ?? 0,
      marginScore,
    };
  });

  return {
    routes: routeResults,
    scorecard: summarizeRoutes(routeResults),
  };
}

function tuneDecisionRankerHistoryThresholds(decisionReplays, scoreFn, maxFalsePositiveRate = 5) {
  let best = null;

  for (let thresholdStep = 20; thresholdStep <= 90; thresholdStep += 2) {
    for (let marginStep = 0; marginStep <= 30; marginStep += 2) {
      const thresholds = {};
      const margins = {};
      for (const historyLevel of DEFAULT_HISTORY_LEVELS) {
        thresholds[historyLevel] = thresholdStep / 100;
        margins[historyLevel] = marginStep / 100;
      }
      const evaluation = evaluateDecisionPointReplays(decisionReplays, scoreFn, thresholds, margins);
      if (evaluation.scorecard.falsePositiveRate > maxFalsePositiveRate) {
        continue;
      }
      const comparison = best
        ? compareScorecards(evaluation.scorecard, best.scorecard)
        : 1;
      if (
        !best ||
        comparison > 0 ||
        (comparison === 0 && ((thresholdStep / 100) > best.thresholds.none || (marginStep / 100) > best.margins.none))
      ) {
        best = {
          thresholds,
          margins,
          scorecard: evaluation.scorecard,
        };
      }
    }
  }

  return best || {
    thresholds: { none: 0.95, light: 0.95, rich: 0.95, default: 0.95 },
    margins: { none: 0.5, light: 0.5, rich: 0.5, default: 0.5 },
    scorecard: evaluateDecisionPointReplays(
      decisionReplays,
      scoreFn,
      { none: 0.95, light: 0.95, rich: 0.95, default: 0.95 },
      { none: 0.5, light: 0.5, rich: 0.5, default: 0.5 }
    ).scorecard,
  };
}

function evaluateTwoHeadDecisionPointReplays(
  decisionReplays,
  stationScoreFn,
  noOfferScoreFn,
  thresholdConfig = 0,
  noOfferMarginConfig = 0,
  stationMarginConfig = 0
) {
  const getConfigValue = (config, replay, fallback = 0) => {
    if (typeof config === 'number') return config;
    if (config && typeof config === 'object') {
      return Number(config[replay.historyLevel] ?? config.default ?? fallback);
    }
    return fallback;
  };

  const routeResults = decisionReplays.map(replay => {
    const threshold = getConfigValue(thresholdConfig, replay, 0);
    const noOfferMargin = getConfigValue(noOfferMarginConfig, replay, 0);
    const stationMargin = getConfigValue(stationMarginConfig, replay, 0);
    const stationCandidates = replay.candidates
      .filter(candidate => !candidate.isNoOffer)
      .map(candidate => ({
        ...candidate,
        mlScore: stationScoreFn(candidate, replay),
      }))
      .sort((left, right) => right.mlScore - left.mlScore);
    const noOfferCandidate = replay.candidates.find(candidate => candidate.isNoOffer) || null;
    const noOfferScore = noOfferCandidate ? noOfferScoreFn(noOfferCandidate, replay) : 1;
    const topStation = stationCandidates[0] || null;
    const secondStation = stationCandidates[1] || null;
    const stationGap = topStation ? (topStation.mlScore - (secondStation?.mlScore || 0)) : 0;
    const noOfferGap = topStation ? (topStation.mlScore - noOfferScore) : -1;
    const triggeredCandidate = (
      topStation &&
      topStation.mlScore >= threshold &&
      noOfferGap >= noOfferMargin &&
      stationGap >= stationMargin
    ) ? topStation : null;

    const triggered = Boolean(triggeredCandidate);
    const firstTriggerCorrect = Boolean(
      triggeredCandidate &&
      replay.expectsTrigger &&
      triggeredCandidate.stationId === replay.targetStationId
    );
    const correct = replay.expectsTrigger ? firstTriggerCorrect : !triggered;

    return {
      replayId: replay.replayId,
      historyLevel: replay.historyLevel,
      expectsTrigger: replay.expectsTrigger,
      triggered,
      firstTriggerCorrect,
      correct,
      triggerDistance: triggeredCandidate ? (Number(replay.route?.triggerDistance) || 0) : null,
      targetStationId: replay.targetStationId,
      triggeredStationId: triggeredCandidate?.stationId ?? null,
      topOptionId: triggeredCandidate?.optionId ?? 'no_offer',
      topScore: topStation?.mlScore ?? 0,
      marginScore: stationGap,
      noOfferScore,
    };
  });

  return {
    routes: routeResults,
    scorecard: summarizeRoutes(routeResults),
  };
}

function tuneTwoHeadDecisionRankerThresholds(
  decisionReplays,
  stationScoreFn,
  noOfferScoreFn,
  maxFalsePositiveRate = 5
) {
  const thresholds = {};
  const noOfferMargins = {};
  const stationMargins = {};
  const summaries = {};

  for (const historyLevel of DEFAULT_HISTORY_LEVELS) {
    const bucketReplays = decisionReplays.filter(replay => replay.historyLevel === historyLevel);
    let best = null;
    for (let thresholdStep = 12; thresholdStep <= 90; thresholdStep += 2) {
      for (let noOfferMarginStep = -10; noOfferMarginStep <= 25; noOfferMarginStep += 2) {
        for (let stationMarginStep = 0; stationMarginStep <= 18; stationMarginStep += 2) {
          const evaluation = evaluateTwoHeadDecisionPointReplays(
            bucketReplays,
            stationScoreFn,
            noOfferScoreFn,
            thresholdStep / 100,
            noOfferMarginStep / 100,
            stationMarginStep / 100
          );
          if (evaluation.scorecard.falsePositiveRate > maxFalsePositiveRate) {
            continue;
          }
          const comparison = best
            ? compareScorecards(evaluation.scorecard, best.scorecard)
            : 1;
          if (
            !best ||
            comparison > 0 ||
            (comparison === 0 && ((thresholdStep / 100) > best.threshold || (noOfferMarginStep / 100) > best.noOfferMargin))
          ) {
            best = {
              threshold: thresholdStep / 100,
              noOfferMargin: noOfferMarginStep / 100,
              stationMargin: stationMarginStep / 100,
              scorecard: evaluation.scorecard,
            };
          }
        }
      }
    }
    thresholds[historyLevel] = best?.threshold ?? 0.95;
    noOfferMargins[historyLevel] = best?.noOfferMargin ?? 0.4;
    stationMargins[historyLevel] = best?.stationMargin ?? 0.2;
    summaries[historyLevel] = best?.scorecard ?? evaluateTwoHeadDecisionPointReplays(
      bucketReplays,
      stationScoreFn,
      noOfferScoreFn,
      thresholds[historyLevel],
      noOfferMargins[historyLevel],
      stationMargins[historyLevel]
    ).scorecard;
  }

  return {
    thresholds,
    noOfferMargins,
    stationMargins,
    summaries,
  };
}

function evaluateOfferStationDecisionReplays(
  decisionReplays,
  offerScoreFn,
  stationScoreFn,
  offerThresholdConfig = 0,
  stationThresholdConfig = 0,
  stationMarginConfig = 0
) {
  const getConfigValue = (config, replay, fallback = 0) => {
    if (typeof config === 'number') return config;
    if (config && typeof config === 'object') {
      return Number(config[replay.historyLevel] ?? config.default ?? fallback);
    }
    return fallback;
  };

  const routeResults = decisionReplays.map(replay => {
    const offerThreshold = getConfigValue(offerThresholdConfig, replay, 0);
    const stationThreshold = getConfigValue(stationThresholdConfig, replay, 0);
    const stationMargin = getConfigValue(stationMarginConfig, replay, 0);
    const offerCandidate = replay.candidates.find(candidate => candidate.isNoOffer) || null;
    const offerScore = offerCandidate ? offerScoreFn(offerCandidate, replay) : 0;
    const scoredStations = replay.candidates
      .filter(candidate => !candidate.isNoOffer)
      .map(candidate => ({
        ...candidate,
        mlScore: stationScoreFn(candidate, replay),
      }))
      .sort((left, right) => right.mlScore - left.mlScore);
    const topStation = scoredStations[0] || null;
    const secondStation = scoredStations[1] || null;
    const stationGap = topStation ? (topStation.mlScore - (secondStation?.mlScore || 0)) : 0;
    const triggeredCandidate = (
      offerScore >= offerThreshold &&
      topStation &&
      topStation.mlScore >= stationThreshold &&
      stationGap >= stationMargin
    ) ? topStation : null;

    const triggered = Boolean(triggeredCandidate);
    const firstTriggerCorrect = Boolean(
      triggeredCandidate &&
      replay.expectsTrigger &&
      triggeredCandidate.stationId === replay.targetStationId
    );
    const correct = replay.expectsTrigger ? firstTriggerCorrect : !triggered;

    return {
      replayId: replay.replayId,
      historyLevel: replay.historyLevel,
      expectsTrigger: replay.expectsTrigger,
      triggered,
      firstTriggerCorrect,
      correct,
      triggerDistance: triggeredCandidate ? (Number(replay.route?.triggerDistance) || 0) : null,
      targetStationId: replay.targetStationId,
      triggeredStationId: triggeredCandidate?.stationId ?? null,
      topOptionId: triggeredCandidate?.optionId ?? 'no_offer',
      topScore: topStation?.mlScore ?? 0,
      marginScore: stationGap,
      offerScore,
    };
  });

  return {
    routes: routeResults,
    scorecard: summarizeRoutes(routeResults),
  };
}

function tuneOfferStationDecisionThresholds(
  decisionReplays,
  offerScoreFn,
  stationScoreFn,
  maxFalsePositiveRate = 5
) {
  const offerThresholds = {};
  const stationThresholds = {};
  const stationMargins = {};
  const summaries = {};

  for (const historyLevel of DEFAULT_HISTORY_LEVELS) {
    const bucketReplays = decisionReplays.filter(replay => replay.historyLevel === historyLevel);
    let best = null;
    for (let offerThresholdStep = 10; offerThresholdStep <= 90; offerThresholdStep += 2) {
      for (let stationThresholdStep = 10; stationThresholdStep <= 90; stationThresholdStep += 2) {
        for (let stationMarginStep = 0; stationMarginStep <= 16; stationMarginStep += 2) {
          const evaluation = evaluateOfferStationDecisionReplays(
            bucketReplays,
            offerScoreFn,
            stationScoreFn,
            offerThresholdStep / 100,
            stationThresholdStep / 100,
            stationMarginStep / 100
          );
          if (evaluation.scorecard.falsePositiveRate > maxFalsePositiveRate) {
            continue;
          }
          const comparison = best
            ? compareScorecards(evaluation.scorecard, best.scorecard)
            : 1;
          if (
            !best ||
            comparison > 0 ||
            (comparison === 0 && ((offerThresholdStep / 100) > best.offerThreshold || (stationThresholdStep / 100) > best.stationThreshold))
          ) {
            best = {
              offerThreshold: offerThresholdStep / 100,
              stationThreshold: stationThresholdStep / 100,
              stationMargin: stationMarginStep / 100,
              scorecard: evaluation.scorecard,
            };
          }
        }
      }
    }
    offerThresholds[historyLevel] = best?.offerThreshold ?? 0.95;
    stationThresholds[historyLevel] = best?.stationThreshold ?? 0.95;
    stationMargins[historyLevel] = best?.stationMargin ?? 0.2;
    summaries[historyLevel] = best?.scorecard ?? evaluateOfferStationDecisionReplays(
      bucketReplays,
      offerScoreFn,
      stationScoreFn,
      offerThresholds[historyLevel],
      stationThresholds[historyLevel],
      stationMargins[historyLevel]
    ).scorecard;
  }

  return {
    offerThresholds,
    stationThresholds,
    stationMargins,
    summaries,
  };
}

function createPairwiseStationScoreFn(models) {
  return (candidate, replay) => {
    const stations = replay.candidates.filter(entry => !entry.isNoOffer);
    const model = models[replay.historyLevel];
    if (!model || stations.length <= 1) {
      return 0;
    }
    const wins = stations
      .filter(other => other.stationId !== candidate.stationId)
      .map(other => model.predict(buildPairwiseComparisonFeatureVector(candidate, other)));
    return mean(wins);
  };
}

function buildProposalSnapshotReplayIndex(snapshotReplays = []) {
  const replayIndex = new Map();
  for (const replay of snapshotReplays) {
    replayIndex.set(`${replay.routeReplayId}:${replay.eventIndex}`, replay);
  }
  return replayIndex;
}

function evaluateRouteReplaysWithStationReranker(
  routeReplays,
  gateScoreFn,
  gateThresholdConfig = 0,
  proposalSnapshotReplayIndex = new Map(),
  stationScoreFn = () => 0,
  rerankerConfig = {}
) {
  const getConfigValue = (config, route, fallback = 0) => {
    if (typeof config === 'number') return config;
    if (config && typeof config === 'object') {
      return Number(config[route.historyLevel] ?? config.default ?? fallback);
    }
    return fallback;
  };

  const routeResults = routeReplays.map(route => {
    const gateThreshold = getConfigValue(gateThresholdConfig, route, 0);
    const stationThreshold = getConfigValue(rerankerConfig.stationThreshold, route, 0);
    const stationMargin = getConfigValue(rerankerConfig.stationMargin, route, 0);
    let allowedEvent = null;

    for (let eventIndex = 0; eventIndex < route.events.length; eventIndex += 1) {
      const event = route.events[eventIndex];
      const gateScore = gateScoreFn(event, route);
      if (gateScore < gateThreshold) {
        continue;
      }
      const snapshotReplay = proposalSnapshotReplayIndex.get(`${route.replayId}:${eventIndex}`);
      if (!snapshotReplay || !snapshotReplay.candidates.length) {
        continue;
      }
      const scoredCandidates = snapshotReplay.candidates
        .map(candidate => ({
          ...candidate,
          mlScore: stationScoreFn(candidate, snapshotReplay),
        }))
        .sort((left, right) => right.mlScore - left.mlScore);
      const topCandidate = scoredCandidates[0] || null;
      const secondCandidate = scoredCandidates[1] || null;
      const topGap = topCandidate ? (topCandidate.mlScore - (secondCandidate?.mlScore || 0)) : 0;
      if (!topCandidate || topCandidate.mlScore < stationThreshold || topGap < stationMargin) {
        continue;
      }

      allowedEvent = {
        ...event,
        stationId: topCandidate.stationId,
        gateScore,
        rerankedScore: topCandidate.mlScore,
        rerankedMargin: topGap,
      };
      break;
    }

    const triggered = Boolean(allowedEvent);
    const firstTriggerCorrect = Boolean(
      allowedEvent &&
      route.expectsTrigger &&
      allowedEvent.stationId === route.targetStationId
    );
    const correct = route.expectsTrigger ? firstTriggerCorrect : !triggered;

    return {
      replayId: route.replayId,
      historyLevel: route.historyLevel,
      expectsTrigger: route.expectsTrigger,
      triggered,
      firstTriggerCorrect,
      correct,
      triggerDistance: allowedEvent?.triggerDistance ?? allowedEvent?.forwardDistance ?? null,
      targetStationId: route.targetStationId,
      triggeredStationId: allowedEvent?.stationId ?? null,
      gateScore: allowedEvent?.gateScore ?? 0,
      rerankedScore: allowedEvent?.rerankedScore ?? 0,
      rerankedMargin: allowedEvent?.rerankedMargin ?? 0,
    };
  });

  return {
    routes: routeResults,
    scorecard: summarizeRoutes(routeResults),
  };
}

function tuneStationRerankerThresholds(
  routeReplays,
  gateScoreFn,
  gateThresholdConfig,
  proposalSnapshotReplayIndex,
  stationScoreFn,
  maxFalsePositiveRate = 5
) {
  const stationThresholds = {};
  const stationMargins = {};
  const summaries = {};

  for (const historyLevel of DEFAULT_HISTORY_LEVELS) {
    const bucketRoutes = routeReplays.filter(route => route.historyLevel === historyLevel);
    let best = null;
    for (let stationThresholdStep = 6; stationThresholdStep <= 90; stationThresholdStep += 2) {
      for (let stationMarginStep = 0; stationMarginStep <= 30; stationMarginStep += 2) {
        const evaluation = evaluateRouteReplaysWithStationReranker(
          bucketRoutes,
          gateScoreFn,
          gateThresholdConfig,
          proposalSnapshotReplayIndex,
          stationScoreFn,
          {
            stationThreshold: stationThresholdStep / 100,
            stationMargin: stationMarginStep / 100,
          }
        );
        if (evaluation.scorecard.falsePositiveRate > maxFalsePositiveRate) {
          continue;
        }
        const comparison = best
          ? compareScorecards(evaluation.scorecard, best.scorecard)
          : 1;
        if (
          !best ||
          comparison > 0 ||
          (
            comparison === 0 &&
            (
              (stationThresholdStep / 100) > best.stationThreshold ||
              (stationMarginStep / 100) > best.stationMargin
            )
          )
        ) {
          best = {
            stationThreshold: stationThresholdStep / 100,
            stationMargin: stationMarginStep / 100,
            scorecard: evaluation.scorecard,
          };
        }
      }
    }

    stationThresholds[historyLevel] = best?.stationThreshold ?? 0.95;
    stationMargins[historyLevel] = best?.stationMargin ?? 0.5;
    summaries[historyLevel] = best?.scorecard ?? evaluateRouteReplaysWithStationReranker(
      bucketRoutes,
      gateScoreFn,
      gateThresholdConfig,
      proposalSnapshotReplayIndex,
      stationScoreFn,
      {
        stationThreshold: stationThresholds[historyLevel],
        stationMargin: stationMargins[historyLevel],
      }
    ).scorecard;
  }

  return {
    stationThresholds,
    stationMargins,
    summaries,
  };
}

function evaluateRouteReplays(routeReplays, scoreFn, thresholdConfig = 0) {
  const getThreshold = (route) => {
    if (typeof thresholdConfig === 'number') return thresholdConfig;
    if (thresholdConfig && typeof thresholdConfig === 'object') {
      return Number(thresholdConfig[route.historyLevel] ?? thresholdConfig.default ?? 0);
    }
    return 0;
  };

  const routeResults = routeReplays.map(route => {
    const threshold = getThreshold(route);
    let allowedEvent = null;
    for (const event of route.events) {
      const score = scoreFn(event, route);
      if (score >= threshold) {
        allowedEvent = {
          ...event,
          mlScore: score,
        };
        break;
      }
    }

    const triggered = Boolean(allowedEvent);
    const firstTriggerCorrect = Boolean(
      allowedEvent &&
      route.expectsTrigger &&
      allowedEvent.stationId === route.targetStationId
    );
    const correct = route.expectsTrigger ? firstTriggerCorrect : !triggered;

    return {
      replayId: route.replayId,
      historyLevel: route.historyLevel,
      expectsTrigger: route.expectsTrigger,
      triggered,
      firstTriggerCorrect,
      correct,
      triggerDistance: allowedEvent?.triggerDistance ?? allowedEvent?.forwardDistance ?? null,
      targetStationId: route.targetStationId,
      triggeredStationId: allowedEvent?.stationId ?? null,
    };
  });

  return {
    routes: routeResults,
    scorecard: summarizeRoutes(routeResults),
  };
}

function evaluateStatefulRouteReplays(routeReplays, scoreFn, thresholdConfig = 0, gateConfig = {}) {
  const getThreshold = (route) => {
    if (typeof thresholdConfig === 'number') return thresholdConfig;
    if (thresholdConfig && typeof thresholdConfig === 'object') {
      return Number(thresholdConfig[route.historyLevel] ?? thresholdConfig.default ?? 0);
    }
    return 0;
  };
  const getConfigValue = (config, route, fallback = 0) => {
    if (typeof config === 'number') return config;
    if (config && typeof config === 'object') {
      return Number(config[route.historyLevel] ?? config.default ?? fallback);
    }
    return fallback;
  };

  const routeResults = routeReplays.map(route => {
    const threshold = getThreshold(route);
    const immediateBuffer = getConfigValue(gateConfig.immediateBuffer, route, 0.08);
    const replacementMargin = getConfigValue(gateConfig.replacementMargin, route, 0.04);
    const finalBuffer = getConfigValue(gateConfig.finalBuffer, route, 0.02);
    let allowedEvent = null;
    let pendingEvent = null;

    for (const event of route.events) {
      const score = scoreFn(event, route);
      if (score < threshold) {
        continue;
      }

      const scoredEvent = {
        ...event,
        mlScore: score,
      };

      if (!pendingEvent) {
        if (score >= threshold + immediateBuffer) {
          allowedEvent = scoredEvent;
          break;
        }
        pendingEvent = scoredEvent;
        continue;
      }

      if (event.stationId === pendingEvent.stationId) {
        allowedEvent = scoredEvent;
        break;
      }

      if (score >= pendingEvent.mlScore + replacementMargin) {
        if (score >= threshold + immediateBuffer) {
          allowedEvent = scoredEvent;
          break;
        }
        pendingEvent = scoredEvent;
      }
    }

    if (!allowedEvent && pendingEvent && pendingEvent.mlScore >= threshold + finalBuffer) {
      allowedEvent = pendingEvent;
    }

    const triggered = Boolean(allowedEvent);
    const firstTriggerCorrect = Boolean(
      allowedEvent &&
      route.expectsTrigger &&
      allowedEvent.stationId === route.targetStationId
    );
    const correct = route.expectsTrigger ? firstTriggerCorrect : !triggered;

    return {
      replayId: route.replayId,
      historyLevel: route.historyLevel,
      expectsTrigger: route.expectsTrigger,
      triggered,
      firstTriggerCorrect,
      correct,
      triggerDistance: allowedEvent?.triggerDistance ?? allowedEvent?.forwardDistance ?? null,
      targetStationId: route.targetStationId,
      triggeredStationId: allowedEvent?.stationId ?? null,
    };
  });

  return {
    routes: routeResults,
    scorecard: summarizeRoutes(routeResults),
  };
}

function compareScorecards(leftScorecard, rightScorecard) {
  if ((leftScorecard.recall || 0) !== (rightScorecard.recall || 0)) {
    return (leftScorecard.recall || 0) - (rightScorecard.recall || 0);
  }
  if ((leftScorecard.precisionFirstScore || -999) !== (rightScorecard.precisionFirstScore || -999)) {
    return (leftScorecard.precisionFirstScore || -999) - (rightScorecard.precisionFirstScore || -999);
  }
  if ((leftScorecard.accuracy || 0) !== (rightScorecard.accuracy || 0)) {
    return (leftScorecard.accuracy || 0) - (rightScorecard.accuracy || 0);
  }
  if ((leftScorecard.wrongStationRate || 100) !== (rightScorecard.wrongStationRate || 100)) {
    return (rightScorecard.wrongStationRate || 100) - (leftScorecard.wrongStationRate || 100);
  }
  return (rightScorecard.falsePositiveRate || 100) - (leftScorecard.falsePositiveRate || 100);
}

function tuneGlobalThreshold(routeReplays, scoreFn, maxFalsePositiveRate = 5) {
  return tuneGlobalThresholdWithEvaluator(
    routeReplays,
    scoreFn,
    evaluateRouteReplays,
    maxFalsePositiveRate
  );
}

function tuneGlobalThresholdWithEvaluator(
  routeReplays,
  scoreFn,
  evaluator,
  maxFalsePositiveRate = 5,
  evaluatorConfig = undefined
) {
  let best = null;
  for (let threshold = 0.05; threshold <= 0.95; threshold += 0.01) {
    const normalizedThreshold = Math.round(threshold * 100) / 100;
    const evaluation = evaluator(routeReplays, scoreFn, normalizedThreshold, evaluatorConfig);
    if (evaluation.scorecard.falsePositiveRate > maxFalsePositiveRate) {
      continue;
    }
    const comparison = best
      ? compareScorecards(evaluation.scorecard, best.scorecard)
      : 1;
    if (
      !best ||
      comparison > 0 ||
      (comparison === 0 && normalizedThreshold > best.threshold)
    ) {
      best = {
        threshold: normalizedThreshold,
        scorecard: evaluation.scorecard,
      };
    }
  }
  return best || {
    threshold: 0.99,
    scorecard: evaluator(routeReplays, scoreFn, 0.99, evaluatorConfig).scorecard,
  };
}

function tuneHistoryThresholds(routeReplays, scoreFn, maxFalsePositiveRate = 5) {
  return tuneHistoryThresholdsWithEvaluator(
    routeReplays,
    scoreFn,
    evaluateRouteReplays,
    maxFalsePositiveRate
  );
}

function tuneHistoryThresholdsWithEvaluator(
  routeReplays,
  scoreFn,
  evaluator,
  maxFalsePositiveRate = 5,
  evaluatorConfig = undefined
) {
  const thresholds = {};
  const summaries = {};
  for (const historyLevel of DEFAULT_HISTORY_LEVELS) {
    const bucketRoutes = routeReplays.filter(route => route.historyLevel === historyLevel);
    const tuned = tuneGlobalThresholdWithEvaluator(
      bucketRoutes,
      scoreFn,
      evaluator,
      maxFalsePositiveRate,
      evaluatorConfig
    );
    thresholds[historyLevel] = tuned.threshold;
    summaries[historyLevel] = tuned.scorecard;
  }
  return { thresholds, summaries };
}

function buildProbabilityMap(model, examples) {
  const probabilityMap = new Map();
  for (const example of examples) {
    probabilityMap.set(
      `${example.replayId}:${example.index}`,
      model.predict(example.features)
    );
  }
  return probabilityMap;
}

function buildSequenceFeatureVector(event, context = {}) {
  const baseProbability = Number(context.baseProbability) || 0;
  const priorProbabilities = Array.isArray(context.priorProbabilities) ? context.priorProbabilities : [];
  const priorConfidences = Array.isArray(context.priorConfidences) ? context.priorConfidences : [];
  const priorStationProbabilities = Array.isArray(context.priorStationProbabilities) ? context.priorStationProbabilities : [];
  const priorOtherStationProbabilities = Array.isArray(context.priorOtherStationProbabilities) ? context.priorOtherStationProbabilities : [];
  const previousProbability = priorProbabilities.length ? priorProbabilities[priorProbabilities.length - 1] : 0;
  const previousConfidence = priorConfidences.length ? priorConfidences[priorConfidences.length - 1] : 0;
  const routeEventCount = Math.max(1, Number(context.routeEventCount) || 1);
  const eventIndex = Number(context.eventIndex) || 0;
  const stationRepeatCount = Number(context.stationRepeatCount) || 0;
  const priorHighProbabilityCount = priorProbabilities.filter(value => value >= 0.5).length;
  const priorStationHighProbabilityCount = priorStationProbabilities.filter(value => value >= 0.5).length;
  const confidence = Number(event?.confidence) || 0;
  const forwardDistance = Number(event?.forwardDistance ?? event?.triggerDistance) || 0;

  return [
    clamp(baseProbability, 0, 1),
    clamp(previousProbability, 0, 1),
    clamp(mean(priorProbabilities), 0, 1),
    clamp(Math.max(0, ...priorProbabilities), 0, 1),
    clamp(baseProbability - previousProbability, -1, 1),
    clamp(baseProbability - Math.max(0, ...priorOtherStationProbabilities), -1, 1),
    clamp(mean(priorStationProbabilities), 0, 1),
    clamp(Math.max(0, ...priorStationProbabilities), 0, 1),
    clamp(stationRepeatCount / 4, 0, 1),
    clamp(priorStationHighProbabilityCount / 3, 0, 1),
    clamp(priorHighProbabilityCount / 4, 0, 1),
    clamp((confidence - previousConfidence), -1, 1),
    clamp((eventIndex + 1) / routeEventCount, 0, 1),
    clamp(forwardDistance / 10000, 0, 1),
  ];
}

function buildSequenceExamples(routeReplays, probabilityMap) {
  const examples = [];
  for (const route of routeReplays) {
    const priorProbabilities = [];
    const priorConfidences = [];
    const perStationState = new Map();
    const routeEventCount = route.events.length;
    for (let eventIndex = 0; eventIndex < route.events.length; eventIndex += 1) {
      const event = route.events[eventIndex];
      const baseProbability = probabilityMap.get(`${route.replayId}:${eventIndex}`) || 0;
      const stationKey = String(event.stationId || '');
      const stationState = perStationState.get(stationKey) || {
        probabilities: [],
        confidences: [],
        count: 0,
      };
      const priorStationProbabilities = stationState.probabilities.slice();
      const priorOtherStationProbabilities = [];
      for (const [key, state] of perStationState.entries()) {
        if (key === stationKey) continue;
        priorOtherStationProbabilities.push(...state.probabilities);
      }

      const sequenceFeatures = buildSequenceFeatureVector(event, {
        baseProbability,
        priorProbabilities,
        priorConfidences,
        priorStationProbabilities,
        priorOtherStationProbabilities,
        routeEventCount,
        eventIndex,
        stationRepeatCount: stationState.count,
      });

      examples.push({
        replayId: route.replayId,
        historyLevel: route.historyLevel,
        label: event.label,
        index: eventIndex,
        stationId: event.stationId,
        features: [...event.featureVector, ...sequenceFeatures],
        baseProbability,
        sequenceFeatures,
      });

      priorProbabilities.push(baseProbability);
      priorConfidences.push(Number(event.confidence) || 0);
      stationState.probabilities.push(baseProbability);
      stationState.confidences.push(Number(event.confidence) || 0);
      stationState.count += 1;
      perStationState.set(stationKey, stationState);
    }
  }
  return examples;
}

function createScoreFn(probabilityMap, mode = 'probability') {
  return (event, route) => {
    const replayIndex = route.events.findIndex(candidate => candidate === event);
    const probability = probabilityMap.get(`${route.replayId}:${replayIndex}`) || 0;
    if (mode === 'ensemble') {
      return clamp((probability * 0.70) + ((Number(event.confidence) || 0) * 0.30), 0, 1);
    }
    return probability;
  };
}

function createRecoveryBoostedScoreFn(probabilityMap) {
  return (event, route) => {
    const replayIndex = route.events.findIndex(candidate => candidate === event);
    let probability = probabilityMap.get(`${route.replayId}:${replayIndex}`) || 0;
    const recommendationType = String(event?.type || '');
    const candidateAlongTrack = Number(event?.mlFeatures?.candidateAlongTrack) || 0;
    const candidateIntentEvidence = clamp(Number(event?.mlFeatures?.candidateIntentEvidence) || 0, 0, 1);
    const tripFuelIntentSurplus = Number(event?.mlFeatures?.tripFuelIntentSurplus) || 0;
    const lowSpecificityUrbanColdStart = (
      recommendationType === 'cold_start_best_value' &&
      event?.mlFeatures?.lowSpecificityColdStart &&
      !event?.mlFeatures?.isHighwayCruise &&
      candidateAlongTrack >= 5600 &&
      candidateIntentEvidence <= 0.55 &&
      tripFuelIntentSurplus <= 0.60
    );
    const weakUrbanColdStartHistory = (
      recommendationType === 'cold_start_best_value' &&
      route?.historyLevel !== 'none' &&
      !event?.mlFeatures?.isHighwayCruise &&
      (Number(event?.mlFeatures?.timePatternStrength) || 0) < 0.05 &&
      (Number(event?.mlFeatures?.historyStrength) || 0) > 0.05 &&
      (Number(event?.mlFeatures?.historyStrength) || 0) < 0.20
    );
    if (weakUrbanColdStartHistory) {
      probability = Math.max(0, probability - 0.10);
    }
    if (lowSpecificityUrbanColdStart) {
      probability = Math.max(0, probability - 0.08);
    }
    if (recommendationType !== 'history_recovery_stop') {
      return probability;
    }

    const fuelNeedScore = clamp(Number(event?.fuelNeedScore) || 0, 0, 1);
    const historyRecoveryConfidence = clamp(Number(event?.mlFeatures?.historyRecoveryConfidence) || 0, 0, 1);
    const normalizedTripFuelIntentSurplus = clamp(
      (tripFuelIntentSurplus + 0.10) / 0.35,
      0,
      1
    );
    const recoveryBoost = (
      (fuelNeedScore >= 0.45 ? 0.45 : 0.05) +
      (normalizedTripFuelIntentSurplus * 0.10) +
      (historyRecoveryConfidence * 0.10)
    );

    return clamp(probability + recoveryBoost, 0, 1);
  };
}

function createRecoverySequenceBlendScoreFn(recoveryScoreFn, sequenceProbabilityMap, weights = {}) {
  const recoveryWeight = clamp(Number(weights?.recoveryWeight) || 0.8, 0.05, 0.95);
  const sequenceWeight = clamp(Number(weights?.sequenceWeight) || (1 - recoveryWeight), 0.05, 0.95);
  const totalWeight = recoveryWeight + sequenceWeight;

  return (event, route) => {
    const replayIndex = route.events.findIndex(candidate => candidate === event);
    const recoveryProbability = recoveryScoreFn(event, route);
    const sequenceProbability = sequenceProbabilityMap.get(`${route.replayId}:${replayIndex}`) || 0;
    return clamp(
      ((recoveryProbability * recoveryWeight) + (sequenceProbability * sequenceWeight)) / totalWeight,
      0,
      1
    );
  };
}

function createBlendScoreFn({
  baseProbabilityMap,
  sequenceProbabilityMap,
  weights,
}) {
  const normalizedWeights = {
    base: Number(weights?.base) || 0,
    sequence: Number(weights?.sequence) || 0,
    confidence: Number(weights?.confidence) || 0,
  };
  const totalWeight = Math.max(
    0.0001,
    normalizedWeights.base + normalizedWeights.sequence + normalizedWeights.confidence
  );
  return (event, route) => {
    const replayIndex = route.events.findIndex(candidate => candidate === event);
    const baseProbability = baseProbabilityMap.get(`${route.replayId}:${replayIndex}`) || 0;
    const sequenceProbability = sequenceProbabilityMap.get(`${route.replayId}:${replayIndex}`) || 0;
    const heuristicConfidence = Number(event.confidence) || 0;
    return clamp(
      (
        (baseProbability * normalizedWeights.base) +
        (sequenceProbability * normalizedWeights.sequence) +
        (heuristicConfidence * normalizedWeights.confidence)
      ) / totalWeight,
      0,
      1
    );
  };
}

function createSelectiveHistoryLiftScoreFn(historyModels, options = {}) {
  const {
    historyWeight = 0.82,
    confidenceWeight = 0.18,
    coldStartLift = 0.10,
    recoveryLift = 0.08,
    conversionLift = 0.10,
    skipPenalty = 0.12,
    urgentPenalty = 0.08,
    weakCheaperPenalty = 0.08,
    highDemandPenalty = 0.04,
  } = options;

  return (event, route) => {
    const model = historyModels[route.historyLevel];
    const modelProbability = model ? model.predict(event.featureVector) : 0;
    let score = clamp(
      (modelProbability * historyWeight) +
      ((Number(event.confidence) || 0) * confidenceWeight),
      0,
      1
    );

    const mlFeatures = event?.mlFeatures || {};
    const recommendationType = String(event?.type || '');
    const noticeabilityScore = Number(event?.presentation?.noticeabilityScore) || 0;
    const attentionState = String(event?.presentation?.attentionState || '');
    const tripFuelIntentScore = clamp(Number(mlFeatures.tripFuelIntentScore) || 0, 0, 1);
    const fuelNeedScore = clamp(Number(event?.fuelNeedScore ?? mlFeatures.fuelNeedScore) || 0, 0, 1);
    const candidatePathScore = clamp(Number(mlFeatures.candidatePathScore) || 0, 0, 1);
    const candidateIntentEvidence = clamp(Number(mlFeatures.candidateIntentEvidence) || 0, 0, 1);
    const contextualObservedConversionRate = clamp(Number(mlFeatures.candidateContextualObservedConversionRate) || 0, 0, 1);
    const observedConversionRate = clamp(Number(mlFeatures.candidateObservedConversionRate) || 0, 0, 1);
    const observedSkipScore = clamp(Number(mlFeatures.candidateObservedSkipScore) || 0, 0, 1);
    const predictedDefaultContextualObservedConversionRate = clamp(Number(mlFeatures.predictedDefaultContextualObservedConversionRate) || 0, 0, 1);

    const selectiveColdStartLift = (
      recommendationType === 'cold_start_best_value' &&
      Number(event.confidence) >= 0.60 &&
      tripFuelIntentScore >= 0.62 &&
      fuelNeedScore >= 0.58 &&
      candidatePathScore >= 0.60 &&
      noticeabilityScore >= 0.34 &&
      attentionState !== 'high_demand_drive'
    ) ? coldStartLift : 0;

    const selectiveRecoveryLift = (
      (recommendationType === 'history_recovery_stop' || recommendationType === 'predicted_stop') &&
      Number(event.confidence) >= 0.66 &&
      tripFuelIntentScore >= 0.64 &&
      fuelNeedScore >= 0.50 &&
      noticeabilityScore >= 0.30
    ) ? recoveryLift : 0;

    const exposureAwareLift = (
      (contextualObservedConversionRate * 0.70) +
      (observedConversionRate * 0.30) +
      (predictedDefaultContextualObservedConversionRate * 0.08)
    ) * conversionLift;

    const selectiveUrgentPenalty = (
      recommendationType === 'urgent_any' &&
      tripFuelIntentScore < 0.58 &&
      candidateIntentEvidence < 0.44
    ) ? urgentPenalty : 0;

    const selectiveWeakCheaperPenalty = (
      recommendationType === 'cheaper_alternative' &&
      fuelNeedScore < 0.22 &&
      tripFuelIntentScore < 0.55
    ) ? weakCheaperPenalty : 0;

    const selectiveHighDemandPenalty = (
      attentionState === 'high_demand_drive' &&
      noticeabilityScore < 0.26
    ) ? highDemandPenalty : 0;

    score += selectiveColdStartLift;
    score += selectiveRecoveryLift;
    score += exposureAwareLift;
    score -= observedSkipScore * skipPenalty;
    score -= selectiveUrgentPenalty;
    score -= selectiveWeakCheaperPenalty;
    score -= selectiveHighDemandPenalty;

    return clamp(score, 0, 1);
  };
}

function trainSingleModel(trainExamples) {
  const model = createLogisticGate(Array.isArray(trainExamples?.[0]?.features) ? trainExamples[0].features.length : GATE_FEATURE_SIZE);
  model.train(trainExamples, {
    epochs: 650,
    learningRate: 0.12,
    positiveWeight: 6.5,
    negativeWeight: 1.0,
    l2: 0.0007,
  });
  return model;
}

function trainDenseModel(trainExamples, hiddenSizes, options = {}) {
  const inputSize = Array.isArray(trainExamples?.[0]?.features)
    ? trainExamples[0].features.length
    : (Number(options.featureSize) || GATE_FEATURE_SIZE);
  const model = createDenseBinaryClassifier(inputSize, hiddenSizes, {
    seed: options.seed,
  });
  model.train(trainExamples, {
    epochs: options.epochs || 220,
    batchSize: options.batchSize || 96,
    learningRate: options.learningRate || 0.08,
    positiveWeight: options.positiveWeight || 6.5,
    negativeWeight: options.negativeWeight || 1.0,
    l2: options.l2 || 0.0006,
    shuffleSeed: options.shuffleSeed || 29,
  });
  return model;
}

function trainHistoryModels(trainExamples) {
  const models = {};
  for (const historyLevel of DEFAULT_HISTORY_LEVELS) {
    const bucketExamples = trainExamples.filter(example => example.historyLevel === historyLevel);
    models[historyLevel] = trainSingleModel(bucketExamples);
  }
  return models;
}

function trainHistoryDenseModels(trainExamples, hiddenSizes = [32, 16], options = {}) {
  const models = {};
  const featureSize = Array.isArray(trainExamples?.[0]?.features)
    ? trainExamples[0].features.length
    : (Number(options.featureSize) || GATE_FEATURE_SIZE);
  for (const historyLevel of DEFAULT_HISTORY_LEVELS) {
    const bucketExamples = trainExamples.filter(example => example.historyLevel === historyLevel);
    models[historyLevel] = trainDenseModel(bucketExamples, hiddenSizes, {
      featureSize,
      seed: (Number(options.seed) || 41) + DEFAULT_HISTORY_LEVELS.indexOf(historyLevel),
      epochs: options.epochs || 240,
      batchSize: options.batchSize || 48,
      learningRate: options.learningRate || 0.06,
      positiveWeight: options.positiveWeight || 7.0,
      negativeWeight: options.negativeWeight || 1.0,
      l2: options.l2 || 0.0008,
      shuffleSeed: (Number(options.shuffleSeed) || 53) + DEFAULT_HISTORY_LEVELS.indexOf(historyLevel),
    });
  }
  return models;
}

function tuneBlendDesign({
  validationRouteReplays,
  validationBaseProbabilityMap,
  validationSequenceProbabilityMap,
  testRouteReplays,
  testBaseProbabilityMap,
  testSequenceProbabilityMap,
  maxFalsePositiveRate,
}) {
  const candidateWeights = [];
  const weightValues = [0, 0.15, 0.3, 0.5, 0.7, 0.85, 1];
  for (const base of weightValues) {
    for (const sequence of weightValues) {
      for (const confidence of weightValues) {
        if ((base + sequence + confidence) <= 0) continue;
        candidateWeights.push({ base, sequence, confidence });
      }
    }
  }

  let best = null;
  for (const weights of candidateWeights) {
    const validationScoreFn = createBlendScoreFn({
      baseProbabilityMap: validationBaseProbabilityMap,
      sequenceProbabilityMap: validationSequenceProbabilityMap,
      weights,
    });
    const tunedThreshold = tuneGlobalThreshold(
      validationRouteReplays,
      validationScoreFn,
      maxFalsePositiveRate
    );
    const validationEvaluation = evaluateRouteReplays(
      validationRouteReplays,
      validationScoreFn,
      tunedThreshold.threshold
    );
    if (!best || compareScorecards(validationEvaluation.scorecard, best.validation.scorecard) > 0) {
      const testScoreFn = createBlendScoreFn({
        baseProbabilityMap: testBaseProbabilityMap,
        sequenceProbabilityMap: testSequenceProbabilityMap,
        weights,
      });
      best = {
        weights,
        threshold: tunedThreshold.threshold,
        validation: validationEvaluation,
        test: evaluateRouteReplays(
          testRouteReplays,
          testScoreFn,
          tunedThreshold.threshold
        ),
      };
    }
  }

  return best;
}

function evaluateHistoryModels(routeReplays, models, thresholds, mode = 'probability') {
  return evaluateRouteReplays(
    routeReplays,
    (event, route) => {
      const model = models[route.historyLevel];
      const probability = model ? model.predict(event.featureVector) : 0;
      if (mode === 'ensemble') {
        return clamp((probability * 0.70) + ((Number(event.confidence) || 0) * 0.30), 0, 1);
      }
      return probability;
    },
    thresholds
  );
}

function runMlAugmentedFlowDesigns({
  trainSeeds = [3101, 3102, 3103, 3104, 3105],
  validationSeeds = [4101, 4102, 4103],
  testSeeds = [5101],
  routeCount = 96,
  historyLevels = DEFAULT_HISTORY_LEVELS,
  maxFalsePositiveRate = 5,
} = {}) {
  const baselineTrain = collectRouteReplays({
    seeds: trainSeeds,
    routeCount,
    historyLevels,
    engineOptions: { triggerThreshold: 0.5 },
  });
  const baselineValidation = collectRouteReplays({
    seeds: validationSeeds,
    routeCount,
    historyLevels,
    engineOptions: { triggerThreshold: 0.5 },
  });
  const baselineTest = collectRouteReplays({
    seeds: testSeeds,
    routeCount,
    historyLevels,
    engineOptions: { triggerThreshold: 0.5 },
  });
  const proposalTrain = collectRouteReplays({
    seeds: trainSeeds,
    routeCount,
    historyLevels,
    engineOptions: PROPOSAL_ENGINE_OPTIONS,
  });
  const proposalValidation = collectRouteReplays({
    seeds: validationSeeds,
    routeCount,
    historyLevels,
    engineOptions: PROPOSAL_ENGINE_OPTIONS,
  });
  const proposalTest = collectRouteReplays({
    seeds: testSeeds,
    routeCount,
    historyLevels,
    engineOptions: PROPOSAL_ENGINE_OPTIONS,
  });

  const baselineDesign = {
    name: 'baseline_current',
    family: 'heuristic',
    validation: evaluateRouteReplays(baselineValidation.routeReplays, event => (event ? 1 : 0), 0.5),
    test: evaluateRouteReplays(baselineTest.routeReplays, event => (event ? 1 : 0), 0.5),
  };
  const proposalOnlyDesign = {
    name: 'proposal_only_permissive',
    family: 'heuristic_proposal',
    validation: evaluateRouteReplays(proposalValidation.routeReplays, event => (event ? 1 : 0), 0.5),
    test: evaluateRouteReplays(proposalTest.routeReplays, event => (event ? 1 : 0), 0.5),
  };
  const heuristicConfidenceThreshold = tuneGlobalThreshold(
    proposalValidation.routeReplays,
    event => Number(event.confidence) || 0,
    maxFalsePositiveRate
  );
  const heuristicConfidenceDesign = {
    name: 'heuristic_confidence_budgeted',
    family: 'heuristic_threshold',
    thresholds: { default: heuristicConfidenceThreshold.threshold },
    validation: evaluateRouteReplays(
      proposalValidation.routeReplays,
      event => Number(event.confidence) || 0,
      heuristicConfidenceThreshold.threshold
    ),
    test: evaluateRouteReplays(
      proposalTest.routeReplays,
      event => Number(event.confidence) || 0,
      heuristicConfidenceThreshold.threshold
    ),
  };
  const heuristicHistoryThresholdConfig = tuneHistoryThresholds(
    proposalValidation.routeReplays,
    event => Number(event.confidence) || 0,
    maxFalsePositiveRate
  );
  const heuristicHistoryThresholdDesign = {
    name: 'heuristic_confidence_history_thresholds',
    family: 'heuristic_threshold',
    thresholds: heuristicHistoryThresholdConfig.thresholds,
    validation: evaluateRouteReplays(
      proposalValidation.routeReplays,
      event => Number(event.confidence) || 0,
      heuristicHistoryThresholdConfig.thresholds
    ),
    test: evaluateRouteReplays(
      proposalTest.routeReplays,
      event => Number(event.confidence) || 0,
      heuristicHistoryThresholdConfig.thresholds
    ),
  };

  const sharedModel = trainSingleModel(proposalTrain.examples);
  const validationProbabilityMap = buildProbabilityMap(sharedModel, proposalValidation.examples);
  const testProbabilityMap = buildProbabilityMap(sharedModel, proposalTest.examples);
  const trainProbabilityMap = buildProbabilityMap(sharedModel, proposalTrain.examples);

  const sequenceTrainExamples = buildSequenceExamples(proposalTrain.routeReplays, trainProbabilityMap);
  const sequenceValidationExamples = buildSequenceExamples(proposalValidation.routeReplays, validationProbabilityMap);
  const sequenceTestExamples = buildSequenceExamples(proposalTest.routeReplays, testProbabilityMap);
  const sequenceModel = trainSingleModel(sequenceTrainExamples);
  const sequenceValidationProbabilityMap = buildProbabilityMap(sequenceModel, sequenceValidationExamples);
  const sequenceTestProbabilityMap = buildProbabilityMap(sequenceModel, sequenceTestExamples);

  const globalProbabilityScoreFnValidation = createScoreFn(validationProbabilityMap, 'probability');
  const globalProbabilityScoreFnTest = createScoreFn(testProbabilityMap, 'probability');
  const globalThreshold = tuneGlobalThreshold(
    proposalValidation.routeReplays,
    globalProbabilityScoreFnValidation,
    maxFalsePositiveRate
  );
  const mlGlobalDesign = {
    name: 'ml_gate_global',
    family: 'logistic_gate',
    thresholds: { default: globalThreshold.threshold },
    validation: evaluateRouteReplays(
      proposalValidation.routeReplays,
      globalProbabilityScoreFnValidation,
      globalThreshold.threshold
    ),
    test: evaluateRouteReplays(
      proposalTest.routeReplays,
      globalProbabilityScoreFnTest,
      globalThreshold.threshold
    ),
  };
  const recoveryBoostedValidationScoreFn = createRecoveryBoostedScoreFn(validationProbabilityMap);
  const recoveryBoostedTestScoreFn = createRecoveryBoostedScoreFn(testProbabilityMap);
  const recoveryBoostedThreshold = tuneGlobalThreshold(
    proposalValidation.routeReplays,
    recoveryBoostedValidationScoreFn,
    maxFalsePositiveRate
  );
  const mlRecoveryBoostedDesign = {
    name: 'ml_gate_contextual_recovery',
    family: 'logistic_contextual',
    thresholds: { default: recoveryBoostedThreshold.threshold },
    validation: evaluateRouteReplays(
      proposalValidation.routeReplays,
      recoveryBoostedValidationScoreFn,
      recoveryBoostedThreshold.threshold
    ),
    test: evaluateRouteReplays(
      proposalTest.routeReplays,
      recoveryBoostedTestScoreFn,
      recoveryBoostedThreshold.threshold
    ),
  };
  const recoverySequenceBlendValidationScoreFn = createRecoverySequenceBlendScoreFn(
    recoveryBoostedValidationScoreFn,
    sequenceValidationProbabilityMap,
    { recoveryWeight: 0.8, sequenceWeight: 0.2 }
  );
  const recoverySequenceBlendTestScoreFn = createRecoverySequenceBlendScoreFn(
    recoveryBoostedTestScoreFn,
    sequenceTestProbabilityMap,
    { recoveryWeight: 0.8, sequenceWeight: 0.2 }
  );
  const recoverySequenceBlendThreshold = tuneGlobalThreshold(
    proposalValidation.routeReplays,
    recoverySequenceBlendValidationScoreFn,
    maxFalsePositiveRate
  );
  const mlRecoverySequenceBlendDesign = {
    name: 'ml_gate_recovery_sequence_blend',
    family: 'logistic_contextual_sequence',
    thresholds: { default: recoverySequenceBlendThreshold.threshold },
    validation: evaluateRouteReplays(
      proposalValidation.routeReplays,
      recoverySequenceBlendValidationScoreFn,
      recoverySequenceBlendThreshold.threshold
    ),
    test: evaluateRouteReplays(
      proposalTest.routeReplays,
      recoverySequenceBlendTestScoreFn,
      recoverySequenceBlendThreshold.threshold
    ),
  };

  const historyThresholdConfig = tuneHistoryThresholds(
    proposalValidation.routeReplays,
    globalProbabilityScoreFnValidation,
    maxFalsePositiveRate
  );
  const mlHistoryThresholdDesign = {
    name: 'ml_gate_history_thresholds',
    family: 'logistic_gate',
    thresholds: historyThresholdConfig.thresholds,
    validation: evaluateRouteReplays(
      proposalValidation.routeReplays,
      globalProbabilityScoreFnValidation,
      historyThresholdConfig.thresholds
    ),
    test: evaluateRouteReplays(
      proposalTest.routeReplays,
      globalProbabilityScoreFnTest,
      historyThresholdConfig.thresholds
    ),
  };

  const ensembleValidationScoreFn = createScoreFn(validationProbabilityMap, 'ensemble');
  const ensembleTestScoreFn = createScoreFn(testProbabilityMap, 'ensemble');
  const ensembleThresholdConfig = tuneHistoryThresholds(
    proposalValidation.routeReplays,
    ensembleValidationScoreFn,
    maxFalsePositiveRate
  );
  const mlEnsembleDesign = {
    name: 'ml_gate_history_ensemble',
    family: 'logistic_ensemble',
    thresholds: ensembleThresholdConfig.thresholds,
    validation: evaluateRouteReplays(
      proposalValidation.routeReplays,
      ensembleValidationScoreFn,
      ensembleThresholdConfig.thresholds
    ),
    test: evaluateRouteReplays(
      proposalTest.routeReplays,
      ensembleTestScoreFn,
      ensembleThresholdConfig.thresholds
    ),
  };

  const historyModels = trainHistoryModels(proposalTrain.examples);
  const denseHistoryModels = trainHistoryDenseModels(proposalTrain.examples, [32, 16], {
    seed: 97,
    shuffleSeed: 131,
  });
  const historyModelThresholdConfig = tuneHistoryThresholds(
    proposalValidation.routeReplays,
    (event, route) => historyModels[route.historyLevel].predict(event.featureVector),
    maxFalsePositiveRate
  );
  const mlHistoryModelDesign = {
    name: 'ml_gate_history_models',
    family: 'logistic_gate',
    thresholds: historyModelThresholdConfig.thresholds,
    validation: evaluateHistoryModels(
      proposalValidation.routeReplays,
      historyModels,
      historyModelThresholdConfig.thresholds,
      'probability'
    ),
    test: evaluateHistoryModels(
      proposalTest.routeReplays,
      historyModels,
      historyModelThresholdConfig.thresholds,
      'probability'
    ),
  };

  const sequenceGlobalScoreFnValidation = createScoreFn(sequenceValidationProbabilityMap, 'probability');
  const sequenceGlobalScoreFnTest = createScoreFn(sequenceTestProbabilityMap, 'probability');
  const sequenceGlobalThreshold = tuneGlobalThreshold(
    proposalValidation.routeReplays,
    sequenceGlobalScoreFnValidation,
    maxFalsePositiveRate
  );
  const mlSequenceGlobalDesign = {
    name: 'ml_gate_sequence_global',
    family: 'logistic_sequence',
    thresholds: { default: sequenceGlobalThreshold.threshold },
    validation: evaluateRouteReplays(
      proposalValidation.routeReplays,
      sequenceGlobalScoreFnValidation,
      sequenceGlobalThreshold.threshold
    ),
    test: evaluateRouteReplays(
      proposalTest.routeReplays,
      sequenceGlobalScoreFnTest,
      sequenceGlobalThreshold.threshold
    ),
  };

  const sequenceHistoryThresholdConfig = tuneHistoryThresholds(
    proposalValidation.routeReplays,
    sequenceGlobalScoreFnValidation,
    maxFalsePositiveRate
  );
  const mlSequenceHistoryThresholdDesign = {
    name: 'ml_gate_sequence_history_thresholds',
    family: 'logistic_sequence',
    thresholds: sequenceHistoryThresholdConfig.thresholds,
    validation: evaluateRouteReplays(
      proposalValidation.routeReplays,
      sequenceGlobalScoreFnValidation,
      sequenceHistoryThresholdConfig.thresholds
    ),
    test: evaluateRouteReplays(
      proposalTest.routeReplays,
      sequenceGlobalScoreFnTest,
      sequenceHistoryThresholdConfig.thresholds
    ),
  };

  const blendedDesign = tuneBlendDesign({
    validationRouteReplays: proposalValidation.routeReplays,
    validationBaseProbabilityMap: validationProbabilityMap,
    validationSequenceProbabilityMap: sequenceValidationProbabilityMap,
    testRouteReplays: proposalTest.routeReplays,
    testBaseProbabilityMap: testProbabilityMap,
    testSequenceProbabilityMap: sequenceTestProbabilityMap,
    maxFalsePositiveRate,
  });
  const mlStackedBlendDesign = {
    name: 'ml_gate_stacked_blend',
    family: 'logistic_sequence',
    thresholds: { default: blendedDesign.threshold },
    weights: blendedDesign.weights,
    validation: blendedDesign.validation,
    test: blendedDesign.test,
  };

  const designs = [
    baselineDesign,
    proposalOnlyDesign,
    heuristicConfidenceDesign,
    heuristicHistoryThresholdDesign,
    mlGlobalDesign,
    mlRecoveryBoostedDesign,
    mlRecoverySequenceBlendDesign,
    mlHistoryThresholdDesign,
    mlEnsembleDesign,
    mlHistoryModelDesign,
    mlSequenceGlobalDesign,
    mlSequenceHistoryThresholdDesign,
    mlStackedBlendDesign,
  ];

  const bestDesign = designs
    .filter(design => design.name.startsWith('ml_') && design.test.scorecard.falsePositiveRate <= maxFalsePositiveRate)
    .sort((left, right) => compareScorecards(right.test.scorecard, left.test.scorecard))[0] || null;

  return {
    proposalEngineOptions: { ...PROPOSAL_ENGINE_OPTIONS },
    datasets: {
      train: { replayCount: proposalTrain.routeReplays.length, exampleCount: proposalTrain.examples.length },
      validation: { replayCount: proposalValidation.routeReplays.length, exampleCount: proposalValidation.examples.length },
      test: { replayCount: proposalTest.routeReplays.length, exampleCount: proposalTest.examples.length },
      sequence: {
        trainExampleCount: sequenceTrainExamples.length,
        validationExampleCount: sequenceValidationExamples.length,
        testExampleCount: sequenceTestExamples.length,
      },
    },
    designs,
    bestDesign,
  };
}

function buildSeedRange(start, count) {
  return Array.from({ length: count }, (_, index) => start + index);
}

function runScaledMlCapacityExperiment({
  trainSeeds = buildSeedRange(9101, 18),
  validationSeeds = buildSeedRange(9201, 4),
  testSeeds = buildSeedRange(9301, 4),
  routeCount = 128,
  historyLevels = DEFAULT_HISTORY_LEVELS,
  maxFalsePositiveRate = 5,
} = {}) {
  const proposalTrain = collectRouteReplays({
    seeds: trainSeeds,
    routeCount,
    historyLevels,
    engineOptions: PROPOSAL_ENGINE_OPTIONS,
  });
  const proposalValidation = collectRouteReplays({
    seeds: validationSeeds,
    routeCount,
    historyLevels,
    engineOptions: PROPOSAL_ENGINE_OPTIONS,
  });
  const proposalTest = collectRouteReplays({
    seeds: testSeeds,
    routeCount,
    historyLevels,
    engineOptions: PROPOSAL_ENGINE_OPTIONS,
  });

  const logisticModel = trainSingleModel(proposalTrain.examples);
  const validationProbabilityMap = buildProbabilityMap(logisticModel, proposalValidation.examples);
  const testProbabilityMap = buildProbabilityMap(logisticModel, proposalTest.examples);
  const logisticThreshold = tuneGlobalThreshold(
    proposalValidation.routeReplays,
    createScoreFn(validationProbabilityMap, 'probability'),
    maxFalsePositiveRate
  );
  const logisticDesign = {
    name: 'logistic_large_data',
    family: 'scaled_linear',
    thresholds: { default: logisticThreshold.threshold },
    validation: evaluateRouteReplays(
      proposalValidation.routeReplays,
      createScoreFn(validationProbabilityMap, 'probability'),
      logisticThreshold.threshold
    ),
    test: evaluateRouteReplays(
      proposalTest.routeReplays,
      createScoreFn(testProbabilityMap, 'probability'),
      logisticThreshold.threshold
    ),
  };

  const denseBaseModel = trainDenseModel(proposalTrain.examples, [64, 32], {
    seed: 111,
    epochs: 260,
    batchSize: 128,
    learningRate: 0.075,
    positiveWeight: 6.8,
    l2: 0.0007,
    shuffleSeed: 41,
  });
  const denseBaseValidationMap = buildProbabilityMap(denseBaseModel, proposalValidation.examples);
  const denseBaseTestMap = buildProbabilityMap(denseBaseModel, proposalTest.examples);
  const denseBaseThreshold = tuneGlobalThreshold(
    proposalValidation.routeReplays,
    createScoreFn(denseBaseValidationMap, 'probability'),
    maxFalsePositiveRate
  );
  const denseBaseDesign = {
    name: 'dense_base_large_data',
    family: 'scaled_dense',
    thresholds: { default: denseBaseThreshold.threshold },
    validation: evaluateRouteReplays(
      proposalValidation.routeReplays,
      createScoreFn(denseBaseValidationMap, 'probability'),
      denseBaseThreshold.threshold
    ),
    test: evaluateRouteReplays(
      proposalTest.routeReplays,
      createScoreFn(denseBaseTestMap, 'probability'),
      denseBaseThreshold.threshold
    ),
  };

  const trainSequenceExamples = buildSequenceExamples(proposalTrain.routeReplays, buildProbabilityMap(logisticModel, proposalTrain.examples));
  const validationSequenceExamples = buildSequenceExamples(proposalValidation.routeReplays, validationProbabilityMap);
  const testSequenceExamples = buildSequenceExamples(proposalTest.routeReplays, testProbabilityMap);
  const denseSequenceModel = trainDenseModel(trainSequenceExamples, [96, 48, 24], {
    seed: 211,
    epochs: 280,
    batchSize: 128,
    learningRate: 0.07,
    positiveWeight: 7.2,
    l2: 0.0008,
    shuffleSeed: 57,
  });
  const denseSequenceValidationMap = buildProbabilityMap(denseSequenceModel, validationSequenceExamples);
  const denseSequenceTestMap = buildProbabilityMap(denseSequenceModel, testSequenceExamples);
  const denseSequenceThreshold = tuneGlobalThreshold(
    proposalValidation.routeReplays,
    createScoreFn(denseSequenceValidationMap, 'probability'),
    maxFalsePositiveRate
  );
  const denseSequenceDesign = {
    name: 'dense_sequence_large_data',
    family: 'scaled_dense_sequence',
    thresholds: { default: denseSequenceThreshold.threshold },
    validation: evaluateRouteReplays(
      proposalValidation.routeReplays,
      createScoreFn(denseSequenceValidationMap, 'probability'),
      denseSequenceThreshold.threshold
    ),
    test: evaluateRouteReplays(
      proposalTest.routeReplays,
      createScoreFn(denseSequenceTestMap, 'probability'),
      denseSequenceThreshold.threshold
    ),
  };

  const designs = [
    logisticDesign,
    denseBaseDesign,
    denseSequenceDesign,
  ];
  const bestDesign = [...designs].sort((left, right) =>
    compareScorecards(right.test.scorecard, left.test.scorecard)
  )[0] || null;

  return {
    datasets: {
      train: {
        seedCount: trainSeeds.length,
        routeCount,
        replayCount: proposalTrain.routeReplays.length,
        exampleCount: proposalTrain.examples.length,
        sequenceExampleCount: trainSequenceExamples.length,
      },
      validation: {
        seedCount: validationSeeds.length,
        replayCount: proposalValidation.routeReplays.length,
        exampleCount: proposalValidation.examples.length,
        sequenceExampleCount: validationSequenceExamples.length,
      },
      test: {
        seedCount: testSeeds.length,
        replayCount: proposalTest.routeReplays.length,
        exampleCount: proposalTest.examples.length,
        sequenceExampleCount: testSequenceExamples.length,
      },
    },
    designs,
    bestDesign,
  };
}

function runRealisticMlCohortExperiment({
  trainSeeds = [7101, 7102, 7103, 7104],
  validationSeeds = [7201, 7202],
  testSeeds = [7301],
  historyLevels = DEFAULT_HISTORY_LEVELS,
  driverCount = 4,
  routesPerDriver = 18,
  freezeVisitHistory = false,
  maxFalsePositiveRate = 5,
} = {}) {
  const simulationOptions = {
    driverCount,
    routesPerDriver,
    freezeVisitHistory,
  };
  const proposalTrain = collectRouteReplays({
    seeds: trainSeeds,
    routeCount: routesPerDriver,
    historyLevels,
    engineOptions: REALISTIC_PROPOSAL_ENGINE_OPTIONS,
    simulationFn: simulateRealisticCohortBatch,
    simulationOptions,
    collectDecisionSnapshots: true,
  });
  const proposalValidation = collectRouteReplays({
    seeds: validationSeeds,
    routeCount: routesPerDriver,
    historyLevels,
    engineOptions: REALISTIC_PROPOSAL_ENGINE_OPTIONS,
    simulationFn: simulateRealisticCohortBatch,
    simulationOptions,
    collectDecisionSnapshots: true,
  });
  const proposalTest = collectRouteReplays({
    seeds: testSeeds,
    routeCount: routesPerDriver,
    historyLevels,
    engineOptions: REALISTIC_PROPOSAL_ENGINE_OPTIONS,
    simulationFn: simulateRealisticCohortBatch,
    simulationOptions,
    collectDecisionSnapshots: true,
  });
  const proposalSnapshotTrain = collectProposalSnapshotRerankReplays(proposalTrain.routeReplays);
  const proposalSnapshotValidation = collectProposalSnapshotRerankReplays(proposalValidation.routeReplays);
  const proposalSnapshotTest = collectProposalSnapshotRerankReplays(proposalTest.routeReplays);
  const decisionTrain = collectDecisionPointReplays({
    seeds: trainSeeds,
    historyLevels,
    simulationFn: simulateRealisticCohortBatch,
    simulationOptions,
  });
  const decisionValidation = collectDecisionPointReplays({
    seeds: validationSeeds,
    historyLevels,
    simulationFn: simulateRealisticCohortBatch,
    simulationOptions,
  });
  const decisionTest = collectDecisionPointReplays({
    seeds: testSeeds,
    historyLevels,
    simulationFn: simulateRealisticCohortBatch,
    simulationOptions,
  });

  const logisticModel = trainSingleModel(proposalTrain.examples);
  const validationProbabilityMap = buildProbabilityMap(logisticModel, proposalValidation.examples);
  const testProbabilityMap = buildProbabilityMap(logisticModel, proposalTest.examples);
  const logisticThreshold = tuneGlobalThreshold(
    proposalValidation.routeReplays,
    createScoreFn(validationProbabilityMap, 'probability'),
    maxFalsePositiveRate
  );
  const logisticDesign = {
    name: 'cohort_logistic_gate',
    family: 'realistic_cohort',
    thresholds: { default: logisticThreshold.threshold },
    validation: evaluateRouteReplays(
      proposalValidation.routeReplays,
      createScoreFn(validationProbabilityMap, 'probability'),
      logisticThreshold.threshold
    ),
    test: evaluateRouteReplays(
      proposalTest.routeReplays,
      createScoreFn(testProbabilityMap, 'probability'),
      logisticThreshold.threshold
    ),
  };
  const logisticHistoryThresholdConfig = tuneHistoryThresholds(
    proposalValidation.routeReplays,
    createScoreFn(validationProbabilityMap, 'probability'),
    maxFalsePositiveRate
  );
  const logisticHistoryThresholdDesign = {
    name: 'cohort_logistic_history_thresholds',
    family: 'realistic_cohort',
    thresholds: logisticHistoryThresholdConfig.thresholds,
    validation: evaluateRouteReplays(
      proposalValidation.routeReplays,
      createScoreFn(validationProbabilityMap, 'probability'),
      logisticHistoryThresholdConfig.thresholds
    ),
    test: evaluateRouteReplays(
      proposalTest.routeReplays,
      createScoreFn(testProbabilityMap, 'probability'),
      logisticHistoryThresholdConfig.thresholds
    ),
  };

  const recoveryValidationScoreFn = createRecoveryBoostedScoreFn(validationProbabilityMap);
  const recoveryTestScoreFn = createRecoveryBoostedScoreFn(testProbabilityMap);
  const recoveryThreshold = tuneGlobalThreshold(
    proposalValidation.routeReplays,
    recoveryValidationScoreFn,
    maxFalsePositiveRate
  );
  const recoveryDesign = {
    name: 'cohort_contextual_recovery',
    family: 'realistic_cohort',
    thresholds: { default: recoveryThreshold.threshold },
    validation: evaluateRouteReplays(
      proposalValidation.routeReplays,
      recoveryValidationScoreFn,
      recoveryThreshold.threshold
    ),
    test: evaluateRouteReplays(
      proposalTest.routeReplays,
      recoveryTestScoreFn,
      recoveryThreshold.threshold
    ),
  };
  const recoveryHistoryThresholdConfig = tuneHistoryThresholds(
    proposalValidation.routeReplays,
    recoveryValidationScoreFn,
    maxFalsePositiveRate
  );
  const recoveryHistoryThresholdDesign = {
    name: 'cohort_contextual_recovery_history_thresholds',
    family: 'realistic_cohort',
    thresholds: recoveryHistoryThresholdConfig.thresholds,
    validation: evaluateRouteReplays(
      proposalValidation.routeReplays,
      recoveryValidationScoreFn,
      recoveryHistoryThresholdConfig.thresholds
    ),
    test: evaluateRouteReplays(
      proposalTest.routeReplays,
      recoveryTestScoreFn,
      recoveryHistoryThresholdConfig.thresholds
    ),
  };

  const sequenceTrainExamples = buildSequenceExamples(
    proposalTrain.routeReplays,
    buildProbabilityMap(logisticModel, proposalTrain.examples)
  );
  const sequenceValidationExamples = buildSequenceExamples(proposalValidation.routeReplays, validationProbabilityMap);
  const sequenceTestExamples = buildSequenceExamples(proposalTest.routeReplays, testProbabilityMap);
  const sequenceModel = trainSingleModel(sequenceTrainExamples);
  const sequenceValidationProbabilityMap = buildProbabilityMap(sequenceModel, sequenceValidationExamples);
  const sequenceTestProbabilityMap = buildProbabilityMap(sequenceModel, sequenceTestExamples);
  const sequenceThreshold = tuneGlobalThreshold(
    proposalValidation.routeReplays,
    createScoreFn(sequenceValidationProbabilityMap, 'probability'),
    maxFalsePositiveRate
  );
  const sequenceDesign = {
    name: 'cohort_sequence_gate',
    family: 'realistic_cohort',
    thresholds: { default: sequenceThreshold.threshold },
    validation: evaluateRouteReplays(
      proposalValidation.routeReplays,
      createScoreFn(sequenceValidationProbabilityMap, 'probability'),
      sequenceThreshold.threshold
    ),
    test: evaluateRouteReplays(
      proposalTest.routeReplays,
      createScoreFn(sequenceTestProbabilityMap, 'probability'),
      sequenceThreshold.threshold
    ),
  };
  const sequenceHistoryThresholdConfig = tuneHistoryThresholds(
    proposalValidation.routeReplays,
    createScoreFn(sequenceValidationProbabilityMap, 'probability'),
    maxFalsePositiveRate
  );
  const sequenceHistoryThresholdDesign = {
    name: 'cohort_sequence_history_thresholds',
    family: 'realistic_cohort',
    thresholds: sequenceHistoryThresholdConfig.thresholds,
    validation: evaluateRouteReplays(
      proposalValidation.routeReplays,
      createScoreFn(sequenceValidationProbabilityMap, 'probability'),
      sequenceHistoryThresholdConfig.thresholds
    ),
    test: evaluateRouteReplays(
      proposalTest.routeReplays,
      createScoreFn(sequenceTestProbabilityMap, 'probability'),
      sequenceHistoryThresholdConfig.thresholds
    ),
  };
  const recoverySequenceBlendValidationScoreFn = createRecoverySequenceBlendScoreFn(
    recoveryValidationScoreFn,
    sequenceValidationProbabilityMap,
    { recoveryWeight: 0.8, sequenceWeight: 0.2 }
  );
  const recoverySequenceBlendTestScoreFn = createRecoverySequenceBlendScoreFn(
    recoveryTestScoreFn,
    sequenceTestProbabilityMap,
    { recoveryWeight: 0.8, sequenceWeight: 0.2 }
  );
  const recoverySequenceBlendThreshold = tuneGlobalThreshold(
    proposalValidation.routeReplays,
    recoverySequenceBlendValidationScoreFn,
    maxFalsePositiveRate
  );
  const recoverySequenceBlendDesign = {
    name: 'cohort_recovery_sequence_blend',
    family: 'realistic_cohort',
    thresholds: { default: recoverySequenceBlendThreshold.threshold },
    validation: evaluateRouteReplays(
      proposalValidation.routeReplays,
      recoverySequenceBlendValidationScoreFn,
      recoverySequenceBlendThreshold.threshold
    ),
    test: evaluateRouteReplays(
      proposalTest.routeReplays,
      recoverySequenceBlendTestScoreFn,
      recoverySequenceBlendThreshold.threshold
    ),
  };

  const historyModels = trainHistoryModels(proposalTrain.examples);
  const denseHistoryModels = trainHistoryDenseModels(proposalTrain.examples, [32, 16], {
    seed: 97,
    shuffleSeed: 131,
  });
  const historyModelThresholdConfig = tuneHistoryThresholds(
    proposalValidation.routeReplays,
    (event, route) => historyModels[route.historyLevel].predict(event.featureVector),
    maxFalsePositiveRate
  );
  const historyModelDesign = {
    name: 'cohort_history_models',
    family: 'realistic_cohort',
    thresholds: historyModelThresholdConfig.thresholds,
    validation: evaluateHistoryModels(
      proposalValidation.routeReplays,
      historyModels,
      historyModelThresholdConfig.thresholds,
      'probability'
    ),
    test: evaluateHistoryModels(
      proposalTest.routeReplays,
      historyModels,
      historyModelThresholdConfig.thresholds,
      'probability'
    ),
  };
  const denseHistoryModelThresholdConfig = tuneHistoryThresholds(
    proposalValidation.routeReplays,
    (event, route) => denseHistoryModels[route.historyLevel].predict(event.featureVector),
    maxFalsePositiveRate
  );
  const denseHistoryModelDesign = {
    name: 'cohort_history_dense_models',
    family: 'realistic_cohort',
    thresholds: denseHistoryModelThresholdConfig.thresholds,
    validation: evaluateRouteReplays(
      proposalValidation.routeReplays,
      (event, route) => denseHistoryModels[route.historyLevel].predict(event.featureVector),
      denseHistoryModelThresholdConfig.thresholds
    ),
    test: evaluateRouteReplays(
      proposalTest.routeReplays,
      (event, route) => denseHistoryModels[route.historyLevel].predict(event.featureVector),
      denseHistoryModelThresholdConfig.thresholds
    ),
  };
  const denseHistoryModelConfidenceBlendScoreFn = (event, route) => clamp(
    (denseHistoryModels[route.historyLevel].predict(event.featureVector) * 0.82) +
    ((Number(event.confidence) || 0) * 0.18),
    0,
    1
  );
  const denseHistoryModelConfidenceBlendThresholdConfig = tuneHistoryThresholds(
    proposalValidation.routeReplays,
    denseHistoryModelConfidenceBlendScoreFn,
    maxFalsePositiveRate
  );
  const denseHistoryModelConfidenceBlendDesign = {
    name: 'cohort_history_dense_models_confidence_blend',
    family: 'realistic_cohort',
    thresholds: denseHistoryModelConfidenceBlendThresholdConfig.thresholds,
    validation: evaluateRouteReplays(
      proposalValidation.routeReplays,
      denseHistoryModelConfidenceBlendScoreFn,
      denseHistoryModelConfidenceBlendThresholdConfig.thresholds
    ),
    test: evaluateRouteReplays(
      proposalTest.routeReplays,
      denseHistoryModelConfidenceBlendScoreFn,
      denseHistoryModelConfidenceBlendThresholdConfig.thresholds
    ),
  };
  const selectiveHistoryLiftScoreFn = createSelectiveHistoryLiftScoreFn(historyModels);
  const selectiveHistoryLiftThresholdConfig = tuneHistoryThresholds(
    proposalValidation.routeReplays,
    selectiveHistoryLiftScoreFn,
    maxFalsePositiveRate
  );
  const selectiveHistoryLiftDesign = {
    name: 'cohort_history_models_selective_lift',
    family: 'realistic_cohort',
    thresholds: selectiveHistoryLiftThresholdConfig.thresholds,
    validation: evaluateRouteReplays(
      proposalValidation.routeReplays,
      selectiveHistoryLiftScoreFn,
      selectiveHistoryLiftThresholdConfig.thresholds
    ),
    test: evaluateRouteReplays(
      proposalTest.routeReplays,
      selectiveHistoryLiftScoreFn,
      selectiveHistoryLiftThresholdConfig.thresholds
    ),
  };
  const historyModelConfidenceBlendScoreFn = (event, route) => clamp(
    (historyModels[route.historyLevel].predict(event.featureVector) * 0.78) +
    ((Number(event.confidence) || 0) * 0.22),
    0,
    1
  );
  const historyModelConfidenceBlendThresholdConfig = tuneHistoryThresholds(
    proposalValidation.routeReplays,
    historyModelConfidenceBlendScoreFn,
    maxFalsePositiveRate
  );
  const historyModelConfidenceBlendDesign = {
    name: 'cohort_history_models_confidence_blend',
    family: 'realistic_cohort',
    thresholds: historyModelConfidenceBlendThresholdConfig.thresholds,
    validation: evaluateRouteReplays(
      proposalValidation.routeReplays,
      historyModelConfidenceBlendScoreFn,
      historyModelConfidenceBlendThresholdConfig.thresholds
    ),
    test: evaluateRouteReplays(
      proposalTest.routeReplays,
      historyModelConfidenceBlendScoreFn,
      historyModelConfidenceBlendThresholdConfig.thresholds
    ),
  };
  const proposalNativeStationModels = trainHistoryModels(proposalSnapshotTrain.pairwiseExamples);
  const proposalNativeStationDenseModels = trainHistoryDenseModels(proposalSnapshotTrain.pairwiseExamples, [48, 24], {
    seed: 809,
    shuffleSeed: 877,
    epochs: 260,
    batchSize: 64,
    learningRate: 0.05,
    positiveWeight: 8.5,
  });
  const proposalNativeSnapshotValidationIndex = buildProposalSnapshotReplayIndex(proposalSnapshotValidation.eventReplays);
  const proposalNativeSnapshotTestIndex = buildProposalSnapshotReplayIndex(proposalSnapshotTest.eventReplays);
  const proposalNativeStationScoreFn = createPairwiseStationScoreFn(proposalNativeStationModels);
  const proposalNativeStationDenseScoreFn = createPairwiseStationScoreFn(proposalNativeStationDenseModels);
  const proposalNativeRerankerThresholdConfig = tuneStationRerankerThresholds(
    proposalValidation.routeReplays,
    historyModelConfidenceBlendScoreFn,
    historyModelConfidenceBlendThresholdConfig.thresholds,
    proposalNativeSnapshotValidationIndex,
    proposalNativeStationScoreFn,
    maxFalsePositiveRate
  );
  const proposalNativeRerankerDesign = {
    name: 'cohort_history_models_confidence_blend_native_reranker',
    family: 'realistic_cohort',
    thresholds: historyModelConfidenceBlendThresholdConfig.thresholds,
    stationThresholds: proposalNativeRerankerThresholdConfig.stationThresholds,
    stationMargins: proposalNativeRerankerThresholdConfig.stationMargins,
    validation: evaluateRouteReplaysWithStationReranker(
      proposalValidation.routeReplays,
      historyModelConfidenceBlendScoreFn,
      historyModelConfidenceBlendThresholdConfig.thresholds,
      proposalNativeSnapshotValidationIndex,
      proposalNativeStationScoreFn,
      {
        stationThreshold: proposalNativeRerankerThresholdConfig.stationThresholds,
        stationMargin: proposalNativeRerankerThresholdConfig.stationMargins,
      }
    ),
    test: evaluateRouteReplaysWithStationReranker(
      proposalTest.routeReplays,
      historyModelConfidenceBlendScoreFn,
      historyModelConfidenceBlendThresholdConfig.thresholds,
      proposalNativeSnapshotTestIndex,
      proposalNativeStationScoreFn,
      {
        stationThreshold: proposalNativeRerankerThresholdConfig.stationThresholds,
        stationMargin: proposalNativeRerankerThresholdConfig.stationMargins,
      }
    ),
  };
  const proposalNativeDenseRerankerThresholdConfig = tuneStationRerankerThresholds(
    proposalValidation.routeReplays,
    historyModelConfidenceBlendScoreFn,
    historyModelConfidenceBlendThresholdConfig.thresholds,
    proposalNativeSnapshotValidationIndex,
    proposalNativeStationDenseScoreFn,
    maxFalsePositiveRate
  );
  const proposalNativeDenseRerankerDesign = {
    name: 'cohort_history_models_confidence_blend_native_reranker_dense',
    family: 'realistic_cohort',
    thresholds: historyModelConfidenceBlendThresholdConfig.thresholds,
    stationThresholds: proposalNativeDenseRerankerThresholdConfig.stationThresholds,
    stationMargins: proposalNativeDenseRerankerThresholdConfig.stationMargins,
    validation: evaluateRouteReplaysWithStationReranker(
      proposalValidation.routeReplays,
      historyModelConfidenceBlendScoreFn,
      historyModelConfidenceBlendThresholdConfig.thresholds,
      proposalNativeSnapshotValidationIndex,
      proposalNativeStationDenseScoreFn,
      {
        stationThreshold: proposalNativeDenseRerankerThresholdConfig.stationThresholds,
        stationMargin: proposalNativeDenseRerankerThresholdConfig.stationMargins,
      }
    ),
    test: evaluateRouteReplaysWithStationReranker(
      proposalTest.routeReplays,
      historyModelConfidenceBlendScoreFn,
      historyModelConfidenceBlendThresholdConfig.thresholds,
      proposalNativeSnapshotTestIndex,
      proposalNativeStationDenseScoreFn,
      {
        stationThreshold: proposalNativeDenseRerankerThresholdConfig.stationThresholds,
        stationMargin: proposalNativeDenseRerankerThresholdConfig.stationMargins,
      }
    ),
  };
  const statefulHistoryModelGateConfig = {
    immediateBuffer: {
      none: 0.10,
      light: 0.09,
      rich: 0.08,
      default: 0.09,
    },
    replacementMargin: {
      none: 0.05,
      light: 0.04,
      rich: 0.04,
      default: 0.04,
    },
    finalBuffer: {
      none: 0.03,
      light: 0.02,
      rich: 0.02,
      default: 0.02,
    },
  };
  const selectiveHistoryLiftStatefulThresholdConfig = tuneHistoryThresholdsWithEvaluator(
    proposalValidation.routeReplays,
    selectiveHistoryLiftScoreFn,
    evaluateStatefulRouteReplays,
    maxFalsePositiveRate,
    statefulHistoryModelGateConfig
  );
  const selectiveHistoryLiftStatefulDesign = {
    name: 'cohort_history_models_selective_lift_stateful',
    family: 'realistic_cohort',
    thresholds: selectiveHistoryLiftStatefulThresholdConfig.thresholds,
    gateConfig: statefulHistoryModelGateConfig,
    validation: evaluateStatefulRouteReplays(
      proposalValidation.routeReplays,
      selectiveHistoryLiftScoreFn,
      selectiveHistoryLiftStatefulThresholdConfig.thresholds,
      statefulHistoryModelGateConfig
    ),
    test: evaluateStatefulRouteReplays(
      proposalTest.routeReplays,
      selectiveHistoryLiftScoreFn,
      selectiveHistoryLiftStatefulThresholdConfig.thresholds,
      statefulHistoryModelGateConfig
    ),
  };
  const tunedStatefulHistoryThresholdConfig = tuneHistoryThresholdsWithEvaluator(
    proposalValidation.routeReplays,
    (event, route) => historyModels[route.historyLevel].predict(event.featureVector),
    evaluateStatefulRouteReplays,
    maxFalsePositiveRate,
    statefulHistoryModelGateConfig
  );
  const statefulHistoryModelDesign = {
    name: 'cohort_history_models_stateful',
    family: 'realistic_cohort',
    thresholds: tunedStatefulHistoryThresholdConfig.thresholds,
    gateConfig: statefulHistoryModelGateConfig,
    validation: evaluateStatefulRouteReplays(
      proposalValidation.routeReplays,
      (event, route) => historyModels[route.historyLevel].predict(event.featureVector),
      tunedStatefulHistoryThresholdConfig.thresholds,
      statefulHistoryModelGateConfig
    ),
    test: evaluateStatefulRouteReplays(
      proposalTest.routeReplays,
      (event, route) => historyModels[route.historyLevel].predict(event.featureVector),
      tunedStatefulHistoryThresholdConfig.thresholds,
      statefulHistoryModelGateConfig
    ),
  };
  const aggressiveStatefulHistoryModelGateConfig = {
    immediateBuffer: {
      none: 0.08,
      light: 0.06,
      rich: 0.04,
      default: 0.06,
    },
    replacementMargin: {
      none: 0.04,
      light: 0.03,
      rich: 0.02,
      default: 0.03,
    },
    finalBuffer: {
      none: 0.02,
      light: 0.01,
      rich: 0.01,
      default: 0.01,
    },
  };
  const aggressiveStatefulHistoryThresholdConfig = tuneHistoryThresholdsWithEvaluator(
    proposalValidation.routeReplays,
    (event, route) => historyModels[route.historyLevel].predict(event.featureVector),
    evaluateStatefulRouteReplays,
    maxFalsePositiveRate,
    aggressiveStatefulHistoryModelGateConfig
  );
  const aggressiveStatefulHistoryModelDesign = {
    name: 'cohort_history_models_stateful_aggressive',
    family: 'realistic_cohort',
    thresholds: aggressiveStatefulHistoryThresholdConfig.thresholds,
    gateConfig: aggressiveStatefulHistoryModelGateConfig,
    validation: evaluateStatefulRouteReplays(
      proposalValidation.routeReplays,
      (event, route) => historyModels[route.historyLevel].predict(event.featureVector),
      aggressiveStatefulHistoryThresholdConfig.thresholds,
      aggressiveStatefulHistoryModelGateConfig
    ),
    test: evaluateStatefulRouteReplays(
      proposalTest.routeReplays,
      (event, route) => historyModels[route.historyLevel].predict(event.featureVector),
      aggressiveStatefulHistoryThresholdConfig.thresholds,
      aggressiveStatefulHistoryModelGateConfig
    ),
  };
  const statefulHistoryModelConfidenceBlendThresholdConfig = tuneHistoryThresholdsWithEvaluator(
    proposalValidation.routeReplays,
    historyModelConfidenceBlendScoreFn,
    evaluateStatefulRouteReplays,
    maxFalsePositiveRate,
    statefulHistoryModelGateConfig
  );
  const statefulHistoryModelConfidenceBlendDesign = {
    name: 'cohort_history_models_confidence_blend_stateful',
    family: 'realistic_cohort',
    thresholds: statefulHistoryModelConfidenceBlendThresholdConfig.thresholds,
    gateConfig: statefulHistoryModelGateConfig,
    validation: evaluateStatefulRouteReplays(
      proposalValidation.routeReplays,
      historyModelConfidenceBlendScoreFn,
      statefulHistoryModelConfidenceBlendThresholdConfig.thresholds,
      statefulHistoryModelGateConfig
    ),
    test: evaluateStatefulRouteReplays(
      proposalTest.routeReplays,
      historyModelConfidenceBlendScoreFn,
      statefulHistoryModelConfidenceBlendThresholdConfig.thresholds,
      statefulHistoryModelGateConfig
    ),
  };

  const decisionLogisticModel = trainSingleModel(decisionTrain.examples);
  const decisionHistoryModels = trainHistoryModels(decisionTrain.examples);
  const decisionHistoryDenseModels = trainHistoryDenseModels(decisionTrain.examples, [32, 16], {
    seed: 211,
    shuffleSeed: 307,
    epochs: 260,
    batchSize: 64,
    learningRate: 0.06,
    positiveWeight: 8.0,
  });
  const decisionStationExamples = decisionTrain.examples.filter(example => !example.isNoOffer);
  const decisionNoOfferExamples = decisionTrain.examples.filter(example => example.isNoOffer);
  const decisionOfferExamples = decisionTrain.decisionReplays.map(replay => {
    const noOfferCandidate = replay.candidates.find(candidate => candidate.isNoOffer);
    return {
      replayId: replay.replayId,
      historyLevel: replay.historyLevel,
      label: replay.expectsTrigger ? 1 : 0,
      features: noOfferCandidate?.features || [],
    };
  });
  const decisionPairwiseStationExamples = collectPairwiseStationExamples(decisionTrain.decisionReplays);
  const decisionStationHistoryModels = trainHistoryModels(decisionStationExamples);
  const decisionNoOfferHistoryModels = trainHistoryModels(decisionNoOfferExamples);
  const decisionStationDenseModels = trainHistoryDenseModels(decisionStationExamples, [32, 16], {
    seed: 401,
    shuffleSeed: 467,
    epochs: 260,
    batchSize: 64,
    learningRate: 0.05,
    positiveWeight: 9.5,
  });
  const decisionNoOfferDenseModels = trainHistoryDenseModels(decisionNoOfferExamples, [24, 12], {
    seed: 503,
    shuffleSeed: 557,
    epochs: 220,
    batchSize: 48,
    learningRate: 0.05,
    positiveWeight: 2.0,
    negativeWeight: 1.5,
  });
  const decisionOfferHistoryModels = trainHistoryModels(decisionOfferExamples);
  const decisionPairwiseStationModels = trainHistoryModels(decisionPairwiseStationExamples);
  const decisionPairwiseStationDenseModels = trainHistoryDenseModels(decisionPairwiseStationExamples, [48, 24], {
    seed: 619,
    shuffleSeed: 673,
    epochs: 280,
    batchSize: 64,
    learningRate: 0.05,
    positiveWeight: 7.5,
  });
  const decisionLogisticThresholdConfig = tuneDecisionRankerHistoryThresholds(
    decisionValidation.decisionReplays,
    candidate => decisionLogisticModel.predict(candidate.features),
    maxFalsePositiveRate
  );
  const decisionLogisticDesign = {
    name: 'cohort_decision_ranker_logistic',
    family: 'realistic_cohort',
    thresholds: decisionLogisticThresholdConfig.thresholds,
    margins: decisionLogisticThresholdConfig.margins,
    validation: evaluateDecisionPointReplays(
      decisionValidation.decisionReplays,
      candidate => decisionLogisticModel.predict(candidate.features),
      decisionLogisticThresholdConfig.thresholds,
      decisionLogisticThresholdConfig.margins
    ),
    test: evaluateDecisionPointReplays(
      decisionTest.decisionReplays,
      candidate => decisionLogisticModel.predict(candidate.features),
      decisionLogisticThresholdConfig.thresholds,
      decisionLogisticThresholdConfig.margins
    ),
  };
  const decisionHistoryThresholdConfig = tuneDecisionRankerHistoryThresholds(
    decisionValidation.decisionReplays,
    (candidate, replay) => decisionHistoryModels[replay.historyLevel].predict(candidate.features),
    maxFalsePositiveRate
  );
  const decisionHistoryDesign = {
    name: 'cohort_decision_ranker_history_models',
    family: 'realistic_cohort',
    thresholds: decisionHistoryThresholdConfig.thresholds,
    margins: decisionHistoryThresholdConfig.margins,
    validation: evaluateDecisionPointReplays(
      decisionValidation.decisionReplays,
      (candidate, replay) => decisionHistoryModels[replay.historyLevel].predict(candidate.features),
      decisionHistoryThresholdConfig.thresholds,
      decisionHistoryThresholdConfig.margins
    ),
    test: evaluateDecisionPointReplays(
      decisionTest.decisionReplays,
      (candidate, replay) => decisionHistoryModels[replay.historyLevel].predict(candidate.features),
      decisionHistoryThresholdConfig.thresholds,
      decisionHistoryThresholdConfig.margins
    ),
  };
  const decisionHistoryDenseThresholdConfig = tuneDecisionRankerHistoryThresholds(
    decisionValidation.decisionReplays,
    (candidate, replay) => decisionHistoryDenseModels[replay.historyLevel].predict(candidate.features),
    maxFalsePositiveRate
  );
  const decisionHistoryDenseDesign = {
    name: 'cohort_decision_ranker_history_dense',
    family: 'realistic_cohort',
    thresholds: decisionHistoryDenseThresholdConfig.thresholds,
    margins: decisionHistoryDenseThresholdConfig.margins,
    validation: evaluateDecisionPointReplays(
      decisionValidation.decisionReplays,
      (candidate, replay) => decisionHistoryDenseModels[replay.historyLevel].predict(candidate.features),
      decisionHistoryDenseThresholdConfig.thresholds,
      decisionHistoryDenseThresholdConfig.margins
    ),
    test: evaluateDecisionPointReplays(
      decisionTest.decisionReplays,
      (candidate, replay) => decisionHistoryDenseModels[replay.historyLevel].predict(candidate.features),
      decisionHistoryDenseThresholdConfig.thresholds,
      decisionHistoryDenseThresholdConfig.margins
    ),
  };
  const twoHeadDecisionThresholdConfig = tuneTwoHeadDecisionRankerThresholds(
    decisionValidation.decisionReplays,
    (candidate, replay) => decisionStationHistoryModels[replay.historyLevel].predict(candidate.features),
    (candidate, replay) => decisionNoOfferHistoryModels[replay.historyLevel].predict(candidate.features),
    maxFalsePositiveRate
  );
  const twoHeadDecisionDesign = {
    name: 'cohort_decision_ranker_two_head_history',
    family: 'realistic_cohort',
    thresholds: twoHeadDecisionThresholdConfig.thresholds,
    noOfferMargins: twoHeadDecisionThresholdConfig.noOfferMargins,
    stationMargins: twoHeadDecisionThresholdConfig.stationMargins,
    validation: evaluateTwoHeadDecisionPointReplays(
      decisionValidation.decisionReplays,
      (candidate, replay) => decisionStationHistoryModels[replay.historyLevel].predict(candidate.features),
      (candidate, replay) => decisionNoOfferHistoryModels[replay.historyLevel].predict(candidate.features),
      twoHeadDecisionThresholdConfig.thresholds,
      twoHeadDecisionThresholdConfig.noOfferMargins,
      twoHeadDecisionThresholdConfig.stationMargins
    ),
    test: evaluateTwoHeadDecisionPointReplays(
      decisionTest.decisionReplays,
      (candidate, replay) => decisionStationHistoryModels[replay.historyLevel].predict(candidate.features),
      (candidate, replay) => decisionNoOfferHistoryModels[replay.historyLevel].predict(candidate.features),
      twoHeadDecisionThresholdConfig.thresholds,
      twoHeadDecisionThresholdConfig.noOfferMargins,
      twoHeadDecisionThresholdConfig.stationMargins
    ),
  };
  const twoHeadDecisionDenseThresholdConfig = tuneTwoHeadDecisionRankerThresholds(
    decisionValidation.decisionReplays,
    (candidate, replay) => decisionStationDenseModels[replay.historyLevel].predict(candidate.features),
    (candidate, replay) => decisionNoOfferDenseModels[replay.historyLevel].predict(candidate.features),
    maxFalsePositiveRate
  );
  const twoHeadDecisionDenseDesign = {
    name: 'cohort_decision_ranker_two_head_dense',
    family: 'realistic_cohort',
    thresholds: twoHeadDecisionDenseThresholdConfig.thresholds,
    noOfferMargins: twoHeadDecisionDenseThresholdConfig.noOfferMargins,
    stationMargins: twoHeadDecisionDenseThresholdConfig.stationMargins,
    validation: evaluateTwoHeadDecisionPointReplays(
      decisionValidation.decisionReplays,
      (candidate, replay) => decisionStationDenseModels[replay.historyLevel].predict(candidate.features),
      (candidate, replay) => decisionNoOfferDenseModels[replay.historyLevel].predict(candidate.features),
      twoHeadDecisionDenseThresholdConfig.thresholds,
      twoHeadDecisionDenseThresholdConfig.noOfferMargins,
      twoHeadDecisionDenseThresholdConfig.stationMargins
    ),
    test: evaluateTwoHeadDecisionPointReplays(
      decisionTest.decisionReplays,
      (candidate, replay) => decisionStationDenseModels[replay.historyLevel].predict(candidate.features),
      (candidate, replay) => decisionNoOfferDenseModels[replay.historyLevel].predict(candidate.features),
      twoHeadDecisionDenseThresholdConfig.thresholds,
      twoHeadDecisionDenseThresholdConfig.noOfferMargins,
      twoHeadDecisionDenseThresholdConfig.stationMargins
    ),
  };
  const offerStationThresholdConfig = tuneOfferStationDecisionThresholds(
    decisionValidation.decisionReplays,
    (candidate, replay) => decisionOfferHistoryModels[replay.historyLevel].predict(candidate.features),
    createPairwiseStationScoreFn(decisionPairwiseStationModels),
    maxFalsePositiveRate
  );
  const offerStationDesign = {
    name: 'cohort_decision_ranker_offer_station_history',
    family: 'realistic_cohort',
    offerThresholds: offerStationThresholdConfig.offerThresholds,
    stationThresholds: offerStationThresholdConfig.stationThresholds,
    stationMargins: offerStationThresholdConfig.stationMargins,
    validation: evaluateOfferStationDecisionReplays(
      decisionValidation.decisionReplays,
      (candidate, replay) => decisionOfferHistoryModels[replay.historyLevel].predict(candidate.features),
      createPairwiseStationScoreFn(decisionPairwiseStationModels),
      offerStationThresholdConfig.offerThresholds,
      offerStationThresholdConfig.stationThresholds,
      offerStationThresholdConfig.stationMargins
    ),
    test: evaluateOfferStationDecisionReplays(
      decisionTest.decisionReplays,
      (candidate, replay) => decisionOfferHistoryModels[replay.historyLevel].predict(candidate.features),
      createPairwiseStationScoreFn(decisionPairwiseStationModels),
      offerStationThresholdConfig.offerThresholds,
      offerStationThresholdConfig.stationThresholds,
      offerStationThresholdConfig.stationMargins
    ),
  };
  const offerStationDenseThresholdConfig = tuneOfferStationDecisionThresholds(
    decisionValidation.decisionReplays,
    (candidate, replay) => decisionOfferHistoryModels[replay.historyLevel].predict(candidate.features),
    createPairwiseStationScoreFn(decisionPairwiseStationDenseModels),
    maxFalsePositiveRate
  );
  const offerStationDenseDesign = {
    name: 'cohort_decision_ranker_offer_station_dense_pairwise',
    family: 'realistic_cohort',
    offerThresholds: offerStationDenseThresholdConfig.offerThresholds,
    stationThresholds: offerStationDenseThresholdConfig.stationThresholds,
    stationMargins: offerStationDenseThresholdConfig.stationMargins,
    validation: evaluateOfferStationDecisionReplays(
      decisionValidation.decisionReplays,
      (candidate, replay) => decisionOfferHistoryModels[replay.historyLevel].predict(candidate.features),
      createPairwiseStationScoreFn(decisionPairwiseStationDenseModels),
      offerStationDenseThresholdConfig.offerThresholds,
      offerStationDenseThresholdConfig.stationThresholds,
      offerStationDenseThresholdConfig.stationMargins
    ),
    test: evaluateOfferStationDecisionReplays(
      decisionTest.decisionReplays,
      (candidate, replay) => decisionOfferHistoryModels[replay.historyLevel].predict(candidate.features),
      createPairwiseStationScoreFn(decisionPairwiseStationDenseModels),
      offerStationDenseThresholdConfig.offerThresholds,
      offerStationDenseThresholdConfig.stationThresholds,
      offerStationDenseThresholdConfig.stationMargins
    ),
  };
  const offerStationUtilityThresholdConfig = tuneOfferStationDecisionThresholds(
    decisionValidation.decisionReplays,
    (candidate, replay) => decisionOfferHistoryModels[replay.historyLevel].predict(candidate.features),
    (candidate, replay) => computeObservedDecisionStationUtility(candidate.candidate || candidate, replay),
    maxFalsePositiveRate
  );
  const offerStationUtilityDesign = {
    name: 'cohort_decision_ranker_offer_station_utility',
    family: 'realistic_cohort',
    offerThresholds: offerStationUtilityThresholdConfig.offerThresholds,
    stationThresholds: offerStationUtilityThresholdConfig.stationThresholds,
    stationMargins: offerStationUtilityThresholdConfig.stationMargins,
    validation: evaluateOfferStationDecisionReplays(
      decisionValidation.decisionReplays,
      (candidate, replay) => decisionOfferHistoryModels[replay.historyLevel].predict(candidate.features),
      (candidate, replay) => computeObservedDecisionStationUtility(candidate.candidate || candidate, replay),
      offerStationUtilityThresholdConfig.offerThresholds,
      offerStationUtilityThresholdConfig.stationThresholds,
      offerStationUtilityThresholdConfig.stationMargins
    ),
    test: evaluateOfferStationDecisionReplays(
      decisionTest.decisionReplays,
      (candidate, replay) => decisionOfferHistoryModels[replay.historyLevel].predict(candidate.features),
      (candidate, replay) => computeObservedDecisionStationUtility(candidate.candidate || candidate, replay),
      offerStationUtilityThresholdConfig.offerThresholds,
      offerStationUtilityThresholdConfig.stationThresholds,
      offerStationUtilityThresholdConfig.stationMargins
    ),
  };

  const designs = [
    logisticDesign,
    logisticHistoryThresholdDesign,
    recoveryDesign,
    recoveryHistoryThresholdDesign,
    sequenceDesign,
    sequenceHistoryThresholdDesign,
    recoverySequenceBlendDesign,
    historyModelDesign,
    denseHistoryModelDesign,
    denseHistoryModelConfidenceBlendDesign,
    selectiveHistoryLiftDesign,
    historyModelConfidenceBlendDesign,
    proposalNativeRerankerDesign,
    proposalNativeDenseRerankerDesign,
    statefulHistoryModelDesign,
    aggressiveStatefulHistoryModelDesign,
    selectiveHistoryLiftStatefulDesign,
    statefulHistoryModelConfidenceBlendDesign,
    decisionLogisticDesign,
    decisionHistoryDesign,
    decisionHistoryDenseDesign,
    twoHeadDecisionDesign,
    twoHeadDecisionDenseDesign,
    offerStationDesign,
    offerStationDenseDesign,
    offerStationUtilityDesign,
  ];
  const bestDesign = [...designs]
    .filter(design => design.test.scorecard.falsePositiveRate <= maxFalsePositiveRate)
    .sort((left, right) => compareScorecards(right.test.scorecard, left.test.scorecard))[0] || null;

  return {
    datasets: {
      train: {
        seedCount: trainSeeds.length,
        driverCount,
        routesPerDriver,
        replayCount: proposalTrain.routeReplays.length,
        exampleCount: proposalTrain.examples.length,
        snapshotReplayCount: proposalSnapshotTrain.eventReplays.length,
        snapshotPairwiseExampleCount: proposalSnapshotTrain.pairwiseExamples.length,
        decisionReplayCount: decisionTrain.decisionReplays.length,
        decisionExampleCount: decisionTrain.examples.length,
      },
      validation: {
        seedCount: validationSeeds.length,
        replayCount: proposalValidation.routeReplays.length,
        exampleCount: proposalValidation.examples.length,
        snapshotReplayCount: proposalSnapshotValidation.eventReplays.length,
        snapshotPairwiseExampleCount: proposalSnapshotValidation.pairwiseExamples.length,
        decisionReplayCount: decisionValidation.decisionReplays.length,
        decisionExampleCount: decisionValidation.examples.length,
      },
      test: {
        seedCount: testSeeds.length,
        replayCount: proposalTest.routeReplays.length,
        exampleCount: proposalTest.examples.length,
        snapshotReplayCount: proposalSnapshotTest.eventReplays.length,
        snapshotPairwiseExampleCount: proposalSnapshotTest.pairwiseExamples.length,
        decisionReplayCount: decisionTest.decisionReplays.length,
        decisionExampleCount: decisionTest.examples.length,
      },
    },
    designs,
    bestDesign,
  };
}

function runPrimaryMlOptimizationExperiment(options = {}) {
  return runRealisticMlCohortExperiment(options);
}

function serializeNativeRerankerEventReplay(replay, gateScoreFn) {
  return {
    replayId: replay.replayId,
    routeReplayId: replay.routeReplayId,
    routeId: replay.routeId,
    historyLevel: replay.historyLevel,
    expectsTrigger: replay.expectsTrigger,
    targetStationId: replay.targetStationId,
    eventIndex: replay.eventIndex,
    gateScore: gateScoreFn(replay.event, replay.route),
    triggerDistance: replay.event?.triggerDistance ?? replay.event?.forwardDistance ?? null,
    candidates: replay.candidates.map(candidate => ({
      stationId: candidate.stationId,
      features: Array.isArray(candidate.features) ? candidate.features : [],
    })),
  };
}

function buildRealisticNativeRerankerGpuDataset({
  trainSeeds = [7101, 7102, 7103, 7104],
  validationSeeds = [7201, 7202],
  testSeeds = [7301],
  historyLevels = DEFAULT_HISTORY_LEVELS,
  driverCount = 4,
  routesPerDriver = 18,
  freezeVisitHistory = false,
  maxFalsePositiveRate = 5,
} = {}) {
  const simulationOptions = {
    driverCount,
    routesPerDriver,
    freezeVisitHistory,
  };
  const proposalTrain = collectRouteReplays({
    seeds: trainSeeds,
    routeCount: routesPerDriver,
    historyLevels,
    engineOptions: REALISTIC_PROPOSAL_ENGINE_OPTIONS,
    simulationFn: simulateRealisticCohortBatch,
    simulationOptions,
    collectDecisionSnapshots: true,
  });
  const proposalValidation = collectRouteReplays({
    seeds: validationSeeds,
    routeCount: routesPerDriver,
    historyLevels,
    engineOptions: REALISTIC_PROPOSAL_ENGINE_OPTIONS,
    simulationFn: simulateRealisticCohortBatch,
    simulationOptions,
    collectDecisionSnapshots: true,
  });
  const proposalTest = collectRouteReplays({
    seeds: testSeeds,
    routeCount: routesPerDriver,
    historyLevels,
    engineOptions: REALISTIC_PROPOSAL_ENGINE_OPTIONS,
    simulationFn: simulateRealisticCohortBatch,
    simulationOptions,
    collectDecisionSnapshots: true,
  });

  const snapshotTrain = collectProposalSnapshotRerankReplays(proposalTrain.routeReplays);
  const triggeredSnapshotValidation = collectTriggeredProposalSnapshotReplays(proposalValidation.routeReplays);
  const triggeredSnapshotTest = collectTriggeredProposalSnapshotReplays(proposalTest.routeReplays);

  const historyModels = trainHistoryModels(proposalTrain.examples);
  const historyModelConfidenceBlendScoreFn = (event, route) => clamp(
    (historyModels[route.historyLevel].predict(event.featureVector) * 0.78) +
    ((Number(event.confidence) || 0) * 0.22),
    0,
    1
  );
  const historyModelConfidenceBlendThresholdConfig = tuneHistoryThresholds(
    proposalValidation.routeReplays,
    historyModelConfidenceBlendScoreFn,
    maxFalsePositiveRate
  );

  return {
    metadata: {
      benchmark: 'realistic_native_reranker_gpu',
      gateDesign: 'cohort_history_models_confidence_blend',
      maxFalsePositiveRate,
      featureSize: Array.isArray(snapshotTrain.pairwiseExamples?.[0]?.features)
        ? snapshotTrain.pairwiseExamples[0].features.length
        : 0,
      pairwiseFeatureSize: Array.isArray(snapshotTrain.pairwiseExamples?.[0]?.features)
        ? snapshotTrain.pairwiseExamples[0].features.length
        : 0,
      stationFeatureSize: Array.isArray(snapshotTrain.eventReplays?.[0]?.candidates?.[0]?.features)
        ? snapshotTrain.eventReplays[0].candidates[0].features.length
        : 0,
      gateThresholds: historyModelConfidenceBlendThresholdConfig.thresholds,
      historyLevels,
      driverCount,
      routesPerDriver,
      seedCounts: {
        train: trainSeeds.length,
        validation: validationSeeds.length,
        test: testSeeds.length,
      },
    },
    train: {
      pairwiseExamples: snapshotTrain.pairwiseExamples.map(example => ({
        replayId: example.replayId,
        historyLevel: example.historyLevel,
        label: example.label,
        features: example.features,
      })),
      eventReplayCount: snapshotTrain.eventReplays.length,
    },
    validation: {
      eventReplays: triggeredSnapshotValidation.eventReplays.map(replay =>
        serializeNativeRerankerEventReplay(replay, historyModelConfidenceBlendScoreFn)
      ),
    },
    test: {
      eventReplays: triggeredSnapshotTest.eventReplays.map(replay =>
        serializeNativeRerankerEventReplay(replay, historyModelConfidenceBlendScoreFn)
      ),
    },
  };
}

function runFocusedRealisticNativeRerankerComparison({
  trainSeeds = [7101],
  validationSeeds = [7201],
  testSeeds = [7301],
  historyLevels = DEFAULT_HISTORY_LEVELS,
  driverCount = 4,
  routesPerDriver = 18,
  freezeVisitHistory = false,
  maxFalsePositiveRate = 5,
} = {}) {
  const simulationOptions = {
    driverCount,
    routesPerDriver,
    freezeVisitHistory,
  };
  const proposalTrain = collectRouteReplays({
    seeds: trainSeeds,
    routeCount: routesPerDriver,
    historyLevels,
    engineOptions: REALISTIC_PROPOSAL_ENGINE_OPTIONS,
    simulationFn: simulateRealisticCohortBatch,
    simulationOptions,
    collectDecisionSnapshots: true,
  });
  const proposalValidation = collectRouteReplays({
    seeds: validationSeeds,
    routeCount: routesPerDriver,
    historyLevels,
    engineOptions: REALISTIC_PROPOSAL_ENGINE_OPTIONS,
    simulationFn: simulateRealisticCohortBatch,
    simulationOptions,
    collectDecisionSnapshots: true,
  });
  const proposalTest = collectRouteReplays({
    seeds: testSeeds,
    routeCount: routesPerDriver,
    historyLevels,
    engineOptions: REALISTIC_PROPOSAL_ENGINE_OPTIONS,
    simulationFn: simulateRealisticCohortBatch,
    simulationOptions,
    collectDecisionSnapshots: true,
  });

  const snapshotTrain = collectProposalSnapshotRerankReplays(proposalTrain.routeReplays);
  const triggeredSnapshotValidation = collectTriggeredProposalSnapshotReplays(proposalValidation.routeReplays);
  const triggeredSnapshotTest = collectTriggeredProposalSnapshotReplays(proposalTest.routeReplays);
  const triggeredValidationIndex = buildProposalSnapshotReplayIndex(triggeredSnapshotValidation.eventReplays);
  const triggeredTestIndex = buildProposalSnapshotReplayIndex(triggeredSnapshotTest.eventReplays);

  const historyModels = trainHistoryModels(proposalTrain.examples);
  const historyModelConfidenceBlendScoreFn = (event, route) => clamp(
    (historyModels[route.historyLevel].predict(event.featureVector) * 0.78) +
    ((Number(event.confidence) || 0) * 0.22),
    0,
    1
  );
  const historyModelConfidenceBlendThresholdConfig = tuneHistoryThresholds(
    proposalValidation.routeReplays,
    historyModelConfidenceBlendScoreFn,
    maxFalsePositiveRate
  );
  const baseline = {
    name: 'cohort_history_models_confidence_blend',
    scorecard: evaluateRouteReplays(
      proposalTest.routeReplays,
      historyModelConfidenceBlendScoreFn,
      historyModelConfidenceBlendThresholdConfig.thresholds
    ).scorecard,
  };

  const snapshotPairwiseExamples = snapshotTrain.pairwiseExamples;
  if (!snapshotPairwiseExamples.length) {
    return {
      datasets: {
        trainPairwiseExampleCount: 0,
        validationTriggerReplayCount: triggeredSnapshotValidation.eventReplays.length,
        testTriggerReplayCount: triggeredSnapshotTest.eventReplays.length,
      },
      designs: [baseline],
      bestDesign: baseline,
    };
  }

  const nativeModels = trainHistoryModels(snapshotPairwiseExamples);
  const nativeDenseModels = trainHistoryDenseModels(snapshotPairwiseExamples, [48, 24], {
    seed: 809,
    shuffleSeed: 877,
    epochs: 260,
    batchSize: 64,
    learningRate: 0.05,
    positiveWeight: 8.5,
  });
  const nativeScoreFn = createPairwiseStationScoreFn(nativeModels);
  const nativeDenseScoreFn = createPairwiseStationScoreFn(nativeDenseModels);
  const nativeThresholds = tuneStationRerankerThresholds(
    proposalValidation.routeReplays,
    historyModelConfidenceBlendScoreFn,
    historyModelConfidenceBlendThresholdConfig.thresholds,
    triggeredValidationIndex,
    nativeScoreFn,
    maxFalsePositiveRate
  );
  const nativeDenseThresholds = tuneStationRerankerThresholds(
    proposalValidation.routeReplays,
    historyModelConfidenceBlendScoreFn,
    historyModelConfidenceBlendThresholdConfig.thresholds,
    triggeredValidationIndex,
    nativeDenseScoreFn,
    maxFalsePositiveRate
  );
  const native = {
    name: 'cohort_history_models_confidence_blend_native_reranker',
    scorecard: evaluateRouteReplaysWithStationReranker(
      proposalTest.routeReplays,
      historyModelConfidenceBlendScoreFn,
      historyModelConfidenceBlendThresholdConfig.thresholds,
      triggeredTestIndex,
      nativeScoreFn,
      {
        stationThreshold: nativeThresholds.stationThresholds,
        stationMargin: nativeThresholds.stationMargins,
      }
    ).scorecard,
  };
  const nativeDense = {
    name: 'cohort_history_models_confidence_blend_native_reranker_dense',
    scorecard: evaluateRouteReplaysWithStationReranker(
      proposalTest.routeReplays,
      historyModelConfidenceBlendScoreFn,
      historyModelConfidenceBlendThresholdConfig.thresholds,
      triggeredTestIndex,
      nativeDenseScoreFn,
      {
        stationThreshold: nativeDenseThresholds.stationThresholds,
        stationMargin: nativeDenseThresholds.stationMargins,
      }
    ).scorecard,
  };
  const designs = [baseline, native, nativeDense];
  const bestDesign = [...designs].sort((left, right) => compareScorecards(right.scorecard, left.scorecard))[0];
  return {
    datasets: {
      trainPairwiseExampleCount: snapshotPairwiseExamples.length,
      validationTriggerReplayCount: triggeredSnapshotValidation.eventReplays.length,
      testTriggerReplayCount: triggeredSnapshotTest.eventReplays.length,
    },
    designs,
    bestDesign,
  };
}

module.exports = {
  PROPOSAL_ENGINE_OPTIONS,
  PRIMARY_ML_OPTIMIZATION_BENCHMARK,
  GATE_FEATURE_SIZE,
  SEQUENCE_FEATURE_SIZE,
  buildMlGateFeatureVector,
  buildSequenceFeatureVector,
  createLogisticGate,
  createDenseBinaryClassifier,
  runMlAugmentedFlowDesigns,
  runScaledMlCapacityExperiment,
  runRealisticMlCohortExperiment,
  runPrimaryMlOptimizationExperiment,
  buildRealisticNativeRerankerGpuDataset,
  runFocusedRealisticNativeRerankerComparison,
};
