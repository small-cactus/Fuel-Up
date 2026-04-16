/**
 * Predictive fueling recommender.
 *
 * The base `predictiveFuelingEngine` answers "is the driver approaching this
 * station *now*?" using physical signals. That's a fine late-confirmation
 * mechanism, but it fires too late to actually change behavior — by the time
 * a driver is 500m from their usual Shell they've already committed.
 *
 * This recommender sits one level up. Given:
 *   - the live GPS window (same format as the engine)
 *   - the user's fueling profile (visit history, fill-up history, preferences)
 *   - the station list with prices
 *   - an optional urgency score (from rangeEstimator)
 *
 * it tries to answer a different question:
 *   "Is this driver going to fuel soon, and if so, is there a *cheaper*
 *    station ahead on their projected path than the one they would normally
 *    default to?"
 *
 * The trigger fires FAR BEFORE the driver is near their usual station —
 * sometimes 5+ km out — because the decision about where to stop is made
 * when the trip starts, not when the driver is already pulling in.
 *
 * Inputs used (all available IRL to a backgrounded app with permissions):
 *   - GPS window (lat, lon, speed, heading, accuracy, timestamp)
 *   - User profile (visitHistory with timestamps, fillUpHistory)
 *   - Station list with prices and coordinates
 *   - Range estimator urgency
 *   - Local wall-clock time (for time-of-day pattern matching)
 *
 * The recommender does NOT use ground-truth destinations, route labels, or
 * any "future" data. Every feature is computable from the sample-up-to-now
 * window + persisted user state.
 */

const { haversineDistanceMeters, calculateHeadingDegrees } = require('../screens/onboarding/predictive/simulationMath.cjs');
const {
  computeHistoryScore,
  computeContextualHistoryScore,
  computeHistoryContextMatch,
  computeVisitShare,
  computeProfileHistoryConcentration,
  computeObservedConversionRate,
  computeContextualObservedConversionRate,
  computeExposureContextMatch,
  computeObservedSkipScore,
  computeTimePatternScore,
} = require('./userFuelingProfile.js');
const { estimateRange, estimateFuelState } = require('./rangeEstimator.js');
const { scoreStation } = require('./predictiveFuelingEngine.js');

const DEFAULT_OPTIONS = {
  // Window requirements: need at least this many samples to compute heading.
  minWindowSize: 5,
  // Base forward projection distance. The effective lookahead grows with
  // speed so highway runs can see the better station beyond the next exit.
  projectionDistanceMeters: 10000,
  maxProjectionDistanceMeters: 18000,
  projectionLookaheadSeconds: 240,
  // Corridor half-width — stations within this perpendicular distance from
  // the projected heading line count as "on the path".
  corridorHalfWidthMeters: 350,
  // Minimum station-ahead distance to consider a recommendation (so we don't
  // recommend stations literally at the current location).
  minAheadDistanceMeters: 1200,
  // Hard gate: this recommender exists to fire early, not once the user is
  // already committing to the driveway.
  minTriggerDistanceMeters: 1500,
  // Minimum urgency required to fire a trigger by default.
  minUrgency: 0.20,
  // Minimum price savings (USD/gal) to recommend a cheaper alternative over
  // the user's default pick. Below this, no trigger — the difference isn't
  // worth the notification.
  minPriceSavingsPerGal: 0.08,
  // Cooldown — don't notify the same user about the same station within this
  // window. Prevents spam if they're driving in a circle.
  cooldownMs: 10 * 60 * 1000, // 10 min
  // Trigger threshold for composite recommendation score.
  triggerThreshold: 0.55,
  // Speed below which we treat samples as "stopped" and skip trajectory
  // projection (no meaningful heading).
  stoppedSpeedMps: 1.0,
  // Maximum forward speed that counts as "active driving". Samples outside
  // this are ignored for corridor projection (idle, walking, etc).
  maxDrivingSpeedMps: 45,
  // Whether to require a prior visit history pattern match for "urgent only"
  // users. If false, will trigger on pure trajectory+urgency.
  requireHistoryWhenNotUrgent: true,
  // Minimum urgency at which trajectory-only prediction (no history) fires.
  // Below this, we require at least some history or time pattern.
  urgencyOnlyThreshold: 0.72,
  // Cold-start confidence threshold for first-time-user prediction.
  coldStartThreshold: 0.34,
  coldStartLeadMargin: 0.04,
  highwayMeanSpeedMps: 20,
  highwayMinSpeedMps: 14,
  leftTurnPenaltyOffPeak: 0.06,
  leftTurnPenaltyPeak: 0.15,
  nearLeftTurnPenaltyPeak: 0.06,
  medianCrossPenaltyPeak: 0.10,
  highwayExitPenalty: 0.04,
  uTurnLikePenaltyPeak: 0.22,
  accessBonusRightSide: 0.02,
  glanceStopSpeedMps: 1.2,
  gridlockMeanSpeedMps: 4.0,
  gridlockTransitionThresholdMps: 2.2,
  gridlockMinTransitions: 3,
  straightHeadingDeltaDegrees: 10,
  complexHeadingDeltaDegrees: 24,
  minTripAwarenessSeconds: 90,
  preferredTripAwarenessSeconds: 180,
  minSurfaceLeadSeconds: 60,
  preferredSurfaceLeadSeconds: 180,
  maxRecentAttentionSamples: 7,
  minTripFuelIntentColdStart: 0.22,
  minTripFuelIntentWithHistory: 0.32,
  maxSpeculativeDistanceMeters: 6500,
  strongSpeculativeDistanceMeters: 4500,
  minColdStartBranchTripFuelIntent: 0.54,
  minColdStartBranchTripFuelIntentHighway: 0.62,
  minColdStartBranchLead: 0.12,
  minColdStartBranchValueEdge: 0.18,
  lowSpecificityColdStartMaxDistanceMeters: 7000,
  lowSpecificityColdStartIntentBuffer: 0.12,
  lowSpecificityColdStartMinIntentEvidence: 0.46,
  lowSpecificityColdStartMinConfidence: 0.52,
  lowSpecificityColdStartBrandValueFloor: 0.72,
  weakPatternHistoryMaxDistanceMeters: 6500,
  weakPatternHistoryIntentBuffer: 0.12,
  weakPatternHistoryMinIntentEvidence: 0.48,
  enableHistoryRecoveryProposals: false,
  historyRecoveryMinHistoryStrength: 0.32,
  historyRecoveryMinProbability: 0.22,
  historyRecoveryMinIntentEvidence: 0.30,
  historyRecoveryMinValueScore: 0.44,
  historyRecoveryMinPathScore: 0.72,
  historyRecoveryMinFuelNeed: 0.40,
  historyRecoveryMinHighwayFuelNeed: 0.45,
  historyRecoveryTripIntentBuffer: 0.12,
  historyRecoveryCityMaxDistanceMeters: 4800,
  historyRecoveryHighwayMaxDistanceMeters: 9000,
  historyRecoveryMinConfidence: 0.36,
  fuelNeedHighThreshold: 0.60,
  fuelNeedMediumThreshold: 0.54,
  lowSpecificityFuelNeedBuffer: 0.10,
  singleCandidateTurnInMaxDistanceMeters: 3600,
  singleCandidateTurnInMinPhysicalIntent: 0.70,
  singleCandidateTurnInMinCapture: 0.30,
  singleCandidateTurnInMinConfidence: 0.52,
  turnInCommitmentMaxDistanceMeters: 2600,
  turnInCommitmentMaxCrossTrackMeters: 90,
  turnInCommitmentMinScore: 0.70,
  turnInCommitmentMinPhysicalIntent: 0.80,
  turnInCommitmentMinApproach: 0.95,
  turnInCommitmentMinPath: 0.90,
  turnInCommitmentMinDominance: 0.14,
  turnInCommitmentMinCapture: 0.72,
  turnInCommitmentMinDecel: 0.88,
  turnInCommitmentMinFuelNeed: 0.30,
  turnInCommitmentHistoryAssistFuelNeed: 0.18,
  turnInCommitmentMinHistoryStrength: 0.45,
  turnInCommitmentMinValueScoreCity: 0.82,
  turnInCommitmentMinValueScoreHighway: 0.65,
  minStableRecommendationCount: 4,
  minStableRecommendationCountWithHistory: 3,
  minStableRecommendationCountCommitment: 2,
  minStableRecommendationCountUrgent: 1,
};

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function clamp(x, min, max) {
  return Math.max(min, Math.min(max, x));
}

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function circularDeltaDegrees(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  const delta = Math.abs(a - b) % 360;
  return delta > 180 ? 360 - delta : delta;
}

function sampleHeadingDegrees(previousSample, sample) {
  if (Number.isFinite(Number(sample?.heading))) {
    return Number(sample.heading);
  }
  if (!previousSample) {
    return null;
  }
  return calculateHeadingDegrees(
    { latitude: previousSample.latitude, longitude: previousSample.longitude },
    { latitude: sample.latitude, longitude: sample.longitude }
  );
}

function computeMeanSpeed(window) {
  return mean(
    (window || [])
      .map(sample => Number(sample?.speed))
      .filter(speed => Number.isFinite(speed) && speed >= 0)
  );
}

function computeTripDurationMs(window) {
  if (!Array.isArray(window) || window.length < 2) return 0;
  const firstTimestamp = Number(window[0]?.timestamp) || 0;
  const lastTimestamp = Number(window[window.length - 1]?.timestamp) || 0;
  return Math.max(0, lastTimestamp - firstTimestamp);
}

function countStopGoTransitions(window, thresholdMps) {
  let transitions = 0;
  let previousBucket = null;
  for (const sample of window || []) {
    const speed = Number(sample?.speed) || 0;
    const bucket = speed <= thresholdMps ? 'slow' : 'moving';
    if (previousBucket && bucket !== previousBucket) {
      transitions += 1;
    }
    previousBucket = bucket;
  }
  return transitions;
}

function computeRoadComplexity(window, opts) {
  const headings = [];
  for (let index = 1; index < (window || []).length; index += 1) {
    const previousSample = window[index - 1];
    const currentSample = window[index];
    const minSpeed = Math.min(
      Number(previousSample?.speed) || 0,
      Number(currentSample?.speed) || 0
    );
    const displacementMeters = haversineDistanceMeters(
      { latitude: previousSample.latitude, longitude: previousSample.longitude },
      { latitude: currentSample.latitude, longitude: currentSample.longitude }
    );
    if (minSpeed <= opts.glanceStopSpeedMps || displacementMeters < 8) {
      continue;
    }
    const heading = sampleHeadingDegrees(previousSample, currentSample);
    if (Number.isFinite(heading)) {
      headings.push(heading);
    }
  }
  const headingDeltas = [];
  for (let index = 1; index < headings.length; index += 1) {
    headingDeltas.push(circularDeltaDegrees(headings[index - 1], headings[index]));
  }
  const meanHeadingDelta = mean(headingDeltas);
  const stopGoTransitions = countStopGoTransitions(window, opts.gridlockTransitionThresholdMps);
  const meanSpeed = computeMeanSpeed(window);
  const speedSamples = (window || [])
    .map(sample => Number(sample?.speed))
    .filter(speed => Number.isFinite(speed) && speed >= 0);
  const speedVariance = speedSamples.length
    ? mean(speedSamples.map(speed => (speed - meanSpeed) ** 2))
    : 0;

  return {
    meanHeadingDelta,
    stopGoTransitions,
    meanSpeed,
    speedVariance,
    straightRoad: meanHeadingDelta <= opts.straightHeadingDeltaDegrees,
    complexRoad: meanHeadingDelta >= opts.complexHeadingDeltaDegrees,
    gridlock: meanSpeed <= opts.gridlockMeanSpeedMps && stopGoTransitions >= opts.gridlockMinTransitions,
  };
}

function inferTrafficPause(window, opts) {
  const recent = (window || []).slice(-opts.maxRecentAttentionSamples);
  const eventType = recent
    .map(sample => String(sample?.eventType || '').toLowerCase())
    .find(Boolean);
  const currentSpeed = Number(recent[recent.length - 1]?.speed) || 0;
  const stoppedSamples = recent.filter(sample => (Number(sample?.speed) || 0) <= opts.glanceStopSpeedMps).length;
  const movingSamples = recent.filter(sample => (Number(sample?.speed) || 0) > opts.glanceStopSpeedMps).length;
  const recentMovementBeforeStop = recent
    .slice(0, -2)
    .filter(sample => (Number(sample?.speed) || 0) > Math.max(opts.glanceStopSpeedMps, 3))
    .length;
  const likelyTrafficPause = (
    currentSpeed <= opts.glanceStopSpeedMps &&
    stoppedSamples >= 2 &&
    recentMovementBeforeStop >= 2
  );

  return {
    currentSpeed,
    stoppedSamples,
    movingSamples,
    eventType,
    likelyTrafficPause,
    stopLightLike: eventType === 'traffic_light' || likelyTrafficPause,
    stopSignLike: eventType === 'stop_sign',
  };
}

function buildPresentationPlan(window, recommendation, candidate, opts) {
  if (!recommendation) {
    return null;
  }
  const tripDurationMs = computeTripDurationMs(window);
  const tripDurationSeconds = tripDurationMs / 1000;
  const recentWindow = (window || []).slice(-opts.maxRecentAttentionSamples);
  const complexity = computeRoadComplexity(recentWindow, opts);
  const trafficPause = inferTrafficPause(recentWindow, opts);
  const currentSpeedMps = trafficPause.currentSpeed;
  const timeToStationSeconds = (currentSpeedMps > 0.5 && Number.isFinite(Number(recommendation.forwardDistance)))
    ? Number(recommendation.forwardDistance) / currentSpeedMps
    : Number.POSITIVE_INFINITY;
  const upcomingDirections = Array.isArray(candidate?.station?.routeApproach?.nextStepDirections)
    ? candidate.station.routeApproach.nextStepDirections
    : [];
  const hardUpcomingManeuver = upcomingDirections.some(direction => (
    direction === 'left' ||
    direction === 'u-turn' ||
    direction === 'roundabout'
  ));
  const stopOpportunityScore = trafficPause.stopLightLike
    ? 1
    : (trafficPause.stopSignLike ? 0.82 : 0);
  const lowDemandCruise = (
    complexity.straightRoad &&
    !complexity.gridlock &&
    !hardUpcomingManeuver &&
    currentSpeedMps >= 9 &&
    currentSpeedMps <= 31
  );
  const tripReadinessScore = smoothstep(
    opts.minTripAwarenessSeconds,
    opts.preferredTripAwarenessSeconds,
    tripDurationSeconds
  );
  const leadScore = Number.isFinite(timeToStationSeconds)
    ? smoothstep(opts.minSurfaceLeadSeconds, opts.preferredSurfaceLeadSeconds, timeToStationSeconds)
    : 1;
  const noticeabilityScore = clamp(
    (tripReadinessScore * 0.30) +
    (stopOpportunityScore * 0.34) +
    ((lowDemandCruise ? 1 : 0) * 0.18) +
    (leadScore * 0.18) -
    ((complexity.gridlock ? 1 : 0) * 0.22) -
    ((hardUpcomingManeuver ? 1 : 0) * 0.20) -
    ((complexity.complexRoad ? 1 : 0) * 0.14),
    0,
    1
  );

  let attentionState = 'high_demand_drive';
  if (trafficPause.stopLightLike) {
    attentionState = 'traffic_light_pause';
  } else if (trafficPause.stopSignLike) {
    attentionState = 'stop_sign_pause';
  } else if (complexity.gridlock) {
    attentionState = 'gridlock';
  } else if (lowDemandCruise) {
    attentionState = 'straight_road_glanceable';
  } else if (complexity.complexRoad || hardUpcomingManeuver) {
    attentionState = 'complex_maneuver';
  }

  const surfaceNow = (
    tripDurationSeconds >= opts.minTripAwarenessSeconds &&
    (
      (
        stopOpportunityScore >= 0.82 &&
        noticeabilityScore >= 0.5
      ) ||
      (
        lowDemandCruise &&
        tripDurationSeconds >= opts.preferredTripAwarenessSeconds &&
        noticeabilityScore >= 0.62
      )
    ) &&
    (
      !Number.isFinite(timeToStationSeconds) ||
      timeToStationSeconds >= opts.minSurfaceLeadSeconds
    )
  );

  return {
    surfaceNow,
    preferredSurface: surfaceNow ? 'live_activity' : 'defer',
    attentionState,
    reason: surfaceNow
      ? (trafficPause.stopLightLike || trafficPause.stopSignLike
        ? 'pause_window'
        : 'straight_road_window')
      : (
        complexity.gridlock ? 'gridlock_attention' :
        hardUpcomingManeuver ? 'upcoming_maneuver' :
        tripDurationSeconds < opts.minTripAwarenessSeconds ? 'trip_too_short' :
        'await_better_glance_window'
      ),
    noticeabilityScore,
    tripDurationSeconds,
    timeToStationSeconds: Number.isFinite(timeToStationSeconds) ? timeToStationSeconds : null,
    roadComplexity: {
      meanHeadingDelta: complexity.meanHeadingDelta,
      stopGoTransitions: complexity.stopGoTransitions,
      meanSpeed: complexity.meanSpeed,
      straightRoad: complexity.straightRoad,
      complexRoad: complexity.complexRoad,
      gridlock: complexity.gridlock,
      hardUpcomingManeuver,
    },
  };
}

function detectHighwayCruise(window, opts) {
  const speeds = (window || [])
    .map(sample => Number(sample?.speed))
    .filter(speed => Number.isFinite(speed) && speed >= 0);
  if (speeds.length < Math.max(4, opts.minWindowSize)) return false;
  return mean(speeds) >= opts.highwayMeanSpeedMps && Math.min(...speeds) >= opts.highwayMinSpeedMps;
}

function computeProjectionDistance(window, opts, urgency = 0) {
  const meanSpeed = computeMeanSpeed(window);
  return clamp(
    opts.projectionDistanceMeters + (meanSpeed * opts.projectionLookaheadSeconds) + (urgency * 1200),
    opts.projectionDistanceMeters,
    opts.maxProjectionDistanceMeters
  );
}

function isPeakTrafficTime(timestampMs) {
  const date = new Date(timestampMs || Date.now());
  const day = date.getDay();
  const hour = date.getHours();
  const isWeekday = day >= 1 && day <= 5;
  return isWeekday && ((hour >= 7 && hour < 10) || (hour >= 16 && hour < 19));
}

// Smooth the vehicle heading by taking oldest→newest vector of the window,
// but trimming stationary samples at both ends (stop signs, red lights).
function computeSmoothedHeading(window) {
  const moving = window.filter(s => (s.speed || 0) > 1.0);
  if (moving.length < 2) return null;
  const oldest = moving[0];
  const newest = moving[moving.length - 1];
  const dist = haversineDistanceMeters(
    { latitude: oldest.latitude, longitude: oldest.longitude },
    { latitude: newest.latitude, longitude: newest.longitude }
  );
  if (dist < 25) return null; // not enough displacement to call a heading
  return {
    heading: calculateHeadingDegrees(
      { latitude: oldest.latitude, longitude: oldest.longitude },
      { latitude: newest.latitude, longitude: newest.longitude }
    ),
    origin: { latitude: newest.latitude, longitude: newest.longitude },
    displacement: dist,
  };
}

// Project station onto the forward heading. Returns alongTrack (positive =
// ahead, negative = behind) and crossTrack (perpendicular offset). The signed
// cross-track is positive when the station sits left of travel and negative
// when it sits right of travel.
function projectStation(origin, heading, station) {
  const latRad = origin.latitude * Math.PI / 180;
  const mPerLat = 111320;
  const mPerLon = 111320 * Math.max(0.1, Math.cos(latRad));
  // Heading direction as unit vector in local flat-earth meters.
  const hRad = heading * Math.PI / 180;
  const ux = Math.sin(hRad);
  const uy = Math.cos(hRad);
  const sx = (station.longitude - origin.longitude) * mPerLon;
  const sy = (station.latitude - origin.latitude) * mPerLat;
  const alongTrack = sx * ux + sy * uy;
  const signedCrossTrack = sx * (-uy) + sy * ux;
  const crossTrack = Math.abs(signedCrossTrack);
  const distance = Math.hypot(sx, sy);
  return { alongTrack, crossTrack, signedCrossTrack, distance };
}

/**
 * Find all stations lying ahead of the vehicle within the forward projection
 * corridor. Returns ranked list sorted by forward distance (nearest first).
 */
function findCorridorCandidates(window, stations, opts) {
  const smoothed = computeSmoothedHeading(window);
  if (!smoothed) return [];
  const result = [];
  for (const station of stations) {
    const routeApproach = station?.routeApproach || null;
    const proj = routeApproach?.isOnRoute
      ? {
        alongTrack: Number(routeApproach.alongRouteDistanceMeters),
        crossTrack: Number(routeApproach.offsetFromRouteMeters),
        signedCrossTrack: routeApproach.sideOfRoad === 'left'
          ? Math.abs(Number(routeApproach.offsetFromRouteMeters))
          : -Math.abs(Number(routeApproach.offsetFromRouteMeters)),
        distance: Number(station?.distanceMiles || 0) * 1609.344,
      }
      : projectStation(smoothed.origin, smoothed.heading, station);
    if (!Number.isFinite(proj.alongTrack) || !Number.isFinite(proj.crossTrack)) continue;
    if (proj.alongTrack < opts.minAheadDistanceMeters) continue;
    if (proj.alongTrack > opts.projectionDistanceMeters) continue;
    if (proj.crossTrack > opts.corridorHalfWidthMeters) continue;
    result.push({
      station,
      alongTrack: proj.alongTrack,
      crossTrack: proj.crossTrack,
      signedCrossTrack: proj.signedCrossTrack,
      directDistance: proj.distance,
    });
  }
  result.sort((a, b) => a.alongTrack - b.alongTrack);
  return result;
}

function computeAccessPenaltyPrice(candidate, opts, nowMs, isHighwayCruise) {
  if (!candidate) return 0;
  const routeApproachPenalty = Number(candidate?.station?.routeApproach?.maneuverPenaltyPrice);
  if (Number.isFinite(routeApproachPenalty)) {
    return Math.max(0, routeApproachPenalty);
  }
  const peakTraffic = isPeakTrafficTime(nowMs);
  const isLeftSide = Number(candidate.signedCrossTrack) > 0;
  const crossTrack = Math.abs(Number(candidate.crossTrack) || 0);
  const alongTrack = Number(candidate.alongTrack) || 0;

  let penalty = 0;
  if (isLeftSide) {
    penalty += peakTraffic ? opts.leftTurnPenaltyPeak : opts.leftTurnPenaltyOffPeak;
    if (peakTraffic && alongTrack <= 2600) penalty += opts.nearLeftTurnPenaltyPeak;
    if (peakTraffic && crossTrack >= 170) penalty += opts.medianCrossPenaltyPeak;
    if (peakTraffic && alongTrack <= 1700 && crossTrack >= 120) penalty += opts.uTurnLikePenaltyPeak;
  } else {
    penalty -= opts.accessBonusRightSide;
  }

  if (isHighwayCruise && crossTrack >= 140) {
    penalty += opts.highwayExitPenalty;
  }

  return Math.max(0, penalty);
}

function computeNetStationCost(candidate, opts, isHighwayCruise) {
  const stationBasePrice = Number.isFinite(Number(candidate?.station?.effectivePrice))
    ? Number(candidate.station.effectivePrice)
    : Number(candidate?.station?.price);
  if (!candidate || !candidate.station || !Number.isFinite(stationBasePrice)) {
    return Number.POSITIVE_INFINITY;
  }
  const alongTrackDivisor = isHighwayCruise ? 400000 : 50000;
  const crossTrackDivisor = isHighwayCruise ? 15000 : 7000;
  return stationBasePrice +
    ((candidate.alongTrack || 0) / alongTrackDivisor) +
    ((candidate.crossTrack || 0) / crossTrackDivisor);
}

function computeBrandAffinity(station, profile) {
  if (!profile || !station?.brand || !profile.preferredBrands || profile.preferredBrands.length === 0) {
    return 0;
  }
  const stationBrand = String(station.brand || '').toLowerCase();
  const matched = profile.preferredBrands.some(brand => stationBrand.includes(String(brand).toLowerCase()));
  if (!matched) return 0;
  return clamp(0.55 + ((profile.brandLoyalty || 0) * 0.45), 0, 1);
}

function computeProfileValueSeekingScore(profile, stationCatalog = []) {
  if (!profile) return 0;
  const preferredBrands = Array.isArray(profile.preferredBrands) ? profile.preferredBrands : [];
  const catalogByStationId = new Map(
    (stationCatalog || [])
      .filter(station => station?.stationId)
      .map(station => [station.stationId, station])
  );
  const pricedCatalog = [...catalogByStationId.values()]
    .map(station => Number(station?.price))
    .filter(price => Number.isFinite(price))
    .sort((left, right) => left - right);

  let weightedCheapVisitShare = 0;
  let totalVisits = 0;
  for (const entry of profile.visitHistory || []) {
    const visitCount = Number(entry?.visitCount) || 0;
    if (visitCount <= 0) continue;
    totalVisits += visitCount;
    const station = catalogByStationId.get(entry.stationId);
    const price = Number(station?.price);
    if (!Number.isFinite(price) || pricedCatalog.length <= 1) continue;
    const cheaperCount = pricedCatalog.filter(value => value < price).length;
    const cheapness = clamp(1 - (cheaperCount / (pricedCatalog.length - 1)), 0, 1);
    weightedCheapVisitShare += visitCount * cheapness;
  }

  const preferredCheapBrandShare = preferredBrands.length
    ? preferredBrands.filter(brand => {
      const normalizedBrand = String(brand || '').toLowerCase();
      return [...catalogByStationId.values()].some(station => {
        const stationBrand = String(station?.brand || '').toLowerCase();
        const price = Number(station?.price);
        if (!stationBrand.includes(normalizedBrand) || !Number.isFinite(price) || pricedCatalog.length <= 1) {
          return false;
        }
        const cheaperCount = pricedCatalog.filter(value => value < price).length;
        const cheapness = clamp(1 - (cheaperCount / (pricedCatalog.length - 1)), 0, 1);
        return cheapness >= 0.6;
      });
    }).length / preferredBrands.length
    : 0;

  const weightedCheapness = totalVisits > 0 ? (weightedCheapVisitShare / totalVisits) : 0;
  return clamp((weightedCheapness * 0.72) + (preferredCheapBrandShare * 0.28), 0, 1);
}

function computeOpportunisticFillScore(profile, fuelState) {
  const intervalUtilization = fuelState?.avgIntervalMiles
    ? clamp((fuelState?.milesSinceLastFill || 0) / Math.max(1, fuelState.avgIntervalMiles), 0, 2)
    : null;
  const earlyFillBias = intervalUtilization == null
    ? 0
    : clamp(1 - (intervalUtilization / 0.75), 0, 1);
  const fillCount = Array.isArray(profile?.fillUpHistory) ? profile.fillUpHistory.length : 0;
  const fillHistoryConfidence = smoothstep(1, 4, fillCount);
  return clamp((earlyFillBias * 0.55) + (fillHistoryConfidence * 0.15), 0, 1);
}

function computePriceRank(station, stationPool) {
  const prices = (stationPool || [])
    .map(entry => Number(entry?.price))
    .filter(price => Number.isFinite(price))
    .sort((a, b) => a - b);
  if (prices.length === 0 || !Number.isFinite(Number(station?.price))) return 0.5;
  const price = Number(station.price);
  const cheaperCount = prices.filter(value => value < price).length;
  if (prices.length === 1) return 0.5;
  return clamp(1 - (cheaperCount / (prices.length - 1)), 0, 1);
}

function computeColdStartScore(candidate, corridorCandidates, profile, allStations, urgency, projectionDistanceMeters, opts) {
  if (!candidate) return 0;
  const station = candidate.station;
  const corridorStations = (corridorCandidates || []).map(entry => entry.station);
  const globalStations = allStations && allStations.length > 0 ? allStations : corridorStations;
  const pathFit = clamp(1 - (candidate.crossTrack / opts.corridorHalfWidthMeters), 0, 1);
  const brandAffinity = computeBrandAffinity(station, profile);
  const corridorPriceRank = computePriceRank(station, corridorStations);
  const globalPriceRank = computePriceRank(station, globalStations);
  const urgencyBoost = clamp(urgency / 0.75, 0, 1);
  const accessFit = clamp(1 - (candidate.accessPenaltyPrice || 0) / Math.max(0.01, opts.uTurnLikePenaltyPeak), 0, 1);
  const distanceFit = candidate.alongTrack >= opts.minTriggerDistanceMeters
    ? 1 - smoothstep(projectionDistanceMeters * 0.82, projectionDistanceMeters, candidate.alongTrack)
    : 0;

  return clamp(
    (pathFit * 0.20) +
    (corridorPriceRank * 0.14) +
    (globalPriceRank * 0.24) +
    (brandAffinity * 0.20) +
    (accessFit * 0.12) +
    (urgencyBoost * 0.06) +
    (distanceFit * 0.04),
    0,
    1
  );
}

function computeIntentEvidence(candidate, opts, urgency, historyStrength, isHighwayCruise) {
  const physicalIntentScore = clamp(Number(candidate?.physicalIntentScore) || 0, 0, 1);
  const decelSignal = clamp(Number(candidate?.physicalFeatures?.decelScore) || 0, 0, 1);
  const pathSignal = clamp(Number(candidate?.physicalFeatures?.pathScore) || 0, 0, 1);
  const approachSignal = clamp(Number(candidate?.physicalFeatures?.approachScore) || 0, 0, 1);
  const captureSignal = clamp(Number(candidate?.physicalFeatures?.captureScore) || 0, 0, 1);
  const crossTrackFit = clamp(1 - ((Number(candidate?.crossTrack) || 0) / opts.corridorHalfWidthMeters), 0, 1);
  const closeDistanceEdge = isHighwayCruise ? opts.strongSpeculativeDistanceMeters + 1500 : opts.strongSpeculativeDistanceMeters;
  const farDistanceEdge = isHighwayCruise ? opts.maxSpeculativeDistanceMeters + 1500 : opts.maxSpeculativeDistanceMeters;
  const distanceSignal = 1 - smoothstep(
    closeDistanceEdge,
    farDistanceEdge,
    Number(candidate?.alongTrack) || 0
  );
  const urgencySignal = clamp(urgency / 0.95, 0, 1);

  return clamp(
    (physicalIntentScore * 0.30) +
    (captureSignal * 0.20) +
    (decelSignal * 0.16) +
    (approachSignal * 0.12) +
    (pathSignal * 0.10) +
    (crossTrackFit * 0.08) +
    (distanceSignal * 0.08) +
    (urgencySignal * 0.04) +
    (Math.min(historyStrength, 0.6) * 0.04),
    0,
    1
  );
}

function computeTripFuelIntentScore(scoredCandidates, opts, urgency, isHighwayCruise) {
  if (!Array.isArray(scoredCandidates) || scoredCandidates.length === 0) {
    return 0;
  }

  const rankedByIntent = [...scoredCandidates].sort((a, b) =>
    (b.intentEvidence || 0) - (a.intentEvidence || 0)
  );
  const best = rankedByIntent[0] || null;
  const runnerUp = rankedByIntent[1] || null;
  if (!best) {
    return 0;
  }

  const separation = clamp(
    (best.intentEvidence || 0) - (runnerUp?.intentEvidence || 0),
    0,
    1
  );
  const distanceSignal = 1 - smoothstep(
    isHighwayCruise ? opts.maxSpeculativeDistanceMeters + 2000 : opts.maxSpeculativeDistanceMeters,
    isHighwayCruise ? opts.maxProjectionDistanceMeters : opts.maxProjectionDistanceMeters * 0.9,
    Number(best.alongTrack) || 0
  );

  return clamp(
    ((best.intentEvidence || 0) * 0.44) +
    ((best.physicalIntentScore || 0) * 0.18) +
    (clamp(Number(best?.physicalFeatures?.captureScore) || 0, 0, 1) * 0.10) +
    (clamp(Number(best?.physicalFeatures?.approachScore) || 0, 0, 1) * 0.12) +
    (clamp(Number(best?.physicalFeatures?.pathScore) || 0, 0, 1) * 0.08) +
    (clamp(Number(best?.physicalFeatures?.decelScore) || 0, 0, 1) * 0.06) +
    (separation * 0.04) +
    (distanceSignal * 0.02) +
    (clamp(urgency / 0.9, 0, 1) * 0.02) +
    ((isHighwayCruise && urgency >= 0.65) ? 0.05 : 0),
    0,
    1
  );
}

function computeTripFuelIntentThreshold(opts, urgency, historyStrength, isHighwayCruise) {
  const baseThreshold = historyStrength >= 0.2
    ? opts.minTripFuelIntentWithHistory
    : opts.minTripFuelIntentColdStart;
  return clamp(
    baseThreshold - (clamp(urgency, 0, 1) * 0.10) - (isHighwayCruise ? 0.03 : 0),
    0.2,
    0.55
  );
}

function computeTurnInCommitmentScore(candidate) {
  if (!candidate) return 0;
  const physicalIntentScore = clamp(Number(candidate?.physicalIntentScore) || 0, 0, 1);
  const captureScore = clamp(Number(candidate?.physicalFeatures?.captureScore) || 0, 0, 1);
  const approachScore = clamp(Number(candidate?.physicalFeatures?.approachScore) || 0, 0, 1);
  const pathScore = clamp(Number(candidate?.physicalFeatures?.pathScore) || 0, 0, 1);
  const decelScore = clamp(Number(candidate?.physicalFeatures?.decelScore) || 0, 0, 1);
  return clamp(
    (physicalIntentScore * 0.44) +
    (captureScore * 0.18) +
    (approachScore * 0.18) +
    (pathScore * 0.12) +
    (decelScore * 0.08),
    0,
    1
  );
}

/**
 * Score a candidate station's likelihood of being the user's intended stop.
 * Returns a "destinationProbability" (0-1) that reflects how likely this
 * specific station is the user's normal choice given their history, time of
 * day, brand loyalty, etc. This is independent of physics (physics is handled
 * by the base engine).
 */
function scoreDestinationLikelihood(station, profile, nowMs, context = {}) {
  if (!profile) return 0;
  const historyScore = context.candidate
    ? (Number(context.candidate.genericHistoryScore) || 0)
    : computeHistoryScore(station, profile, nowMs);
  const contextualHistoryScore = context.candidate
    ? (Number(context.candidate.contextualHistoryScore) || 0)
    : computeContextualHistoryScore(station, profile, nowMs, context.historyContext || {});
  const historyContextMatch = context.candidate
    ? (Number(context.candidate.historyContextMatch) || 0)
    : computeHistoryContextMatch(station, profile, nowMs, context.historyContext || {});
  const timePatternScore = computeTimePatternScore(station, profile, nowMs);
  const brandAffinity = computeBrandAffinity(station, profile);
  const coldStartScore = context.candidate
    ? computeColdStartScore(
      context.candidate,
      context.corridorCandidates || [],
      profile,
      context.allStations || [],
      context.urgency || 0,
      context.projectionDistanceMeters || DEFAULT_OPTIONS.projectionDistanceMeters,
      context.options || DEFAULT_OPTIONS
    )
    : brandAffinity * 0.35;
  const historicalStrength = Math.max(
    contextualHistoryScore,
    timePatternScore,
    historyScore * (0.22 + (historyContextMatch * 0.78))
  );
  const learnedIntent = clamp(
    (historicalStrength * 0.72) +
    (contextualHistoryScore * 0.12) +
    (brandAffinity * 0.16),
    0,
    1
  );

  if (historicalStrength >= 0.20) {
    return clamp((learnedIntent * 0.76) + (coldStartScore * 0.24), 0, 1);
  }
  return clamp((coldStartScore * 0.74) + (learnedIntent * 0.26), 0, 1);
}

/**
 * Main entry point: given current window + profile + stations, decide whether
 * to recommend a station, and if so which one.
 *
 * Returns: null (no recommendation) or
 *   {
 *     stationId,            // the recommended station
 *     type,                 // 'cheaper_alternative' | 'predicted_stop' | 'urgent_any'
 *     confidence,           // 0-1
 *     reason,               // short description
 *     forwardDistance,      // how far ahead the station is (meters)
 *     predictedDefault,     // the user's would-have-been default, if applicable
 *     savings,              // price savings per gal vs predictedDefault, if applicable
 *     detourExtraMeters,    // detour cost vs predictedDefault path
 *   }
 */
function recommend(window, profile, stations, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (!window || window.length < opts.minWindowSize) return null;
  if (!stations || stations.length === 0) return null;

  // Require the vehicle to be actively driving. Multiple sub-1mps samples in
  // a row mean "parked", not "at a stop light".
  const recent = window.slice(-Math.max(6, opts.minWindowSize + 1));
  const activeRecent = recent.filter(s => (s.speed || 0) >= opts.stoppedSpeedMps);
  const trafficPause = inferTrafficPause(recent, opts);
  const allowsTrafficPauseEvaluation = trafficPause.likelyTrafficPause || trafficPause.stopLightLike || trafficPause.stopSignLike;
  if (activeRecent.length < 3 && !allowsTrafficPauseEvaluation) return null;
  // Reject unreasonable speeds (driving modes only).
  const maxSpeedInWindow = Math.max(...window.map(s => s.speed || 0));
  if (maxSpeedInWindow > opts.maxDrivingSpeedMps) return null;

  const nowMs = window[window.length - 1].timestamp || Date.now();

  // Corridor lookup.
  const trackedMilesSinceLastFill = Number.isFinite(Number(options.milesSinceLastFill))
    ? Number(options.milesSinceLastFill)
    : (Number.isFinite(Number(profile?.estimatedMilesSinceLastFill))
      ? Number(profile.estimatedMilesSinceLastFill)
      : null);
  const fuelState = profile && profile.fillUpHistory
    ? estimateFuelState(profile.fillUpHistory, {
      milesSinceLastFill: trackedMilesSinceLastFill,
      typicalIntervalMiles: profile.typicalFillUpIntervalMiles,
    })
    : null;
  const urgency = typeof options.urgency === 'number'
    ? options.urgency
    : (fuelState ? fuelState.urgency : 0);
  const fuelNeedScore = clamp(Math.max(
    fuelState?.fuelNeedScore || 0,
    urgency,
  ), 0, 1);
  const effectiveCorridorHalfWidthMeters = clamp(
    opts.corridorHalfWidthMeters + (fuelNeedScore * 140) + (computeMeanSpeed(window) <= 5 ? 60 : 0),
    opts.corridorHalfWidthMeters,
    opts.corridorHalfWidthMeters + 220
  );
  const effectiveMinTriggerDistanceMeters = fuelNeedScore >= opts.fuelNeedMediumThreshold
    ? Math.max(1000, opts.minTriggerDistanceMeters - 500)
    : opts.minTriggerDistanceMeters;
  const effectiveProjectionDistance = computeProjectionDistance(window, opts, urgency);
  const isHighwayCruise = detectHighwayCruise(window, opts);
  const meanSpeedMps = computeMeanSpeed(window);
  const roadComplexity = computeRoadComplexity(window, opts);
  const liveHistoryContext = {
    isHighwayCruise,
    isCityGridLike: roadComplexity.gridlock || (!isHighwayCruise && roadComplexity.meanHeadingDelta >= opts.complexHeadingDeltaDegrees && meanSpeedMps <= 8),
    meanSpeedMps,
  };

  const candidates = findCorridorCandidates(window, stations, {
    ...opts,
    projectionDistanceMeters: effectiveProjectionDistance,
    corridorHalfWidthMeters: effectiveCorridorHalfWidthMeters,
  });
  if (candidates.length === 0) return null;

  // Score each candidate's destinationProbability.
  const corridorStations = candidates.map(candidate => candidate.station);
  const initiallyScored = candidates.map(candidate => {
    const accessPenaltyPrice = computeAccessPenaltyPrice(candidate, opts, nowMs, isHighwayCruise);
    const physicalFeatures = scoreStation(window, candidate.station, {
      triggerThreshold: 0.72,
      userProfile: null,
      urgency: 0,
      isRoadTripHint: false,
    }, corridorStations);
    const physicalIntentScore = clamp(Number(physicalFeatures?.confidence) || 0, 0, 1);
    const genericHistoryScore = computeHistoryScore(candidate.station, profile, nowMs);
    const contextualHistoryScore = computeContextualHistoryScore(candidate.station, profile, nowMs, liveHistoryContext);
    const historyContextMatch = computeHistoryContextMatch(candidate.station, profile, nowMs, liveHistoryContext);
    const observedConversionRate = computeObservedConversionRate(candidate.station, profile);
    const contextualObservedConversionRate = computeContextualObservedConversionRate(candidate.station, profile, nowMs, liveHistoryContext);
    const exposureContextMatch = computeExposureContextMatch(candidate.station, profile, nowMs, liveHistoryContext);
    const observedSkipScore = computeObservedSkipScore(candidate.station, profile, nowMs, liveHistoryContext);
    const coldStartScore = computeColdStartScore({
      ...candidate,
      accessPenaltyPrice,
      physicalIntentScore,
      physicalFeatures,
    }, candidates, profile, stations, urgency, effectiveProjectionDistance, opts);
    const destinationProbability = scoreDestinationLikelihood(candidate.station, profile, nowMs, {
      candidate: {
        ...candidate,
        accessPenaltyPrice,
        coldStartScore,
        physicalIntentScore,
        physicalFeatures,
        genericHistoryScore,
        contextualHistoryScore,
        historyContextMatch,
        observedConversionRate,
        contextualObservedConversionRate,
        exposureContextMatch,
        observedSkipScore,
      },
      corridorCandidates: candidates,
      allStations: stations,
      urgency,
      projectionDistanceMeters: effectiveProjectionDistance,
      options: opts,
      historyContext: liveHistoryContext,
    });

    return {
      ...candidate,
      accessPenaltyPrice,
      brandAffinity: computeBrandAffinity(candidate.station, profile),
      coldStartScore,
      destinationProbability,
      genericHistoryScore,
      contextualHistoryScore,
      historyContextMatch,
      observedConversionRate,
      contextualObservedConversionRate,
      exposureContextMatch,
      observedSkipScore,
      physicalIntentScore,
      physicalFeatures,
    };
  }).map(candidate => {
    const timePatternScore = computeTimePatternScore(candidate.station, profile, nowMs);
    const historyStrengthCandidate = Math.max(
      candidate.contextualHistoryScore || 0,
      timePatternScore,
      (candidate.genericHistoryScore || 0) * (0.22 + ((candidate.historyContextMatch || 0) * 0.78))
    );
    return {
      ...candidate,
      visitShare: computeVisitShare(candidate.station, profile),
      historyStrength: historyStrengthCandidate,
      intentEvidence: computeIntentEvidence(candidate, opts, urgency, historyStrengthCandidate, isHighwayCruise),
      netStationCost: computeNetStationCost(candidate, opts, isHighwayCruise),
    };
  });
  const finiteNetCosts = initiallyScored
    .map(candidate => Number(candidate.netStationCost))
    .filter(cost => Number.isFinite(cost));
  const cheapestNetCost = finiteNetCosts.length ? Math.min(...finiteNetCosts) : 0;
  const mostExpensiveNetCost = finiteNetCosts.length ? Math.max(...finiteNetCosts) : cheapestNetCost;
  const netCostSpread = Math.max(0.01, mostExpensiveNetCost - cheapestNetCost);
  const scored = initiallyScored.map(candidate => ({
    ...candidate,
    valueScore: clamp(
      1 - ((candidate.netStationCost - cheapestNetCost) / netCostSpread),
      0,
      1
    ),
    historyLift: smoothstep(0.28, 0.70, candidate.intentEvidence || 0),
    effectiveDestinationProbability: clamp(
      candidate.destinationProbability * (0.30 + (candidate.intentEvidence * 0.70)),
      0,
      1
    ),
  }));
  const rankedByDestination = [...scored].sort((a, b) =>
    b.effectiveDestinationProbability - a.effectiveDestinationProbability ||
    b.destinationProbability - a.destinationProbability
  );

  // Find the user's "predicted default" — the candidate with highest
  // destinationProbability. This is where they'd stop if the app didn't say
  // anything.
  const coldStartPredictedDefault = [...scored].sort((a, b) =>
    (a.netStationCost - (a.intentEvidence * 0.22) - (a.coldStartScore * 0.12)) -
    (b.netStationCost - (b.intentEvidence * 0.22) - (b.coldStartScore * 0.12)) ||
    b.intentEvidence - a.intentEvidence
  )[0] || null;
  const learnedPredictedDefault = rankedByDestination[0] || null;
  const learnedHistoryStrength = learnedPredictedDefault
    ? Math.max(
      learnedPredictedDefault.contextualHistoryScore || 0,
      computeTimePatternScore(learnedPredictedDefault.station, profile, nowMs),
      (learnedPredictedDefault.genericHistoryScore || 0) * (0.22 + ((learnedPredictedDefault.historyContextMatch || 0) * 0.78))
    )
    : 0;
  const predictedDefault = (learnedHistoryStrength < 0.20)
    ? coldStartPredictedDefault
    : learnedPredictedDefault;
  const runnerUp = rankedByDestination[1] || null;
  const leadMargin = predictedDefault && runnerUp
    ? predictedDefault.effectiveDestinationProbability - runnerUp.effectiveDestinationProbability
    : (predictedDefault ? predictedDefault.effectiveDestinationProbability : 0);
  const historyStrength = predictedDefault
    ? Math.max(
      predictedDefault.contextualHistoryScore || 0,
      computeTimePatternScore(predictedDefault.station, profile, nowMs),
      (predictedDefault.genericHistoryScore || 0) * (0.22 + ((predictedDefault.historyContextMatch || 0) * 0.78))
    )
    : 0;
  const timePatternStrength = predictedDefault
    ? computeTimePatternScore(predictedDefault.station, profile, nowMs)
    : 0;
  const intentLeader = [...scored].sort((a, b) =>
    (b.intentEvidence || 0) - (a.intentEvidence || 0)
  )[0] || null;
  const valueLeader = [...scored].sort((a, b) =>
    (b.valueScore || 0) - (a.valueScore || 0)
  )[0] || null;
  const tripFuelIntentScore = computeTripFuelIntentScore(scored, opts, urgency, isHighwayCruise);
  const tripFuelIntentThreshold = computeTripFuelIntentThreshold(opts, urgency, historyStrength, isHighwayCruise);
  const predictedBrandAffinity = clamp(predictedDefault?.brandAffinity || 0, 0, 1);
  const profileValueSeekingScore = computeProfileValueSeekingScore(profile, stations);
  const opportunisticFillScore = computeOpportunisticFillScore(profile, fuelState);
  const lowSpecificityColdStart = Boolean(
    predictedDefault &&
    historyStrength < 0.20 &&
    timePatternStrength < 0.20 &&
    fuelNeedScore < 0.88 &&
    !isHighwayCruise
  );
  const speculativeUrbanHistoryMode = Boolean(
    predictedDefault &&
    !isHighwayCruise &&
    historyStrength >= 0.45 &&
    timePatternStrength < 0.20 &&
    predictedDefault.alongTrack > opts.maxSpeculativeDistanceMeters &&
    fuelNeedScore < 0.55
  );
  const predictedDefaultPathScore = clamp(Number(predictedDefault?.physicalFeatures?.pathScore) || 0, 0, 1);
  const predictedDefaultCaptureScore = clamp(Number(predictedDefault?.physicalFeatures?.captureScore) || 0, 0, 1);
  const predictedDefaultTurnInCommitmentScore = predictedDefault
    ? computeTurnInCommitmentScore(predictedDefault)
    : 0;
  const historyRecoveryMinFuelNeed = isHighwayCruise
    ? opts.historyRecoveryMinHighwayFuelNeed
    : opts.historyRecoveryMinFuelNeed;
  const historyRecoveryTripIntentFloor = Math.max(
    0.18,
    tripFuelIntentThreshold - (isHighwayCruise ? opts.historyRecoveryTripIntentBuffer : (opts.historyRecoveryTripIntentBuffer * 0.5))
  );
  const historyRecoveryMaxDistanceMeters = isHighwayCruise
    ? opts.historyRecoveryHighwayMaxDistanceMeters
    : opts.historyRecoveryCityMaxDistanceMeters;
  const historyRecoveryConfidence = predictedDefault
    ? clamp(
      (predictedDefault.effectiveDestinationProbability * 0.20) +
      ((predictedDefault.intentEvidence || 0) * 0.24) +
      (historyStrength * 0.22) +
      ((predictedDefault.valueScore || 0) * 0.12) +
      (fuelNeedScore * 0.10) +
      (predictedDefaultPathScore * 0.05) +
      (predictedDefaultCaptureScore * 0.03) +
      (predictedDefaultTurnInCommitmentScore * 0.02) +
      ((intentLeader?.station?.stationId === predictedDefault.station?.stationId) ? 0.04 : 0) +
      ((valueLeader?.station?.stationId === predictedDefault.station?.stationId) ? 0.02 : 0),
      0,
      1
    )
    : 0;
  const historyRecoveryEligible = Boolean(
    opts.enableHistoryRecoveryProposals &&
    predictedDefault &&
    !speculativeUrbanHistoryMode &&
    historyStrength >= opts.historyRecoveryMinHistoryStrength &&
    predictedDefault.alongTrack >= effectiveMinTriggerDistanceMeters &&
    predictedDefault.alongTrack <= historyRecoveryMaxDistanceMeters &&
    predictedDefault.effectiveDestinationProbability >= opts.historyRecoveryMinProbability &&
    (predictedDefault.intentEvidence || 0) >= opts.historyRecoveryMinIntentEvidence &&
    (predictedDefault.valueScore || 0) >= opts.historyRecoveryMinValueScore &&
    predictedDefaultPathScore >= opts.historyRecoveryMinPathScore &&
    fuelNeedScore >= historyRecoveryMinFuelNeed &&
    tripFuelIntentScore >= historyRecoveryTripIntentFloor
  );

  function rankCandidate(candidates, candidate, key) {
    if (!candidate || !Array.isArray(candidates) || candidates.length === 0) return null;
    const sorted = [...candidates].sort((left, right) => {
      const leftValue = Number(left?.[key]) || 0;
      const rightValue = Number(right?.[key]) || 0;
      return rightValue - leftValue;
    });
    const index = sorted.findIndex(entry => entry.station?.stationId === candidate.station?.stationId);
    return index >= 0 ? index + 1 : null;
  }

  function computeLeaderMargin(sortedCandidates, candidate, key) {
    if (!candidate || !Array.isArray(sortedCandidates) || sortedCandidates.length === 0) return 0;
    const leaderValue = Number(sortedCandidates[0]?.[key]) || 0;
    const candidateValue = Number(candidate?.[key]) || 0;
    return leaderValue - candidateValue;
  }

  function buildDecisionSnapshot(selectedCandidate = null, recommendation = null) {
    const rankedByIntentScore = [...scored].sort((left, right) =>
      (right.intentEvidence || 0) - (left.intentEvidence || 0) ||
      (right.valueScore || 0) - (left.valueScore || 0)
    );
    const rankedByValueScore = [...scored].sort((left, right) =>
      (right.valueScore || 0) - (left.valueScore || 0) ||
      (right.intentEvidence || 0) - (left.intentEvidence || 0)
    );

    return {
      timestampMs: nowMs,
      historyVisitCount: Array.isArray(profile?.visitHistory)
        ? profile.visitHistory.reduce((sum, entry) => sum + (Number(entry?.visitCount) || 0), 0)
        : 0,
      predictedDefaultStationId: predictedDefault?.station?.stationId || null,
      intentLeaderStationId: intentLeader?.station?.stationId || null,
      valueLeaderStationId: valueLeader?.station?.stationId || null,
      candidateCount: scored.length,
      tripFuelIntentScore,
      tripFuelIntentThreshold,
      tripFuelIntentSurplus: tripFuelIntentScore - tripFuelIntentThreshold,
      historyStrength,
      timePatternStrength,
      leadMargin,
      urgency,
      fuelNeedScore,
      isHighwayCruise,
      lowSpecificityColdStart,
      speculativeUrbanHistoryMode,
      historyRecoveryEligible,
      historyRecoveryConfidence,
      estimatedRemainingMiles: fuelState?.estimatedRemainingMiles ?? null,
      avgIntervalMiles: fuelState?.avgIntervalMiles ?? null,
      profileHistoryConcentration: computeProfileHistoryConcentration(profile),
      recommendation: recommendation
        ? {
          stationId: recommendation.stationId,
          type: recommendation.type,
          confidence: recommendation.confidence,
          forwardDistance: recommendation.forwardDistance,
        }
        : null,
      candidates: scored.map(candidate => {
        const physicalFeatures = candidate.physicalFeatures || {};
        return {
          stationId: candidate.station?.stationId || null,
          brand: candidate.station?.brand || null,
          alongTrack: candidate.alongTrack,
          crossTrack: candidate.crossTrack,
          signedCrossTrack: candidate.signedCrossTrack,
          accessPenaltyPrice: candidate.accessPenaltyPrice || 0,
          netStationCost: candidate.netStationCost || 0,
          coldStartScore: candidate.coldStartScore || 0,
          valueScore: candidate.valueScore || 0,
          intentEvidence: candidate.intentEvidence || 0,
          physicalIntentScore: candidate.physicalIntentScore || 0,
          destinationProbability: candidate.destinationProbability || 0,
          effectiveDestinationProbability: candidate.effectiveDestinationProbability || 0,
          historyStrength: candidate.historyStrength || 0,
          genericHistoryScore: candidate.genericHistoryScore || 0,
          contextualHistoryScore: candidate.contextualHistoryScore || 0,
          historyContextMatch: candidate.historyContextMatch || 0,
          visitShare: candidate.visitShare || 0,
          observedConversionRate: candidate.observedConversionRate || 0,
          contextualObservedConversionRate: candidate.contextualObservedConversionRate || 0,
          exposureContextMatch: candidate.exposureContextMatch || 0,
          observedSkipScore: candidate.observedSkipScore || 0,
          brandAffinity: candidate.brandAffinity || 0,
          pathScore: Number(physicalFeatures.pathScore) || 0,
          captureScore: Number(physicalFeatures.captureScore) || 0,
          approachScore: Number(physicalFeatures.approachScore) || 0,
          decelScore: Number(physicalFeatures.decelScore) || 0,
          turnInCommitmentScore: computeTurnInCommitmentScore(candidate),
          valueRank: rankCandidate(rankedByValueScore, candidate, 'valueScore'),
          intentRank: rankCandidate(rankedByIntentScore, candidate, 'intentEvidence'),
          destinationRank: rankCandidate(rankedByDestination, candidate, 'effectiveDestinationProbability'),
          destinationMarginToLeader: computeLeaderMargin(rankedByDestination, candidate, 'effectiveDestinationProbability'),
          intentMarginToLeader: computeLeaderMargin(rankedByIntentScore, candidate, 'intentEvidence'),
          valueMarginToLeader: computeLeaderMargin(rankedByValueScore, candidate, 'valueScore'),
          predictedDefaultAligned: Boolean(
            predictedDefault?.station?.stationId &&
            predictedDefault.station.stationId === candidate.station?.stationId
          ),
          predictedDefaultGap: predictedDefault
            ? ((predictedDefault.effectiveDestinationProbability || 0) - (candidate.effectiveDestinationProbability || 0))
            : 0,
          intentLeaderAligned: Boolean(
            intentLeader?.station?.stationId &&
            intentLeader.station.stationId === candidate.station?.stationId
          ),
          valueLeaderAligned: Boolean(
            valueLeader?.station?.stationId &&
            valueLeader.station.stationId === candidate.station?.stationId
          ),
          selected: Boolean(
            selectedCandidate?.station?.stationId &&
            selectedCandidate.station.stationId === candidate.station?.stationId
          ),
        };
      }),
    };
  }

  function buildMlFeatureEnvelope(candidate, recommendation) {
    if (!candidate) {
      return {
        candidateCount: scored.length,
        tripFuelIntentScore,
        tripFuelIntentThreshold,
        historyStrength,
        timePatternStrength,
        leadMargin,
        urgency,
        fuelNeedScore,
        isHighwayCruise,
        lowSpecificityColdStart,
        speculativeUrbanHistoryMode,
        historyRecoveryEligible,
        historyRecoveryConfidence,
        estimatedRemainingMiles: fuelState?.estimatedRemainingMiles ?? null,
        avgIntervalMiles: fuelState?.avgIntervalMiles ?? null,
        intervalUtilization: fuelState?.avgIntervalMiles
          ? clamp((fuelState?.milesSinceLastFill || 0) / Math.max(1, fuelState.avgIntervalMiles), 0, 2)
          : null,
        profileHistoryConcentration: computeProfileHistoryConcentration(profile),
        profileStationCount: Array.isArray(profile?.visitHistory) ? profile.visitHistory.length : 0,
        profileValueSeekingScore,
        opportunisticFillScore,
      };
    }

    const physicalFeatures = candidate.physicalFeatures || {};
    const bestByValue = [...scored].sort((left, right) => (right.valueScore || 0) - (left.valueScore || 0))[0] || null;
    const bestByIntent = [...scored].sort((left, right) => (right.intentEvidence || 0) - (left.intentEvidence || 0))[0] || null;
    const cheapestByNet = [...scored].sort((left, right) => (left.netStationCost || 0) - (right.netStationCost || 0))[0] || null;

    return {
      candidateCount: scored.length,
      candidateAlongTrack: candidate.alongTrack,
      candidateCrossTrack: candidate.crossTrack,
      candidateSignedCrossTrack: candidate.signedCrossTrack,
      candidateAccessPenaltyPrice: candidate.accessPenaltyPrice || 0,
      candidateNetStationCost: candidate.netStationCost || 0,
      candidateNetCostDeltaFromBest: Math.max(0, (candidate.netStationCost || 0) - (cheapestByNet?.netStationCost || 0)),
      candidateColdStartScore: candidate.coldStartScore || 0,
      candidateValueScore: candidate.valueScore || 0,
      candidateIntentEvidence: candidate.intentEvidence || 0,
      candidatePhysicalIntentScore: candidate.physicalIntentScore || 0,
      candidateDestinationProbability: candidate.destinationProbability || 0,
      candidateEffectiveDestinationProbability: candidate.effectiveDestinationProbability || 0,
      candidateHistoryStrength: candidate.historyStrength || 0,
      candidateGenericHistoryScore: candidate.genericHistoryScore || 0,
      candidateContextualHistoryScore: candidate.contextualHistoryScore || 0,
      candidateHistoryContextMatch: candidate.historyContextMatch || 0,
      candidateVisitShare: candidate.visitShare || 0,
      candidateObservedConversionRate: candidate.observedConversionRate || 0,
      candidateContextualObservedConversionRate: candidate.contextualObservedConversionRate || 0,
      candidateExposureContextMatch: candidate.exposureContextMatch || 0,
      candidateObservedSkipScore: candidate.observedSkipScore || 0,
      candidateBrandAffinity: candidate.brandAffinity || 0,
      candidatePathScore: Number(physicalFeatures.pathScore) || 0,
      candidateCaptureScore: Number(physicalFeatures.captureScore) || 0,
      candidateApproachScore: Number(physicalFeatures.approachScore) || 0,
      candidateDecelScore: Number(physicalFeatures.decelScore) || 0,
      candidateTurnInCommitmentScore: computeTurnInCommitmentScore(candidate),
      candidateDistanceMeters: Number(physicalFeatures.distanceMeters) || null,
      candidateValueRank: rankCandidate(scored, candidate, 'valueScore'),
      candidateIntentRank: rankCandidate(scored, candidate, 'intentEvidence'),
      candidateDestinationRank: rankCandidate(scored, candidate, 'effectiveDestinationProbability'),
      predictedDefaultStationId: predictedDefault?.station?.stationId || null,
      predictedDefaultSameStation: Boolean(predictedDefault?.station?.stationId && predictedDefault.station.stationId === candidate.station?.stationId),
      predictedDefaultIntentEvidence: predictedDefault?.intentEvidence || 0,
      predictedDefaultValueScore: predictedDefault?.valueScore || 0,
      predictedDefaultAlongTrack: predictedDefault?.alongTrack || null,
      predictedDefaultContextualHistoryScore: predictedDefault?.contextualHistoryScore || 0,
      predictedDefaultHistoryContextMatch: predictedDefault?.historyContextMatch || 0,
      predictedDefaultObservedConversionRate: predictedDefault?.observedConversionRate || 0,
      predictedDefaultContextualObservedConversionRate: predictedDefault?.contextualObservedConversionRate || 0,
      bestByIntentSameStation: Boolean(bestByIntent?.station?.stationId && bestByIntent.station.stationId === candidate.station?.stationId),
      bestByValueSameStation: Boolean(bestByValue?.station?.stationId && bestByValue.station.stationId === candidate.station?.stationId),
      tripFuelIntentScore,
      tripFuelIntentThreshold,
      tripFuelIntentSurplus: tripFuelIntentScore - tripFuelIntentThreshold,
      historyStrength,
      timePatternStrength,
      leadMargin,
      urgency,
      fuelNeedScore,
      isHighwayCruise,
      lowSpecificityColdStart,
      speculativeUrbanHistoryMode,
      historyRecoveryEligible,
      historyRecoveryConfidence,
      effectiveProjectionDistance,
      effectiveMinTriggerDistanceMeters,
      estimatedRemainingMiles: fuelState?.estimatedRemainingMiles ?? null,
      avgIntervalMiles: fuelState?.avgIntervalMiles ?? null,
      intervalUtilization: fuelState?.avgIntervalMiles
        ? clamp((fuelState?.milesSinceLastFill || 0) / Math.max(1, fuelState.avgIntervalMiles), 0, 2)
        : null,
      profileHistoryConcentration: computeProfileHistoryConcentration(profile),
      profileStationCount: Array.isArray(profile?.visitHistory) ? profile.visitHistory.length : 0,
      profileValueSeekingScore,
      opportunisticFillScore,
      recommendationConfidence: recommendation?.confidence || 0,
    };
  }

  function finalizeRecommendation(recommendation, candidate = null) {
    if (!recommendation) return null;
    if ((recommendation.forwardDistance || 0) < effectiveMinTriggerDistanceMeters) return null;
    return {
      ...recommendation,
      fuelNeedScore,
      mlFeatures: buildMlFeatureEnvelope(candidate, recommendation),
      decisionSnapshot: buildDecisionSnapshot(candidate, recommendation),
      presentation: buildPresentationPlan(window, recommendation, candidate, opts),
    };
  }

  const baseDecisionSnapshot = buildDecisionSnapshot();
  if (typeof opts.onDecisionSnapshot === 'function') {
    opts.onDecisionSnapshot(baseDecisionSnapshot);
  }

  // If we have a strong predicted default AND there's a cheaper one on the
  // same corridor that's not too much of a detour, recommend the cheaper one.
  if (predictedDefault && predictedDefault.effectiveDestinationProbability >= 0.32) {
    if (speculativeUrbanHistoryMode) {
      return null;
    }
    const defaultPrice = Number.isFinite(Number(predictedDefault.station?.effectivePrice))
      ? Number(predictedDefault.station.effectivePrice)
      : predictedDefault.station.price;
    if (typeof defaultPrice === 'number') {
      const cheaperAlternatives = scored.filter(c =>
        typeof c.station.price === 'number' &&
        c.station.stationId !== predictedDefault.station.stationId &&
        (defaultPrice - (
          Number.isFinite(Number(c.station?.effectivePrice))
            ? Number(c.station.effectivePrice)
            : (Number(c.station.price) + (c.accessPenaltyPrice || 0))
        )) >= opts.minPriceSavingsPerGal &&
        c.alongTrack <= predictedDefault.alongTrack + Math.max(1500, effectiveProjectionDistance * 0.5) &&
        c.crossTrack <= opts.corridorHalfWidthMeters * 0.9   // clearly on-corridor
      );
      if (cheaperAlternatives.length > 0) {
        // Pick the best net-value station after subtracting maneuver friction
        // from the headline price win.
        cheaperAlternatives.sort((a, b) => {
          const ap = a.station.price + (a.accessPenaltyPrice || 0) + a.crossTrack / 7000;
          const bp = b.station.price + (b.accessPenaltyPrice || 0) + b.crossTrack / 7000;
          return ap - bp;
        });
        const best = cheaperAlternatives[0];
        const bestEffectivePrice = Number.isFinite(Number(best.station?.effectivePrice))
          ? Number(best.station.effectivePrice)
          : Number(best.station.price) + (best.accessPenaltyPrice || 0);
        const rawSavings = Number(predictedDefault.station.price) - Number(best.station.price);
        const netSavings = defaultPrice - bestEffectivePrice;
        if (netSavings < opts.minPriceSavingsPerGal) {
          return null;
        }
        const intentEvidence = Math.max(best.intentEvidence || 0, best.physicalIntentScore || 0);
        const speculativeSuppression = (
          urgency < 0.82 &&
          best.alongTrack > opts.maxSpeculativeDistanceMeters &&
          intentEvidence < 0.58
        );
        if (
          tripFuelIntentScore < tripFuelIntentThreshold ||
          (
            speculativeSuppression &&
            tripFuelIntentScore < (tripFuelIntentThreshold + 0.08)
          )
        ) {
          return null;
        }
        const historyNeedsConfirmation = (
          fuelNeedScore < opts.fuelNeedMediumThreshold &&
          historyStrength >= 0.20 &&
          predictedDefault.intentEvidence < Math.max(0.46, (intentLeader?.intentEvidence || 0) - 0.08) &&
          best.intentEvidence < Math.max(0.42, (intentLeader?.intentEvidence || 0) - 0.04) &&
          urgency < 0.88
        );
        if (historyNeedsConfirmation) {
          return null;
        }
        const weakSpecificityHistory = (
          historyStrength >= 0.35 &&
          timePatternStrength < 0.20 &&
          fuelNeedScore < 0.88
        );
        if (weakSpecificityHistory) {
          const mediumFuelNeed = fuelNeedScore >= opts.fuelNeedMediumThreshold;
          const weakSpecificityUrbanHistory = !isHighwayCruise && historyStrength >= 0.45;
          if (
            best.alongTrack > opts.weakPatternHistoryMaxDistanceMeters ||
            tripFuelIntentScore < (tripFuelIntentThreshold + opts.weakPatternHistoryIntentBuffer - (mediumFuelNeed ? opts.lowSpecificityFuelNeedBuffer : 0)) ||
            Math.max(predictedDefault.intentEvidence, fuelNeedScore) < (mediumFuelNeed ? opts.weakPatternHistoryMinIntentEvidence - 0.06 : opts.weakPatternHistoryMinIntentEvidence) ||
            best.intentEvidence < Math.max(0.42, (mediumFuelNeed ? opts.weakPatternHistoryMinIntentEvidence - 0.08 : opts.weakPatternHistoryMinIntentEvidence - 0.02)) ||
            (
              weakSpecificityUrbanHistory && (
                fuelNeedScore < 0.55 ||
                tripFuelIntentScore < (tripFuelIntentThreshold + 0.10) ||
                Math.max(predictedDefault.intentEvidence, best.intentEvidence) < 0.60
              )
            )
          ) {
            return null;
          }
        }

        const urgencyFactor = clamp(urgency / 0.6 + 0.3, 0.3, 1.0);
        const savingsFactor = clamp(netSavings / 0.5, 0.3, 1.0);
        const pathFactor = clamp(1 - best.crossTrack / opts.corridorHalfWidthMeters, 0, 1);
        const intentFactor = clamp(predictedDefault.effectiveDestinationProbability, 0.32, 1.0);
        const earlyFactor = clamp(best.alongTrack / effectiveProjectionDistance, 0, 1);
        const accessFactor = clamp(1 - (best.accessPenaltyPrice || 0) / Math.max(0.01, opts.uTurnLikePenaltyPeak), 0, 1);
        const liveIntentFactor = clamp(best.intentEvidence, 0, 1);
        const confidence = clamp(
          urgencyFactor * 0.22 +
          savingsFactor * 0.28 +
          pathFactor * 0.15 +
          intentFactor * 0.14 +
          liveIntentFactor * 0.16 +
          earlyFactor * 0.05 +
          accessFactor * 0.08,
          0, 1
        );

        if (confidence >= opts.triggerThreshold) {
          return finalizeRecommendation({
            stationId: best.station.stationId,
            type: 'cheaper_alternative',
            confidence,
            reason: `$${netSavings.toFixed(2)}/gal net cheaper than ${predictedDefault.station.brand || predictedDefault.station.stationId}, ${Math.round(best.alongTrack)}m ahead`,
            forwardDistance: best.alongTrack,
            predictedDefault: predictedDefault.station.stationId,
            savings: netSavings,
            rawSavings,
            accessPenaltyPrice: best.accessPenaltyPrice || 0,
            detourExtraMeters: Math.max(0, best.alongTrack - predictedDefault.alongTrack),
            defaultProbability: predictedDefault.effectiveDestinationProbability,
            stationSide: (best.signedCrossTrack || 0) > 0 ? 'left' : 'right',
          }, best);
        }
      }
    }
  }

  const shouldSuppressDefaultForCheaperOption = Boolean(
    predictedDefault &&
    typeof predictedDefault.station?.price === 'number' &&
    scored.some(candidate =>
      candidate.station.stationId !== predictedDefault.station.stationId &&
      typeof candidate.station?.price === 'number' &&
      ((
        (Number.isFinite(Number(predictedDefault.station?.effectivePrice))
          ? Number(predictedDefault.station.effectivePrice)
          : Number(predictedDefault.station.price)) -
        (Number.isFinite(Number(candidate.station?.effectivePrice))
          ? Number(candidate.station.effectivePrice)
          : (Number(candidate.station.price) + (candidate.accessPenaltyPrice || 0)))
      )) >= opts.minPriceSavingsPerGal &&
      candidate.crossTrack <= opts.corridorHalfWidthMeters * 0.95 &&
      candidate.alongTrack >= effectiveMinTriggerDistanceMeters
    )
  );

  // Fall-through: predicted-stop mode. If we have a high-probability default
  // station ahead and no better alternative, still surface the info so the
  // driver knows the app is tracking them — this is the "confirm the plan"
  // notification.
  if (predictedDefault && !shouldSuppressDefaultForCheaperOption) {
    if (speculativeUrbanHistoryMode) {
      return null;
    }
    const insufficientLiveIntent = (
      tripFuelIntentScore < tripFuelIntentThreshold ||
      (
        urgency < 0.82 &&
        predictedDefault.alongTrack > opts.maxSpeculativeDistanceMeters &&
        predictedDefault.intentEvidence < 0.54 &&
        tripFuelIntentScore < (tripFuelIntentThreshold + 0.08)
      )
    );
    if (insufficientLiveIntent) {
      return null;
    }
    const historyNeedsConfirmation = (
      fuelNeedScore < opts.fuelNeedMediumThreshold &&
      historyStrength >= 0.20 &&
      predictedDefault.intentEvidence < Math.max(
        historyStrength >= 0.45 ? 0.50 : 0.44,
        (intentLeader?.intentEvidence || 0) - (historyStrength >= 0.45 ? 0.04 : 0.06)
      ) &&
      predictedDefault.valueScore < (historyStrength >= 0.45 ? 0.52 : 0.42) &&
      urgency < 0.88
    );
    if (historyNeedsConfirmation) {
      return null;
    }
    const weakSpecificityHistory = (
      historyStrength >= 0.35 &&
      timePatternStrength < 0.20 &&
      fuelNeedScore < 0.88
    );
    const speculativeWeakHistoryCityGuard = (
      !isHighwayCruise &&
      historyStrength >= 0.45 &&
      timePatternStrength < 0.20 &&
      predictedDefault.alongTrack > opts.strongSpeculativeDistanceMeters &&
      fuelNeedScore < opts.turnInCommitmentHistoryAssistFuelNeed
    );
    if (speculativeWeakHistoryCityGuard) {
      return null;
    }
    if (weakSpecificityHistory) {
      const mediumFuelNeed = fuelNeedScore >= opts.fuelNeedMediumThreshold;
      const weakSpecificityUrbanHistory = !isHighwayCruise && historyStrength >= 0.45;
      if (
        predictedDefault.alongTrack > opts.weakPatternHistoryMaxDistanceMeters ||
        tripFuelIntentScore < (tripFuelIntentThreshold + opts.weakPatternHistoryIntentBuffer - (mediumFuelNeed ? opts.lowSpecificityFuelNeedBuffer : 0)) ||
        Math.max(predictedDefault.intentEvidence, fuelNeedScore) < (mediumFuelNeed ? opts.weakPatternHistoryMinIntentEvidence - 0.06 : opts.weakPatternHistoryMinIntentEvidence) ||
        (
          weakSpecificityUrbanHistory && (
            fuelNeedScore < 0.55 ||
            tripFuelIntentScore < (tripFuelIntentThreshold + 0.10) ||
            predictedDefault.intentEvidence < 0.60
          )
        )
      ) {
        return null;
      }
    }
    const diffuseHistoryDominatedCandidate = (
      historyStrength >= 0.20 &&
      fuelNeedScore < 0.30 &&
      (predictedDefault.visitShare || 0) < 0.08 &&
      computeProfileHistoryConcentration(profile) < 0.34 &&
      (predictedDefault.valueScore || 0) < 0.30 &&
      !predictedDefault.station?.routeApproach?.isOnRoute &&
      leadMargin < 0.10 &&
      predictedDefault.alongTrack <= Math.min(4500, effectiveProjectionDistance * 0.45)
    );
    if (diffuseHistoryDominatedCandidate) {
      return null;
    }
    const minimumProbability = historyStrength >= 0.20
      ? Math.max(0.52, opts.triggerThreshold - 0.04)
      : opts.coldStartThreshold;
    if (
      isHighwayCruise &&
      historyStrength < 0.20 &&
      scored.length < 2 &&
      predictedDefault.alongTrack > 6000
    ) {
      return null;
    }
    const dominanceFactor = clamp(leadMargin / Math.max(opts.coldStartLeadMargin, 0.01), 0, 1);
    const pathFactor = clamp(1 - predictedDefault.crossTrack / opts.corridorHalfWidthMeters, 0, 1);
    const urgencyFactor = clamp(urgency / 0.65, 0, 1);
    const earlyFactor = clamp(predictedDefault.alongTrack / effectiveProjectionDistance, 0, 1);
    const liveIntentFactor = clamp(predictedDefault.intentEvidence, 0, 1);
    const confidence = clamp(
      predictedDefault.effectiveDestinationProbability * 0.24 +
      predictedDefault.coldStartScore * 0.18 +
      pathFactor * 0.14 +
      dominanceFactor * 0.10 +
      liveIntentFactor * 0.24 +
      urgencyFactor * 0.06 +
      earlyFactor * 0.04,
      0,
      1
    );
    if (lowSpecificityColdStart) {
      const coldStartBrandValueSignal = (
        predictedBrandAffinity >= 0.45 &&
        (predictedDefault.valueScore || 0) >= opts.lowSpecificityColdStartBrandValueFloor
      );
      const mediumFuelNeed = fuelNeedScore >= opts.fuelNeedMediumThreshold;
      if (
        (!coldStartBrandValueSignal && !mediumFuelNeed) ||
        predictedDefault.alongTrack > opts.lowSpecificityColdStartMaxDistanceMeters ||
        tripFuelIntentScore < (tripFuelIntentThreshold + opts.lowSpecificityColdStartIntentBuffer - (mediumFuelNeed ? opts.lowSpecificityFuelNeedBuffer : 0)) ||
        Math.max(predictedDefault.intentEvidence, fuelNeedScore) < (mediumFuelNeed ? opts.lowSpecificityColdStartMinIntentEvidence - 0.06 : opts.lowSpecificityColdStartMinIntentEvidence) ||
        confidence < Math.max(opts.triggerThreshold, opts.lowSpecificityColdStartMinConfidence)
      ) {
        return null;
      }
    }
    if (predictedDefault.effectiveDestinationProbability >= minimumProbability && confidence >= opts.triggerThreshold) {
      return finalizeRecommendation({
        stationId: predictedDefault.station.stationId,
        type: historyStrength >= 0.20 ? 'predicted_stop' : 'cold_start_best_value',
        confidence,
        reason: historyStrength >= 0.20
          ? `Predicted stop (${Math.round(predictedDefault.effectiveDestinationProbability * 100)}% match)`
          : `Best stop ahead (${Math.round(predictedDefault.effectiveDestinationProbability * 100)}% fit, ${Math.round(predictedDefault.alongTrack)}m out)`,
        forwardDistance: predictedDefault.alongTrack,
        predictedDefault: predictedDefault.station.stationId,
        savings: 0,
      }, predictedDefault);
    }
  }

  if (
    historyRecoveryEligible &&
    predictedDefault &&
    !shouldSuppressDefaultForCheaperOption &&
    historyRecoveryConfidence >= Math.max(opts.historyRecoveryMinConfidence, opts.triggerThreshold - 0.18)
  ) {
    return finalizeRecommendation({
      stationId: predictedDefault.station.stationId,
      type: 'history_recovery_stop',
      confidence: historyRecoveryConfidence,
      reason: `History-backed stop ahead (${Math.round(historyRecoveryConfidence * 100)}% confidence)`,
      forwardDistance: predictedDefault.alongTrack,
      predictedDefault: predictedDefault.station.stationId,
      savings: 0,
    }, predictedDefault);
  }

  const weakContextualHistoryMode = Boolean(
    predictedDefault &&
    historyStrength >= 0.20 &&
    historyStrength < 0.38 &&
    timePatternStrength < 0.20 &&
    (predictedDefault.historyContextMatch || 0) < 0.38 &&
    profileValueSeekingScore >= 0.40
  );

  if ((historyStrength < 0.20 || weakContextualHistoryMode) && scored.length >= 2) {
    const coldStartRanked = [...scored]
      .filter(candidate => candidate.alongTrack >= effectiveMinTriggerDistanceMeters)
      .map(candidate => {
        const pathFit = clamp(1 - candidate.crossTrack / opts.corridorHalfWidthMeters, 0, 1);
        return {
          ...candidate,
          coldStartChoiceScore: clamp(
            (candidate.coldStartScore * 0.46) +
            ((candidate.valueScore || 0) * 0.24) +
            ((candidate.intentEvidence || 0) * 0.20) +
            (pathFit * 0.10),
            0,
            1
          ),
        };
      })
      .sort((a, b) => b.coldStartChoiceScore - a.coldStartChoiceScore);
    const bestColdStart = coldStartRanked[0] || null;
    const nextColdStart = coldStartRanked[1] || null;
      if (bestColdStart) {
      const bestColdStartLowSpecificity = (
        timePatternStrength < 0.20 &&
        fuelNeedScore < 0.88 &&
        !isHighwayCruise
      );
      const coldStartLead = bestColdStart.coldStartChoiceScore - (nextColdStart?.coldStartChoiceScore || 0);
      const coldStartNetAdvantage = nextColdStart
        ? Math.max(0, (nextColdStart.netStationCost || 0) - (bestColdStart.netStationCost || 0))
        : 0;
      const coldStartConfidence = clamp(
        (bestColdStart.coldStartScore * 0.30) +
        ((bestColdStart.intentEvidence || 0) * 0.24) +
        ((bestColdStart.valueScore || 0) * 0.20) +
        (clamp(coldStartLead / 0.10, 0, 1) * 0.16) +
        (clamp(coldStartNetAdvantage / 0.20, 0, 1) * 0.10),
        0,
        1
      );
      const coldStartLeadFloor = weakContextualHistoryMode
        ? Math.max(0.02, opts.minColdStartBranchLead - 0.03)
        : Math.max(opts.coldStartLeadMargin, opts.minColdStartBranchLead);
      const coldStartValueEdgeFloor = weakContextualHistoryMode
        ? Math.max(0.10, opts.minColdStartBranchValueEdge - 0.05)
        : opts.minColdStartBranchValueEdge;
      const coldStartEligible = (
        tripFuelIntentScore >= Math.max(
          isHighwayCruise ? opts.minColdStartBranchTripFuelIntentHighway : opts.minColdStartBranchTripFuelIntent,
          weakContextualHistoryMode ? (tripFuelIntentThreshold - 0.04) : tripFuelIntentThreshold
        ) &&
        bestColdStart.coldStartScore >= opts.coldStartThreshold &&
        coldStartLead >= coldStartLeadFloor &&
        (
          coldStartNetAdvantage >= opts.minPriceSavingsPerGal ||
          (bestColdStart.valueScore || 0) >= ((nextColdStart?.valueScore || 0) + coldStartValueEdgeFloor)
        ) &&
        coldStartConfidence >= (weakContextualHistoryMode ? (opts.triggerThreshold - 0.04) : opts.triggerThreshold)
      );
      if (bestColdStartLowSpecificity) {
        const coldStartBrandValueSignal = (
          (bestColdStart.brandAffinity || 0) >= 0.45 &&
          (bestColdStart.valueScore || 0) >= opts.lowSpecificityColdStartBrandValueFloor
        );
        const mediumFuelNeed = fuelNeedScore >= opts.fuelNeedMediumThreshold;
        if (
          (!coldStartBrandValueSignal && !mediumFuelNeed) ||
          bestColdStart.alongTrack > opts.lowSpecificityColdStartMaxDistanceMeters ||
          tripFuelIntentScore < (tripFuelIntentThreshold + opts.lowSpecificityColdStartIntentBuffer - (mediumFuelNeed ? opts.lowSpecificityFuelNeedBuffer : 0)) ||
          Math.max(bestColdStart.intentEvidence || 0, fuelNeedScore) < (mediumFuelNeed ? opts.lowSpecificityColdStartMinIntentEvidence - 0.06 : opts.lowSpecificityColdStartMinIntentEvidence) ||
          coldStartConfidence < Math.max(opts.triggerThreshold, opts.lowSpecificityColdStartMinConfidence)
        ) {
          return null;
        }
      }
      if (coldStartEligible) {
        return finalizeRecommendation({
          stationId: bestColdStart.station.stationId,
          type: 'cold_start_best_value',
          confidence: coldStartConfidence,
          reason: `Best stop ahead (${Math.round(bestColdStart.coldStartChoiceScore * 100)}% fit, ${Math.round(bestColdStart.alongTrack)}m out)`,
          forwardDistance: bestColdStart.alongTrack,
          predictedDefault: bestColdStart.station.stationId,
          savings: 0,
        }, bestColdStart);
      }
    }
  }

  const bestByValue = [...scored].sort((left, right) =>
    (right.valueScore || 0) - (left.valueScore || 0) ||
    (right.intentEvidence || 0) - (left.intentEvidence || 0)
  )[0] || null;
  const runnerUpByValue = [...scored].sort((left, right) =>
    (right.valueScore || 0) - (left.valueScore || 0) ||
    (right.intentEvidence || 0) - (left.intentEvidence || 0)
  )[1] || null;
  if (bestByValue && bestByValue.alongTrack >= effectiveMinTriggerDistanceMeters) {
    const valueEdge = (bestByValue.valueScore || 0) - (runnerUpByValue?.valueScore || 0);
    const netCostAdvantage = runnerUpByValue
      ? Math.max(0, (runnerUpByValue.netStationCost || 0) - (bestByValue.netStationCost || 0))
      : 0;
    const contextualHistorySupport = Math.max(
      bestByValue.contextualHistoryScore || 0,
      bestByValue.historyContextMatch || 0
    );
    const profileAlignedValueSupport = Math.max(
      bestByValue.brandAffinity || 0,
      profileValueSeekingScore
    );
    const opportunisticIntentSupport = clamp(
      (tripFuelIntentScore * 0.34) +
      ((bestByValue.intentEvidence || 0) * 0.24) +
      ((bestByValue.valueScore || 0) * 0.20) +
      (profileAlignedValueSupport * 0.14) +
      (contextualHistorySupport * 0.08),
      0,
      1
    );
    const opportunisticValueEligible = (
      fuelNeedScore < opts.fuelNeedHighThreshold &&
      Math.max(profileValueSeekingScore, opportunisticFillScore, bestByValue.brandAffinity || 0) >= 0.45 &&
      (bestByValue.valueScore || 0) >= 0.72 &&
      valueEdge >= 0.12 &&
      netCostAdvantage >= Math.max(0.08, opts.minPriceSavingsPerGal) &&
      bestByValue.alongTrack <= (isHighwayCruise ? 11_000 : 6_500) &&
      tripFuelIntentScore >= Math.max(0.30, tripFuelIntentThreshold - 0.08) &&
      (bestByValue.intentEvidence || 0) >= 0.48 &&
      (
        historyStrength < 0.20 ||
        contextualHistorySupport >= 0.18 ||
        (bestByValue.brandAffinity || 0) >= 0.45
      ) &&
      opportunisticIntentSupport >= Math.max(opts.triggerThreshold - 0.08, 0.44)
    );
    if (opportunisticValueEligible) {
      return finalizeRecommendation({
        stationId: bestByValue.station.stationId,
        type: 'predicted_stop',
        confidence: opportunisticIntentSupport,
        reason: `High-value stop ahead (${Math.round(opportunisticIntentSupport * 100)}% confidence, ${Math.round(bestByValue.alongTrack)}m out)`,
        forwardDistance: bestByValue.alongTrack,
        predictedDefault: bestByValue.station.stationId,
        savings: netCostAdvantage,
        accessPenaltyPrice: bestByValue.accessPenaltyPrice || 0,
        stationSide: (bestByValue.signedCrossTrack || 0) > 0 ? 'left' : 'right',
      }, bestByValue);
    }
  }

  if (scored.length === 1) {
    const onlyCandidate = scored[0];
    const captureScore = clamp(Number(onlyCandidate?.physicalFeatures?.captureScore) || 0, 0, 1);
    const singleCandidateConfidence = clamp(
      (onlyCandidate.physicalIntentScore * 0.40) +
      (captureScore * 0.22) +
      ((onlyCandidate.intentEvidence || 0) * 0.18) +
      (fuelNeedScore * 0.12) +
      ((onlyCandidate.valueScore || 0) * 0.08),
      0,
      1
    );
    if (
      fuelNeedScore >= opts.fuelNeedMediumThreshold &&
      onlyCandidate.alongTrack >= effectiveMinTriggerDistanceMeters &&
      onlyCandidate.alongTrack <= opts.singleCandidateTurnInMaxDistanceMeters &&
      onlyCandidate.physicalIntentScore >= opts.singleCandidateTurnInMinPhysicalIntent &&
      captureScore >= opts.singleCandidateTurnInMinCapture &&
      singleCandidateConfidence >= Math.max(opts.triggerThreshold, opts.singleCandidateTurnInMinConfidence)
    ) {
      return finalizeRecommendation({
        stationId: onlyCandidate.station.stationId,
        type: historyStrength >= 0.20 ? 'predicted_stop' : 'cold_start_best_value',
        confidence: singleCandidateConfidence,
        reason: `Likely turn-in stop (${Math.round(singleCandidateConfidence * 100)}% confidence, ${Math.round(onlyCandidate.alongTrack)}m out)`,
        forwardDistance: onlyCandidate.alongTrack,
        predictedDefault: onlyCandidate.station.stationId,
        savings: 0,
      }, onlyCandidate);
    }
  }

  const rankedByTurnInCommitment = [...scored]
    .map(candidate => ({
      ...candidate,
      turnInCommitmentScore: computeTurnInCommitmentScore(candidate),
    }))
    .sort((a, b) =>
      (b.turnInCommitmentScore || 0) - (a.turnInCommitmentScore || 0) ||
      (b.physicalIntentScore || 0) - (a.physicalIntentScore || 0)
    );
  const turnInLeader = rankedByTurnInCommitment[0] || null;
  const turnInRunnerUp = rankedByTurnInCommitment[1] || null;
  if (turnInLeader) {
    const turnInCapture = clamp(Number(turnInLeader?.physicalFeatures?.captureScore) || 0, 0, 1);
    const turnInApproach = clamp(Number(turnInLeader?.physicalFeatures?.approachScore) || 0, 0, 1);
    const turnInPath = clamp(Number(turnInLeader?.physicalFeatures?.pathScore) || 0, 0, 1);
    const turnInDecel = clamp(Number(turnInLeader?.physicalFeatures?.decelScore) || 0, 0, 1);
    const turnInDominance = clamp(
      (turnInLeader.turnInCommitmentScore || 0) - (turnInRunnerUp?.turnInCommitmentScore || 0),
      0,
      1
    );
    const historyStrengthSupport = Math.max(
      historyStrength,
      Number(turnInLeader.historyStrength) || 0
    );
    const historyOrNeedSupportsTurnIn = (
      fuelNeedScore >= opts.turnInCommitmentMinFuelNeed ||
      (
        fuelNeedScore >= opts.turnInCommitmentHistoryAssistFuelNeed &&
        historyStrengthSupport >= opts.turnInCommitmentMinHistoryStrength
      )
    );
    const turnInValueFloor = isHighwayCruise
      ? opts.turnInCommitmentMinValueScoreHighway
      : opts.turnInCommitmentMinValueScoreCity;
    if (
      historyOrNeedSupportsTurnIn &&
      turnInLeader.alongTrack >= effectiveMinTriggerDistanceMeters &&
      turnInLeader.alongTrack <= opts.turnInCommitmentMaxDistanceMeters &&
      turnInLeader.crossTrack <= opts.turnInCommitmentMaxCrossTrackMeters &&
      turnInLeader.physicalIntentScore >= opts.turnInCommitmentMinPhysicalIntent &&
      turnInLeader.turnInCommitmentScore >= opts.turnInCommitmentMinScore &&
      turnInApproach >= opts.turnInCommitmentMinApproach &&
      turnInPath >= opts.turnInCommitmentMinPath &&
      turnInDominance >= opts.turnInCommitmentMinDominance &&
      (turnInLeader.valueScore || 0) >= turnInValueFloor &&
      (
        isHighwayCruise
          ? turnInDecel >= opts.turnInCommitmentMinDecel
          : turnInCapture >= opts.turnInCommitmentMinCapture
      )
    ) {
      const commitmentConfidence = clamp(
        (turnInLeader.turnInCommitmentScore * 0.62) +
        (Math.max(fuelNeedScore, turnInLeader.historyStrength || 0) * 0.18) +
        (turnInDominance * 0.12) +
        ((turnInLeader.valueScore || 0) * 0.08),
        0,
        1
      );
      if (commitmentConfidence >= opts.triggerThreshold) {
        return finalizeRecommendation({
          stationId: turnInLeader.station.stationId,
          type: 'turn_in_commitment',
          confidence: commitmentConfidence,
          reason: `Likely committed turn-in (${Math.round(commitmentConfidence * 100)}% confidence, ${Math.round(turnInLeader.alongTrack)}m out)`,
          forwardDistance: turnInLeader.alongTrack,
          predictedDefault: turnInLeader.station.stationId,
          savings: 0,
        }, turnInLeader);
      }
    }
  }

  // Urgent-any mode: tank is near-empty, any station on the corridor is good.
  if (urgency >= opts.urgencyOnlyThreshold && isHighwayCruise) {
    // In urgent highway mode we still want the best viable value on-route,
    // not simply the very first station encountered.
    const sorted = [...scored].sort((a, b) => {
      const pa = Number.isFinite(Number(a.netStationCost))
        ? Number(a.netStationCost)
        : ((a.station.price || 99) + (a.alongTrack / 50000));
      const pb = Number.isFinite(Number(b.netStationCost))
        ? Number(b.netStationCost)
        : ((b.station.price || 99) + (b.alongTrack / 50000));
      return pa - pb || (a.alongTrack - b.alongTrack);
    });
    const pick = sorted[0];
    const urgentCityGuard = (
      !isHighwayCruise &&
      (
        urgency < 0.9 ||
        pick?.coldStartScore < Math.max(0.62, opts.coldStartThreshold + 0.10) ||
        leadMargin < Math.max(0.08, opts.coldStartLeadMargin)
      )
    );
    if (pick && !urgentCityGuard && (isHighwayCruise || pick.coldStartScore >= opts.coldStartThreshold - 0.08)) {
      const confidence = clamp(
        0.25 +
        (urgency * 0.42) +
        (pick.coldStartScore * 0.18) +
        (isHighwayCruise ? 0.10 : 0),
        0,
        1
      );
      if (confidence >= opts.triggerThreshold) {
        return finalizeRecommendation({
          stationId: pick.station.stationId,
          type: 'urgent_any',
          confidence,
          reason: `Low fuel — station ${Math.round(pick.alongTrack)}m ahead`,
          forwardDistance: pick.alongTrack,
          savings: 0,
        }, pick);
      }
    }
  }

  return null;
}

/**
 * Create a stateful recommender that tracks per-station cooldowns so the same
 * station isn't recommended repeatedly. Usage mirrors the engine:
 *
 *   const rec = createPredictiveRecommender({ cooldownMs: 600000 });
 *   rec.setStations(stations);
 *   rec.setProfile(profile);
 *   rec.pushLocation(sample) → null | recommendation
 */
function createPredictiveRecommender(options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let window = [];
  let stations = [];
  let profile = null;
  let lastSample = null;
  let milesSinceLastFill = null;
  const cooldowns = new Map(); // stationId -> expiry ms
  const firedEvents = []; // history of all recommendations this session
  let pendingRecommendation = null;
  let recommendationCandidate = null;
  const enforcePresentationTiming = Boolean(opts.enforcePresentationTiming);

  function getTotalHistoryVisits() {
    if (!profile || !Array.isArray(profile.visitHistory)) return 0;
    return profile.visitHistory.reduce((sum, entry) => sum + (Number(entry?.visitCount) || 0), 0);
  }

  function initializeFuelStateFromProfile(nextProfile) {
    if (Number.isFinite(Number(nextProfile?.estimatedMilesSinceLastFill))) {
      return Number(nextProfile.estimatedMilesSinceLastFill);
    }
    const fillUpHistory = Array.isArray(nextProfile?.fillUpHistory) ? nextProfile.fillUpHistory : [];
    if (fillUpHistory.length === 0) {
      return null;
    }
    return estimateFuelState(fillUpHistory, {
      typicalIntervalMiles: nextProfile?.typicalFillUpIntervalMiles,
    }).milesSinceLastFill;
  }

  function updateFuelState(sample) {
    if (!lastSample) {
      lastSample = sample;
      return;
    }
    const elapsedMs = Math.max(0, Number(sample?.timestamp) - Number(lastSample?.timestamp));
    const deltaMeters = haversineDistanceMeters(
      { latitude: lastSample.latitude, longitude: lastSample.longitude },
      { latitude: sample.latitude, longitude: sample.longitude }
    );
    lastSample = sample;
    if (!Number.isFinite(deltaMeters) || deltaMeters <= 3 || deltaMeters > 2500) {
      return;
    }
    if (elapsedMs > 0) {
      const inferredSpeed = deltaMeters / (elapsedMs / 1000);
      if (inferredSpeed > opts.maxDrivingSpeedMps * 1.5) {
        return;
      }
    }
    if (milesSinceLastFill == null) {
      milesSinceLastFill = initializeFuelStateFromProfile(profile) || 0;
    }
    milesSinceLastFill += deltaMeters / 1609.344;
  }

  function getRequiredConsistencyCount(recommendation) {
    if (!recommendation) return opts.minStableRecommendationCount;
    const fuelNeed = clamp(Number(recommendation.fuelNeedScore) || 0, 0, 1);
    if (recommendation.type === 'urgent_any') {
      return opts.minStableRecommendationCountUrgent;
    }
    if (recommendation.type === 'turn_in_commitment') {
      return opts.minStableRecommendationCountCommitment;
    }
    const hasHistory = getTotalHistoryVisits() > 0;
    let required = hasHistory
      ? opts.minStableRecommendationCountWithHistory
      : opts.minStableRecommendationCount;
    if (recommendation.type === 'cheaper_alternative') {
      required = hasHistory
        ? Math.max(2, opts.minStableRecommendationCountWithHistory - 1)
        : opts.minStableRecommendationCount;
    }
    if (fuelNeed >= opts.fuelNeedHighThreshold) {
      return Math.max(1, required - 2);
    }
    if (fuelNeed >= opts.fuelNeedMediumThreshold) {
      return Math.max(2, required - 1);
    }
    return required;
  }

  function pushLocation(sample, extraContext = {}) {
    window.push(sample);
    const windowCap = opts.windowCap || 20;
    if (window.length > windowCap) window = window.slice(window.length - windowCap);
    updateFuelState(sample);

    const nowMs = sample.timestamp || Date.now();
    const recommendation = recommend(window, profile, stations, {
      ...opts,
      milesSinceLastFill,
      ...extraContext,
    });
    if (!recommendation) {
      recommendationCandidate = null;
      return null;
    }

    const consistencyKey = `${recommendation.stationId}:${recommendation.type}`;
    if (recommendationCandidate?.key === consistencyKey) {
      recommendationCandidate = {
        ...recommendationCandidate,
        streak: recommendationCandidate.streak + 1,
        lastSeenAt: nowMs,
        recommendation,
      };
    } else {
      recommendationCandidate = {
        key: consistencyKey,
        streak: 1,
        firstSeenAt: nowMs,
        lastSeenAt: nowMs,
        recommendation,
      };
    }

    if (recommendationCandidate.streak < getRequiredConsistencyCount(recommendation)) {
      return null;
    }

    if (enforcePresentationTiming && !recommendation.presentation?.surfaceNow) {
      pendingRecommendation = {
        ...recommendation,
        pendingSince: pendingRecommendation?.stationId === recommendation.stationId
          ? pendingRecommendation.pendingSince
          : nowMs,
      };
      return null;
    }

    const expiry = cooldowns.get(recommendation.stationId) || 0;
    if (nowMs < expiry) return null;
    const triggerDistance = recommendation.forwardDistance;
    const event = {
      ...recommendation,
      triggeredAt: nowMs,
      triggerDistance,
      location: sample,
      historyVisitCount: getTotalHistoryVisits(),
      milesSinceLastFill,
      tripDurationSeconds: Math.round(computeTripDurationMs(window) / 1000),
      meanSpeedMps: computeMeanSpeed(window),
      recommendationStreak: recommendationCandidate.streak,
    };
    if (opts.mlGate && typeof opts.mlGate.evaluate === 'function') {
      const gateDecision = opts.mlGate.evaluate({
        event,
        recommendation,
        sample,
        window: window.slice(),
        profile,
        stations,
        milesSinceLastFill,
        historyVisitCount: event.historyVisitCount,
      }) || null;
      if (gateDecision?.allow === false) {
        return null;
      }
      if (Number.isFinite(Number(gateDecision?.score))) {
        event.mlGateScore = Number(gateDecision.score);
      }
      if (typeof gateDecision?.model === 'string' && gateDecision.model) {
        event.mlGateModel = gateDecision.model;
      }
    }
    cooldowns.set(recommendation.stationId, nowMs + opts.cooldownMs);
    firedEvents.push(event);
    pendingRecommendation = null;
    recommendationCandidate = null;
    if (typeof opts.onTrigger === 'function') {
      opts.onTrigger(event);
    }
    return event;
  }

  return {
    setStations(s) { stations = s || []; },
    setProfile(p) {
      profile = p;
      milesSinceLastFill = initializeFuelStateFromProfile(profile);
    },
    pushLocation,
    reset() {
      window = [];
      lastSample = null;
      milesSinceLastFill = initializeFuelStateFromProfile(profile);
      cooldowns.clear();
      firedEvents.length = 0;
      pendingRecommendation = null;
      recommendationCandidate = null;
    },
    getEvents() { return firedEvents.slice(); },
    getWindow() { return window.slice(); },
    getPendingRecommendation() { return pendingRecommendation ? { ...pendingRecommendation } : null; },
  };
}

module.exports = {
  createPredictiveRecommender,
  recommend,
  buildPresentationPlan,
  findCorridorCandidates,
  scoreDestinationLikelihood,
  computeAccessPenaltyPrice,
  isPeakTrafficTime,
  computeSmoothedHeading,
  projectStation,
  inferTrafficPause,
  computeRoadComplexity,
  DEFAULT_OPTIONS,
};
