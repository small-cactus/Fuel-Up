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
const {
  computeRouteHabitShareForKeys,
  computeRouteStationObservedMetricsForKeys,
} = require('./routeHabit.js');
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
  visiblePriceLeaderTolerancePerGal: 0.03,
  estimatedSavingsRecentFillWindow: 6,
  estimatedSavingsMinRecentFills: 2,
  estimatedSavingsMaxHistoryDelta: 0.50,
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
  enableNoHistoryColdStartGuard: false,
  noHistoryColdStartMinNetSavings: 0.08,
  noHistoryColdStartMaxDistanceMeters: 4000,
  noHistoryColdStartMinLeadMargin: 0.06,
  noHistoryColdStartSingleCandidateMinFuelNeed: 0.42,
  enableNoHistoryStrongSingleCandidateRecovery: false,
  noHistoryStrongSingleCandidateRecoveryMaxDistanceMeters: 2200,
  noHistoryStrongSingleCandidateRecoveryMinFuelNeed: 0.26,
  noHistoryStrongSingleCandidateRecoveryMinTripFuelIntentScore: 0.74,
  noHistoryStrongSingleCandidateRecoveryMinTripFuelIntentSurplus: 0.42,
  noHistoryStrongSingleCandidateRecoveryMinIntentEvidence: 0.68,
  noHistoryStrongSingleCandidateRecoveryMinEffectiveProbability: 0.24,
  noHistoryStrongSingleCandidateRecoveryMaxObservedSkip: 0.12,
  enableNoHistoryLatePendingForceRelease: false,
  noHistoryLatePendingForceReleaseMaxDistanceMeters: 1400,
  noHistoryLatePendingForceReleaseMinFuelNeed: 0.26,
  noHistoryLatePendingForceReleaseMinTripFuelIntentScore: 0.48,
  noHistoryLatePendingForceReleaseMinTripFuelIntentSurplus: 0.22,
  noHistoryLatePendingForceReleaseMinIntentEvidence: 0.44,
  noHistoryLatePendingForceReleaseMinEffectiveProbability: 0.22,
  enableLearnedLatePendingForceRelease: false,
  learnedLatePendingForceReleaseMaxDistanceMeters: 1300,
  learnedLatePendingForceReleaseMaxCandidateCount: 1,
  learnedLatePendingForceReleaseMinTripFuelIntentScore: 0.70,
  learnedLatePendingForceReleaseMinIntentEvidence: 0.65,
  learnedLatePendingForceReleaseMinEffectiveProbability: 0.18,
  learnedLatePendingForceReleaseMinVisitShare: 0.50,
  learnedLatePendingForceReleaseMinObservedConversionRate: 0.17,
  learnedLatePendingForceReleaseMinContextualObservedConversionRate: 0.20,
  learnedLatePendingForceReleaseMaxObservedSkip: 0.40,
  enableNoHistoryValueLeaderRecovery: false,
  noHistoryValueLeaderRecoveryMaxCandidateCount: 2,
  noHistoryValueLeaderRecoveryMaxDistanceMeters: 4500,
  noHistoryValueLeaderRecoveryMinFuelNeed: 0.38,
  noHistoryValueLeaderRecoveryMinTripFuelIntentScore: 0.74,
  noHistoryValueLeaderRecoveryMinTripFuelIntentSurplus: 0.40,
  noHistoryValueLeaderRecoveryMinIntentEvidence: 0.68,
  noHistoryValueLeaderRecoveryMinEffectiveProbability: 0.40,
  noHistoryValueLeaderRecoveryMinLeadMargin: 0.12,
  noHistoryValueLeaderRecoveryMinValueAdvantage: 0.60,
  noHistoryValueLeaderRecoveryMinIntentAdvantage: 0.05,
  noHistoryShortRangeCompetitiveColdStartMaxCandidateCount: 2,
  noHistoryShortRangeCompetitiveColdStartMaxDistanceMeters: 1800,
  noHistoryShortRangeCompetitiveColdStartMaxFuelNeed: 0.40,
  noHistoryShortRangeCompetitiveColdStartMaxTripDemandPressure: 0.08,
  noHistoryShortRangeCompetitiveColdStartMinEffectiveProbability: 0.30,
  noHistoryShortRangeCompetitiveColdStartMinValueScore: 0.95,
  enableNoHistoryFarValueLeaderGuard: false,
  noHistoryFarValueLeaderGuardMinCandidateCount: 4,
  noHistoryFarValueLeaderGuardMaxFuelNeed: 0.45,
  noHistoryFarValueLeaderGuardMaxTripFuelIntentScore: 0.65,
  noHistoryFarValueLeaderGuardMinSelectedDistanceMeters: 7000,
  noHistoryFarValueLeaderGuardMinDistanceLeadMeters: 2000,
  noHistoryFarValueLeaderGuardMaxProbabilityGap: 0.08,
  noHistoryFarValueLeaderGuardMinIntentAdvantage: 0.08,
  enableZeroSavingsColdStartGuard: false,
  zeroSavingsColdStartMaxSavings: 0.02,
  zeroSavingsColdStartMaxFuelNeed: 0.45,
  zeroSavingsColdStartMinObservedSkip: 0.28,
  zeroSavingsColdStartMaxProbability: 0.28,
  enableZeroSavingsColdStartRecovery: false,
  zeroSavingsColdStartRecoveryMaxDistanceMeters: 2600,
  zeroSavingsColdStartRecoveryMinFuelNeed: 0.40,
  zeroSavingsColdStartRecoveryMinTripFuelIntentScore: 0.80,
  zeroSavingsColdStartRecoveryMinTripFuelIntentSurplus: 0.50,
  zeroSavingsColdStartRecoveryMinIntentEvidence: 0.70,
  zeroSavingsColdStartRecoveryMinEffectiveProbability: 0.16,
  zeroSavingsColdStartRecoveryMaxObservedSkip: 0.72,
  lowSavingsColdStartMaxSavings: 0.02,
  lowSavingsColdStartMaxFuelNeed: 0.85,
  lowSavingsColdStartMaxProbability: 0.38,
  enableLowSavingsColdStartRecovery: false,
  lowSavingsColdStartRecoveryMaxDistanceMeters: 1600,
  lowSavingsColdStartRecoveryMinFuelNeed: 0.72,
  lowSavingsColdStartRecoveryMinTripFuelIntentScore: 0.46,
  lowSavingsColdStartRecoveryMinTripFuelIntentSurplus: 0.22,
  lowSavingsColdStartRecoveryMinIntentEvidence: 0.42,
  lowSavingsColdStartRecoveryMinEffectiveProbability: 0.20,
  enableHighFuelSingleCandidateLowSavingsRecovery: false,
  highFuelSingleCandidateLowSavingsRecoveryMaxDistanceMeters: 1600,
  highFuelSingleCandidateLowSavingsRecoveryMinFuelNeed: 0.72,
  highFuelSingleCandidateLowSavingsRecoveryMinTripFuelIntentScore: 0.48,
  highFuelSingleCandidateLowSavingsRecoveryMinTripFuelIntentSurplus: 0.25,
  highFuelSingleCandidateLowSavingsRecoveryMinIntentEvidence: 0.44,
  highFuelSingleCandidateLowSavingsRecoveryMinEffectiveProbability: 0.20,
  enableZeroSavingsRoutineGuard: true,
  enableZeroSavingsObservedCaptureGuard: true,
  zeroSavingsRoutineMaxSavings: 0.02,
  zeroSavingsRoutineMaxFuelNeed: 0.35,
  zeroSavingsRoutineMinObservedSkip: 0.24,
  zeroSavingsRoutineMaxProbability: 0.30,
  zeroSavingsRoutineMinDistanceMeters: 1800,
  zeroSavingsObservedCaptureMaxSavings: 0.02,
  zeroSavingsObservedCaptureMaxFuelNeed: 0.35,
  zeroSavingsObservedCaptureMinObservedSkip: 0.18,
  zeroSavingsObservedCaptureMaxProbability: 0.20,
  zeroSavingsObservedCaptureMinDistanceMeters: 1300,
  cheaperAlternativeMinProbability: 0.28,
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
  anchoredRoutineMinTripAwarenessSeconds: 60,
  anchoredRoutineStraightRoadMinConfidence: 0.50,
  anchoredRoutineStraightRoadMinNoticeability: 0.32,
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
  enableHistoryRecoveryProposals: true,
  historyRecoveryMinHistoryStrength: 0.16,
  historyRecoveryMinProbability: 0.18,
  historyRecoveryMinIntentEvidence: 0.30,
  historyRecoveryMinValueScore: 0.72,
  historyRecoveryMinPathScore: 0.72,
  historyRecoveryMinFuelNeed: 0.12,
  historyRecoveryMinHighwayFuelNeed: 0.08,
  historyRecoveryTripIntentBuffer: 0.06,
  historyRecoveryCityMaxDistanceMeters: 4800,
  historyRecoveryHighwayMaxDistanceMeters: 9000,
  historyRecoveryMinConfidence: 0.42,
  historyRecoveryMinTotalVisits: 6,
  historyRecoveryMaxObservedSkip: 0.52,
  historyRecoveryMinVisitShare: 0.04,
  observedPatternMaxDistanceMeters: 5200,
  observedPatternMinTripFuelIntentBuffer: 0.02,
  observedPatternMinIntentEvidence: 0.34,
  observedPatternMinObservedBehaviorStrength: 0.12,
  observedPatternMinObservedConversionRate: 0.12,
  observedPatternMinContextualObservedConversionRate: 0.16,
  observedPatternMinVisitShare: 0.10,
  observedPatternMaxObservedSkip: 0.56,
  observedPatternMinHistoryVisits: 6,
  observedPatternMinProbability: 0.22,
  observedPatternMinBehaviorEdge: 0.03,
  observedPatternMinConfidence: 0.48,
  fuelNeedHighThreshold: 0.60,
  fuelNeedMediumThreshold: 0.54,
  lowSpecificityFuelNeedBuffer: 0.10,
  singleCandidateRoutineMaxDistanceMeters: 6500,
  singleCandidateRoutineMinTripFuelIntentBuffer: 0.04,
  singleCandidateRoutineMinIntentEvidence: 0.34,
  singleCandidateRoutineMinObservedConversionRate: 0.12,
  singleCandidateRoutineMinContextualObservedConversionRate: 0.16,
  singleCandidateRoutineMinVisitShare: 0.08,
  singleCandidateRoutineMaxObservedSkip: 0.42,
  singleCandidateRoutineMinHistoryVisits: 6,
  singleCandidateRoutineMinProbability: 0.24,
  singleCandidateRoutineMinTimePatternStrength: 0.10,
  singleCandidateRoutineMinConfidence: 0.50,
  anchoredSingleCandidateRoutineMaxDistanceMeters: 6500,
  anchoredSingleCandidateRoutineMinTripFuelIntentBuffer: 0.04,
  anchoredSingleCandidateRoutineMinIntentEvidence: 0.40,
  anchoredSingleCandidateRoutineMinObservedConversionRate: 0.15,
  anchoredSingleCandidateRoutineMinContextualObservedConversionRate: 0.18,
  anchoredSingleCandidateRoutineMinVisitShare: 0.50,
  anchoredSingleCandidateRoutineMaxObservedSkip: 0.40,
  anchoredSingleCandidateRoutineMinHistoryVisits: 6,
  anchoredSingleCandidateRoutineMinProbability: 0.14,
  anchoredSingleCandidateRoutineMinTimePatternStrength: 0.15,
  anchoredSingleCandidateRoutineMinFuelNeed: 0.12,
  anchoredSingleCandidateRoutineMinConfidence: 0.50,
  timedRoutineRecoveryMaxDistanceMeters: 5600,
  timedRoutineRecoveryMinHistoryVisits: 6,
  timedRoutineRecoveryMinHistoryStrength: 0.34,
  timedRoutineRecoveryMinTimePatternStrength: 0.34,
  timedRoutineRecoveryMinFuelNeed: 0.21,
  timedRoutineRecoveryMinTripDemandPressure: 0.06,
  timedRoutineRecoveryMinIntentEvidence: 0.34,
  timedRoutineRecoveryMinObservedConversionRate: 0.17,
  timedRoutineRecoveryMinContextualObservedConversionRate: 0.21,
  timedRoutineRecoveryMinVisitShare: 0.44,
  timedRoutineRecoveryMaxObservedSkip: 0.32,
  timedRoutineRecoveryMinProbability: 0.16,
  timedRoutineRecoveryMinConfidence: 0.46,
  smallCandidateObservedRoutineMaxCandidateCount: 2,
  smallCandidateObservedRoutineMaxDistanceMeters: 6500,
  smallCandidateObservedRoutineMinTripFuelIntentBuffer: 0.02,
  smallCandidateObservedRoutineMinIntentEvidence: 0.32,
  smallCandidateObservedRoutineMinObservedBehaviorStrength: 0.08,
  smallCandidateObservedRoutineMinObservedConversionRate: 0.08,
  smallCandidateObservedRoutineMinContextualObservedConversionRate: 0.10,
  smallCandidateObservedRoutineMinVisitShare: 0.12,
  smallCandidateObservedRoutineMaxObservedSkip: 0.66,
  smallCandidateObservedRoutineMinHistoryVisits: 6,
  smallCandidateObservedRoutineMinProbability: 0.12,
  smallCandidateObservedRoutineMinLeadMargin: 0.08,
  smallCandidateObservedRoutineMinFuelNeed: 0.22,
  smallCandidateObservedRoutineMinConfidence: 0.46,
  routeHabitMinShare: 0.34,
  routeHabitLowSpecificityMinShare: 0.42,
  routeHabitObservedRoutineMinShare: 0.42,
  routeHabitFallbackMinProbability: 0.24,
  routeHabitFallbackLongDistanceMeters: 4000,
  routeHabitFallbackLongDistanceMinProbability: 0.28,
  routeObservedRoutineLeakMinRouteHabitShare: 0.90,
  routeObservedRoutineLeakMinRouteObservedSkip: 0.70,
  routeObservedRoutineLeakMinRouteObservedReliability: 0.90,
  routeObservedRoutineLeakMinContextualObservedConversionRate: 0.22,
  routeObservedRoutineLeakMinObservedSkip: 0.35,
  lowDemandObservedRoutineMaxTripDemandPressure: 0.10,
  lowDemandObservedRoutineMaxFuelNeed: 0.34,
  lowDemandObservedRoutineMaxRouteHabitShare: 0.15,
  lowDemandObservedRoutineMaxRouteObservedSupport: 0.14,
  lowDemandObservedRoutineMinDistanceMeters: 1800,
  lowDemandObservedCaptureMaxFuelNeed: 0.30,
  lowDemandObservedCaptureMaxTripDemandPressure: 0.10,
  lowDemandObservedCaptureMaxRouteHabitShare: 0.15,
  longDistanceObservedRoutineMinDistanceMeters: 3200,
  longDistanceObservedRoutineMaxTripDemandPressure: 0.07,
  longDistanceObservedRoutineMaxFuelNeed: 0.30,
  longDistanceObservedRoutineMaxProbability: 0.25,
  routeHabitObservedCaptureLeakMinRouteHabitShare: 0.85,
  routeHabitObservedCaptureLeakMaxRouteObservedSupport: 0.03,
  routeHabitObservedCaptureLeakMinRouteObservedSkip: 0.75,
  routeHabitObservedCaptureLeakMaxFuelNeed: 0.18,
  routeHabitObservedCaptureLeakMaxTripDemandPressure: 0.05,
  brandHabitFallbackMinProbability: 0.30,
  brandHabitFallbackMinVisitShare: 0.32,
  brandHabitFallbackMaxContextualObservedConversionRate: 0.18,
  brandHabitFallbackMinBrandAffinity: 0.65,
  lowNeedLongDistanceRoutineMeters: 4500,
  lowNeedLongDistanceRoutineMinFuelNeed: 0.22,
  lowNeedLongDistanceRoutineMinProbability: 0.26,
  weakObservedRoutineMinProbability: 0.22,
  weakObservedRoutineMaxRouteHabitShare: 0.20,
  weakObservedRoutineMaxObservedBehaviorStrength: 0.12,
  highSkipObservedRoutineMinSkip: 0.44,
  highSkipObservedRoutineMaxProbability: 0.28,
  genericBrandHabitPredictedStopMaxFuelNeed: 0.18,
  genericBrandHabitPredictedStopMinProbability: 0.30,
  genericPredictedStopLowTimePatternMaxTimePatternStrength: 0.05,
  genericPredictedStopLowTimePatternMinRouteHabitShare: 0.55,
  genericPredictedStopLowTimePatternMinBrandAffinity: 0.65,
  genericPredictedStopLowTimePatternMaxVisitShare: 0.30,
  genericPredictedStopLowTimePatternMaxContextualObservedConversionRate: 0.18,
  genericPredictedStopLowTimePatternMaxFuelNeed: 0.18,
  genericPredictedStopLowTimePatternMaxProbability: 0.30,
  lowNeedRoutineMinRouteHabitShare: 0.60,
  lowNeedRoutineMaxFuelNeed: 0.08,
  lowNeedRoutineMaxProbability: 0.24,
  lowNeedRoutineMaxTimePatternStrength: 0.05,
  highSkipAnchoredRoutineMinRouteHabitShare: 0.55,
  highSkipAnchoredRoutineMinSkip: 0.42,
  highSkipAnchoredRoutineMaxFuelNeed: 0.30,
  highSkipAnchoredRoutineMaxProbability: 0.21,
  highSkipAnchoredRoutineMaxTimePatternStrength: 0.18,
  longDistanceRoutineMinDistanceMeters: 4000,
  longDistanceRoutineMaxFuelNeed: 0.30,
  longDistanceRoutineMaxProbability: 0.31,
  highDemandWeakSupportColdStartMaxCandidateCount: 2,
  highDemandWeakSupportColdStartMinTripDemandPressure: 0.70,
  highDemandWeakSupportColdStartMinFuelNeed: 0.75,
  highDemandWeakSupportColdStartMinDistanceMeters: 3000,
  highDemandWeakSupportColdStartMaxWeakSupport: 0.15,
  weakSupportedLowSpecificityMaxProbability: 0.22,
  routeHabitRepeatPredictedStopMinRouteHabitShare: 0.60,
  routeHabitRepeatPredictedStopMaxCandidateCount: 3,
  routeHabitRepeatPredictedStopMinVisitShare: 0.25,
  routeHabitRepeatPredictedStopMaxFuelNeed: 0.30,
  routeHabitRepeatPredictedStopMaxTimePatternStrength: 0.18,
  routeHabitRepeatPredictedStopMinDistanceMeters: 2000,
  routeHabitRepeatPredictedStopMaxProbability: 0.31,
  routeHabitHistoryConfirmationOverrideMinRouteHabitShare: 0.45,
  routeHabitHistoryConfirmationOverrideMinVisitShare: 0.05,
  routeHabitHistoryConfirmationOverrideMinContextualObservedConversionRate: 0.15,
  routeHabitHistoryConfirmationOverrideMinIntentEvidence: 0.60,
  routeHabitHistoryConfirmationOverrideMinTripFuelIntentScore: 0.80,
  routeHabitHistoryConfirmationOverrideMinEffectiveProbability: 0.18,
  routeHabitHistoryConfirmationOverrideMaxCandidateCount: 3,
  routeHabitHistoryConfirmationOverrideMaxObservedSkip: 0.48,
  routeHabitLowNeedConfirmationOverrideMinRouteHabitShare: 0.90,
  routeHabitLowNeedConfirmationOverrideMinVisitShare: 0.08,
  routeHabitLowNeedConfirmationOverrideMinContextualObservedConversionRate: 0.15,
  routeHabitLowNeedConfirmationOverrideMinTripFuelIntentScore: 0.44,
  routeHabitLowNeedConfirmationOverrideMaxFuelNeed: 0.06,
  routeHabitLowNeedConfirmationOverrideMinEffectiveProbability: 0.16,
  routeHabitLowNeedConfirmationOverrideMaxObservedSkip: 0.46,
  routeHabitLowNeedRecoveryMaxCandidateCount: 3,
  routeHabitLowNeedRecoveryMinCandidateCount: 2,
  routeHabitLowNeedRecoveryMinRouteHabitShare: 0.90,
  routeHabitLowNeedRecoveryMinVisitShare: 0.08,
  routeHabitLowNeedRecoveryMaxVisitShare: 0.12,
  routeHabitLowNeedRecoveryMaxRouteObservedSupport: 0.12,
  routeHabitLowNeedRecoveryMinContextualObservedConversionRate: 0.15,
  routeHabitLowNeedRecoveryMinTripFuelIntentScore: 0.44,
  routeHabitLowNeedRecoveryMaxFuelNeed: 0.06,
  routeHabitLowNeedRecoveryMinEffectiveProbability: 0.16,
  routeHabitLowNeedRecoveryMaxObservedSkip: 0.46,
  routeHabitLowNeedRecoveryMinConfidence: 0.35,
  speculativeLongDistanceRouteHabitRoutineMinDistanceMeters: 3000,
  speculativeLongDistanceRouteHabitRoutineMaxFuelNeed: 0.35,
  speculativeLongDistanceRouteHabitRoutineMaxTripFuelIntentScore: 0.40,
  speculativeLongDistanceRouteHabitRoutineMinRouteHabitShare: 0.90,
  speculativeLongDistanceRouteHabitRoutineMaxProbability: 0.30,
  routeHabitLowNeedPredictedStopMaxCandidateCount: 2,
  routeHabitLowNeedPredictedStopMinRouteHabitShare: 0.60,
  routeHabitLowNeedPredictedStopMinContextualObservedConversionRate: 0.28,
  routeHabitLowNeedPredictedStopMaxFuelNeed: 0.15,
  routeHabitLowNeedPredictedStopMaxTimePatternStrength: 0.05,
  routeHabitLowNeedPredictedStopMinDistanceMeters: 1500,
  routeHabitLowNeedPredictedStopMaxProbability: 0.31,
  speculativeCheaperAlternativeMinHistoryVisits: 20,
  speculativeCheaperAlternativeMaxCandidateCount: 2,
  speculativeCheaperAlternativeMaxFuelNeed: 0.45,
  speculativeCheaperAlternativeMaxDistanceMeters: 3300,
  speculativeCheaperAlternativeMaxSelectedSupport: 0.02,
  speculativeCheaperAlternativeMinSelectedObservedSkip: 0.55,
  speculativeCheaperAlternativeMinDefaultRouteHabitShare: 0.90,
  speculativeCheaperAlternativeMinDefaultContextualObservedConversionRate: 0.14,
  speculativeCheaperAlternativeMaxDefaultGap: 0.04,
  historyPresentSpeculativeColdStartMinHistoryVisits: 20,
  historyPresentSpeculativeColdStartMaxWeakSupport: 0.12,
  historyPresentSpeculativeColdStartMaxSavings: 0.02,
  historyPresentSpeculativeCityViableMaxCandidateCount: 1,
  historyPresentSpeculativeCityViableMaxFuelNeed: 0.35,
  historyPresentSpeculativeCityViableMaxProbability: 0.22,
  historyPresentSpeculativeHighwayViableMaxCandidateCount: 2,
  historyPresentSpeculativeHighwayViableMinDistanceMeters: 1500,
  historyPresentSpeculativeHighwayViableMaxProbability: 0.37,
  historyPresentSpeculativeBestStopMinCandidateCount: 3,
  historyPresentSpeculativeBestStopMinDistanceMeters: 4000,
  historyPresentSpeculativeBestStopMaxProbability: 0.37,
  historyPresentHighFuelNoSupportColdStartMinFuelNeed: 0.45,
  historyPresentHighFuelNoSupportColdStartMaxRouteMemorySupport: 0.02,
  historyPresentHighFuelNoSupportColdStartMaxCandidateCount: 2,
  historyPresentHighFuelNoSupportColdStartMinDistanceMeters: 1500,
  historyPresentHighFuelNoSupportBestStopMinDistanceMeters: 3000,
  highConversionRouteHabitRoutineMinRouteHabitShare: 0.60,
  highConversionRouteHabitRoutineMinVisitShare: 0.35,
  highConversionRouteHabitRoutineMinContextualObservedConversionRate: 0.28,
  highConversionRouteHabitRoutineMinTimePatternStrength: 0.35,
  highConversionRouteHabitRoutineMinDistanceMeters: 3000,
  highConversionRouteHabitRoutineMaxFuelNeed: 0.30,
  highConversionRouteHabitRoutineMaxProbability: 0.34,
  strongObservedRoutineMaxDistanceMeters: 6500,
  strongObservedRoutineMinTripFuelIntentSurplus: 0.08,
  strongObservedRoutineMinIntentEvidence: 0.20,
  strongObservedRoutineMinObservedConversionRate: 0.18,
  strongObservedRoutineMinContextualObservedConversionRate: 0.21,
  strongObservedRoutineMinVisitShare: 0.50,
  strongObservedRoutineMaxObservedSkip: 0.31,
  strongObservedRoutineMinHistoryVisits: 8,
  strongObservedRoutineMinProbability: 0.14,
  strongObservedRoutineMinTimePatternStrength: 0.12,
  strongObservedRoutineMinFuelNeed: 0.10,
  strongObservedRoutineMinConfidence: 0.50,
  strongObservedRoutineLiveIntentBuffer: 0.10,
  strongObservedRoutinePauseNoticeability: 0.42,
  observedPendingCarryMinVisitShare: 0.20,
  observedPendingCarryMaxRouteHabitShare: 0.10,
  observedPendingCarryMinObservedConversionRate: 0.10,
  observedPendingCarryMinContextualObservedConversionRate: 0.12,
  observedPendingCarryMaxObservedSkip: 0.60,
  observedPendingCarryMaxDistanceMeters: 1800,
  highFuelObservedLowSpecificityMaxCandidateCount: 2,
  highFuelObservedLowSpecificityMaxDistanceMeters: 1700,
  highFuelObservedDefaultOverrideMaxCandidateCount: 2,
  highFuelObservedDefaultOverrideMaxDistanceMeters: 1700,
  highFuelObservedLowSpecificityMinHistoryVisits: 6,
  highFuelObservedLowSpecificityMinFuelNeed: 0.35,
  highFuelObservedLowSpecificityMinTripFuelIntentScore: 0.40,
  highFuelObservedLowSpecificityMinIntentEvidence: 0.33,
  highFuelObservedLowSpecificityMinObservedConversionRate: 0.11,
  highFuelObservedLowSpecificityMinContextualObservedConversionRate: 0.11,
  highFuelObservedLowSpecificityMinVisitShare: 0.22,
  highFuelObservedLowSpecificityMaxObservedSkip: 0.67,
  highFuelObservedLowSpecificityMinEffectiveProbability: 0.15,
  highFuelObservedLowSpecificityMinConfidence: 0.40,
  skipDominatedColdStartOverrideMaxCandidateCount: 2,
  skipDominatedColdStartOverrideMinFuelNeed: 0.28,
  skipDominatedColdStartOverrideMinTripFuelIntentScore: 0.40,
  skipDominatedColdStartOverrideMaxDistanceMeters: 2800,
  skipDominatedColdStartOverrideMinVisitShare: 0.35,
  skipDominatedColdStartOverrideMinRouteHabitShare: 0.60,
  skipDominatedColdStartOverrideMinContextualObservedConversionRate: 0.17,
  skipDominatedColdStartOverrideMinObservedConversionRate: 0.15,
  skipDominatedColdStartOverrideMaxObservedSkip: 0.60,
  skipDominatedColdStartOverrideMinIntentEvidence: 0.45,
  skipDominatedColdStartOverrideMinEffectiveProbability: 0.13,
  skipDominatedColdStartOverrideMaxLeadGap: 0.06,
  skipDominatedColdStartDefaultMaxObservedBehaviorStrength: 0.02,
  skipDominatedColdStartDefaultMinObservedSkip: 0.90,
  routeSupportedColdStartOverrideMaxCandidateCount: 3,
  routeSupportedColdStartOverrideMinFuelNeed: 0.30,
  routeSupportedColdStartOverrideMinTripFuelIntentScore: 0.68,
  routeSupportedColdStartOverrideMaxDistanceMeters: 3200,
  routeSupportedColdStartOverrideMinRouteHabitShare: 0.90,
  routeSupportedColdStartOverrideMinRouteObservedSupport: 0.14,
  routeSupportedColdStartOverrideMinContextualObservedConversionRate: 0.24,
  routeSupportedColdStartOverrideMaxRouteObservedSkip: 0.28,
  routeSupportedColdStartOverrideMinIntentEvidence: 0.18,
  routeSupportedColdStartOverrideMinEffectiveProbability: 0.16,
  routeSupportedColdStartOverrideMaxLeadGap: 0.09,
  routeSupportedColdStartDefaultMaxRouteHabitShare: 0.05,
  routeSupportedColdStartDefaultMaxRouteObservedSupport: 0.02,
  routeSupportedColdStartDefaultMaxObservedBehaviorStrength: 0.03,
  enableNearTieObservedDefaultOverride: false,
  nearTieObservedDefaultOverrideMaxCandidateCount: 2,
  nearTieObservedDefaultOverrideMaxDistanceMeters: 4200,
  nearTieObservedDefaultOverrideMinHistoryVisits: 6,
  nearTieObservedDefaultOverrideMinTripFuelIntentScore: 0.40,
  nearTieObservedDefaultOverrideMinIntentEvidence: 0.38,
  nearTieObservedDefaultOverrideMinObservedConversionRate: 0.15,
  nearTieObservedDefaultOverrideMinContextualObservedConversionRate: 0.18,
  nearTieObservedDefaultOverrideMinVisitShare: 0.25,
  nearTieObservedDefaultOverrideMaxObservedSkip: 0.45,
  nearTieObservedDefaultOverrideMaxLeadGap: 0.06,
  nearTieObservedDefaultOverrideColdStartDefaultMinObservedSkip: 0.50,
  nearTieObservedDefaultOverrideColdStartDefaultMaxObservedSupport: 0.02,
  coldStartRouteSupportedCompetitorMaxCandidateCount: 3,
  coldStartRouteSupportedCompetitorMinFuelNeed: 0.30,
  coldStartRouteSupportedCompetitorMinRouteHabitShare: 0.90,
  coldStartRouteSupportedCompetitorMinRouteObservedSupport: 0.14,
  coldStartRouteSupportedCompetitorMinRouteObservedExposureCount: 24,
  coldStartRouteSupportedCompetitorMinContextualObservedConversionRate: 0.24,
  coldStartRouteSupportedCompetitorMaxRouteObservedSkip: 0.28,
  coldStartRouteSupportedCompetitorMaxLeadGap: 0.09,
  coldStartRouteSupportedCompetitorSelectedMaxRouteHabitShare: 0.05,
  coldStartRouteSupportedCompetitorSelectedMaxRouteObservedSupport: 0.02,
  coldStartRouteSupportedCompetitorSelectedMaxObservedBehaviorStrength: 0.03,
  coldStartAmbiguousFarCompetitorMaxCandidateCount: 3,
  coldStartAmbiguousFarCompetitorMinFuelNeed: 0.45,
  coldStartAmbiguousFarCompetitorMaxSelectedDistanceMeters: 1800,
  coldStartAmbiguousFarCompetitorMinAlongTrackGapMeters: 1800,
  coldStartAmbiguousFarCompetitorMaxLeadGap: 0.02,
  coldStartAmbiguousFarCompetitorMinColdStartAdvantage: 0.05,
  coldStartAmbiguousFarCompetitorMinIntentEvidence: 0.55,
  coldStartAmbiguousFarCompetitorMaxObservedBehaviorStrength: 0.08,
  coldStartAmbiguousFarCompetitorMaxRouteSupport: 0.08,
  skipDominatedColdStartSupportedMinProbability: 0.13,
  skipDominatedColdStartSupportedMinConfidence: 0.35,
  minStableRecommendationCountObservedRoutineSmallCandidate: 2,
  supportedLowSpecificityMaxCandidateCount: 2,
  supportedLowSpecificityMaxDistanceMeters: 4500,
  supportedLowSpecificityMinFuelNeed: 0.22,
  supportedLowSpecificityMinTripFuelIntentSurplus: 0.08,
  supportedLowSpecificityMinIntentEvidence: 0.35,
  supportedLowSpecificityMinEffectiveProbability: 0.12,
  supportedLowSpecificityMaxObservedSkip: 0.40,
  supportedLowSpecificityMinConfidence: 0.44,
  supportedLowSpecificityMinLeadMargin: 0.08,
  supportedLowSpecificityMinVisibleSavings: 0,
  valueDrivenLowSpecificityMaxCandidateCount: 4,
  valueDrivenLowSpecificityMaxDistanceMeters: 6500,
  valueDrivenLowSpecificityMinFuelNeed: 0.35,
  valueDrivenLowSpecificityHighwayMinFuelNeed: 0.04,
  valueDrivenLowSpecificityMinTripFuelIntentScore: 0.36,
  valueDrivenLowSpecificityMinIntentEvidence: 0.24,
  valueDrivenLowSpecificityMinNetCostAdvantage: 0.14,
  valueDrivenLowSpecificityMinNetSavings: 0.08,
  valueDrivenLowSpecificityMinVisiblePriceOpportunity: 0.16,
  valueDrivenLowSpecificityHighwayMinVisiblePriceOpportunity: 0.18,
  valueDrivenLowSpecificityMinValueScore: 0.95,
  valueDrivenLowSpecificityMaxObservedSkip: 0.62,
  valueDrivenLowSpecificityMinEffectiveProbability: 0.13,
  valueDrivenLowSpecificityMinConfidence: 0.42,
  highFuelCorridorRecoveryMaxCandidateCount: 2,
  highFuelCorridorRecoveryMaxDistanceMeters: 5500,
  highFuelCorridorRecoveryMinHistoryVisits: 6,
  highFuelCorridorRecoveryMinFuelNeed: 0.86,
  highFuelCorridorRecoveryMinTripFuelIntentScore: 0.50,
  highFuelCorridorRecoveryMinIntentEvidence: 0.22,
  highFuelCorridorRecoveryMinObservedConversionRate: 0.16,
  highFuelCorridorRecoveryMinContextualObservedConversionRate: 0.20,
  highFuelCorridorRecoveryMinVisitShare: 0.30,
  highFuelCorridorRecoveryMinRouteHabitShare: 0.10,
  highFuelCorridorRecoveryMaxObservedSkip: 0.65,
  highFuelCorridorRecoveryMinEffectiveProbability: 0.11,
  highFuelCorridorRecoveryMinConfidence: 0.36,
  highFuelCorridorRecoveryMinVisibleSavings: 0,
  enableLateObservedCorridorRecovery: false,
  lateObservedCorridorRecoveryMaxCandidateCount: 2,
  lateObservedCorridorRecoveryMaxDistanceMeters: 4200,
  lateObservedCorridorRecoveryMinHistoryVisits: 6,
  lateObservedCorridorRecoveryMinFuelNeed: 0.12,
  lateObservedCorridorRecoveryMinTripFuelIntentSurplus: 0.15,
  lateObservedCorridorRecoveryMinIntentEvidence: 0.44,
  lateObservedCorridorRecoveryMinObservedConversionRate: 0.15,
  lateObservedCorridorRecoveryMinContextualObservedConversionRate: 0.18,
  lateObservedCorridorRecoveryMinVisitShare: 0.28,
  lateObservedCorridorRecoveryMinRouteHabitShare: 0.70,
  lateObservedCorridorRecoveryMaxObservedSkip: 0.42,
  lateObservedCorridorRecoveryMinEffectiveProbability: 0.16,
  lateObservedCorridorRecoveryMinConfidence: 0.34,
  lateObservedCorridorRecoveryMinVisibleSavings: 0,
  lateObservedCorridorPendingCarryMinIntentEvidence: 0.34,
  lateObservedCorridorPendingCarryMinObservedConversionRate: 0.15,
  lateObservedCorridorPendingCarryMinContextualObservedConversionRate: 0.18,
  lateObservedCorridorPendingCarryMinVisitShare: 0.24,
  lateObservedCorridorPendingCarryMinRouteHabitShare: 0.03,
  lateObservedCorridorPendingCarryMinRouteObservedSupport: 0.05,
  lateObservedCorridorPendingCarryMaxObservedSkip: 0.50,
  lateObservedCorridorPendingCarryMinEffectiveProbability: 0.12,
  observedCorridorCaptureMaxCandidateCount: 2,
  observedCorridorCaptureMaxDistanceMeters: 3200,
  observedCorridorCaptureMinHistoryVisits: 6,
  observedCorridorCaptureMinTripFuelIntentScore: 0.55,
  observedCorridorCaptureMinIntentEvidence: 0.48,
  observedCorridorCaptureMinObservedConversionRate: 0.20,
  observedCorridorCaptureMinContextualObservedConversionRate: 0.24,
  observedCorridorCaptureMinVisitShare: 0.45,
  observedCorridorCaptureMaxObservedSkip: 0.30,
  observedCorridorCaptureMinEffectiveProbability: 0.14,
  observedCorridorCaptureMinConfidence: 0.34,
  observedCorridorCaptureMinVisibleSavings: 0,
  minStableRecommendationCountSupportedLowSpecificity: 2,
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
  consistencyGapToleranceMs: 12000,
  pendingRecommendationMaxAgeMs: 45000,
  pendingRecommendationMinReleaseDistanceMeters: 650,
  minStableRecommendationCount: 4,
  minStableRecommendationCountWithHistory: 3,
  minStableRecommendationCountCommitment: 2,
  minStableRecommendationCountUrgent: 1,
  minStableRecommendationCountRoutineSingleCandidate: 2,
  minStableRecommendationCountAnchoredRoutineSingleCandidate: 2,
  minStableRecommendationCountTimedRoutineRecovery: 2,
  minStableRecommendationCountNoHistoryStrongSingleCandidate: 1,
  minStableRecommendationCountNoHistoryValueLeaderRecovery: 2,
  minStableRecommendationCountNoHistoryHighFuelSingleCandidate: 1,
  enableLearnedCommitmentAccumulator: false,
  learnedCommitmentAccumulatorMaxCandidateCount: 2,
  learnedCommitmentAccumulatorMinHistoryVisits: 6,
  learnedCommitmentAccumulatorDecay: 0.92,
  learnedCommitmentAccumulatorNoOfferDecay: 0.94,
  learnedCommitmentAccumulatorMinVisibleSamples: 6,
  learnedCommitmentAccumulatorMinPersistenceSamples: 3,
  learnedCommitmentAccumulatorReduceConsistencyMinScore: 0.82,
  learnedCommitmentAccumulatorReduceConsistencyMinMargin: 0.20,
  learnedCommitmentAccumulatorReduceConsistencyBy: 1,
  learnedCommitmentAccumulatorMinScore: 0.94,
  learnedCommitmentAccumulatorMinMargin: 0.24,
  learnedCommitmentAccumulatorMaxDistanceMeters: 3600,
  learnedCommitmentAccumulatorMinFuelNeed: 0.18,
  learnedCommitmentAccumulatorMinIntentEvidence: 0.46,
  learnedCommitmentAccumulatorMinTripFuelIntentSurplus: 0.06,
  learnedCommitmentAccumulatorMinEffectiveProbability: 0.10,
  learnedCommitmentAccumulatorMinVisitShare: 0.18,
  learnedCommitmentAccumulatorMinRouteHabitShare: 0.46,
  learnedCommitmentAccumulatorMinContextualObservedConversionRate: 0.12,
  learnedCommitmentAccumulatorMinObservedConversionRate: 0.10,
  learnedCommitmentAccumulatorMaxObservedSkip: 0.56,
  learnedCommitmentAccumulatorNoOfferBase: 0.06,
  learnedCommitmentAccumulatorNoOfferLowNeedWeight: 0.22,
  learnedCommitmentAccumulatorNoOfferAmbiguityWeight: 0.14,
  learnedCommitmentAccumulatorNoOfferWeakHistoryWeight: 0.16,
  enableLearnedSuppressionAccumulatorRecovery: true,
  learnedSuppressionAccumulatorMinHistoryVisits: 8,
  learnedSuppressionAccumulatorMinStreak: 8,
  learnedSuppressionAccumulatorMaxCandidateCount: 1,
  learnedSuppressionAccumulatorMinDistanceMeters: 1200,
  learnedSuppressionAccumulatorMaxDistanceMeters: 2400,
  learnedSuppressionAccumulatorMinFuelNeed: 0.22,
  learnedSuppressionAccumulatorMinTripFuelIntentSurplus: 0.10,
  learnedSuppressionAccumulatorMinIntentEvidence: 0.50,
  learnedSuppressionAccumulatorMinEffectiveProbability: 0.09,
  learnedSuppressionAccumulatorMinVisitShare: 0.20,
  learnedSuppressionAccumulatorMinRouteHabitShare: 0.50,
  learnedSuppressionAccumulatorMinContextualObservedConversionRate: 0.12,
  learnedSuppressionAccumulatorMinObservedConversionRate: 0.10,
  learnedSuppressionAccumulatorMaxObservedSkip: 0.56,
  learnedSuppressionAccumulatorGapToleranceSamples: 20,
  learnedSuppressionAccumulatorMaxAverageProbabilityDelta: 0.015,
  learnedSuppressionAccumulatorMaxAverageIntentDelta: 0.055,
  learnedSuppressionAccumulatorMaxAverageTripFuelIntentDelta: 0.065,
  learnedSuppressionAccumulatorMinProbabilitySpan: 0.02,
  stableLearnedCorridorMinHistoryVisits: 12,
  stableLearnedCorridorMaxDistanceMeters: 2200,
  stableLearnedCorridorMinFuelNeed: 0.26,
  stableLearnedCorridorMinTripFuelIntentSurplus: 0.17,
  stableLearnedCorridorMinIntentEvidence: 0.42,
  stableLearnedCorridorMinEffectiveProbability: 0.10,
  stableLearnedCorridorMinConfidence: 0.43,
  stableLearnedCorridorMinVisitShare: 0.20,
  stableLearnedCorridorMinRouteHabitShare: 0.50,
  stableLearnedCorridorMinObservedBehaviorStrength: 0.10,
  stableLearnedCorridorMinContextualObservedConversionRate: 0.12,
  stableLearnedCorridorMinObservedConversionRate: 0.10,
  stableLearnedCorridorMaxObservedSkip: 0.45,
  enableValueDrivenRoadtripColdStartGuard: false,
  valueDrivenRoadtripColdStartGuardMinHistoryVisits: 6,
  valueDrivenRoadtripColdStartMaxCandidateCount: 2,
  valueDrivenRoadtripColdStartMinTripDemandPressure: 0.70,
  valueDrivenRoadtripColdStartMinAlongTrack: 3000,
  valueDrivenRoadtripColdStartMaxLearnedSupport: 0.02,
  valueDrivenRoadtripColdStartMinObservedSkip: 0.30,
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
  const selectedDecisionCandidate = Array.isArray(recommendation?.decisionSnapshot?.candidates)
    ? recommendation.decisionSnapshot.candidates.find(decisionCandidate => decisionCandidate?.selected)
    : null;
  const strongObservedRoutinePresentationAssist = Boolean(
    recommendation.type === 'predicted_stop' &&
    selectedDecisionCandidate &&
    (selectedDecisionCandidate.visitShare || 0) >= opts.strongObservedRoutineMinVisitShare &&
    (selectedDecisionCandidate.observedSkipScore || 0) <= opts.strongObservedRoutineMaxObservedSkip &&
    (
      (selectedDecisionCandidate.contextualObservedConversionRate || 0) >= opts.strongObservedRoutineMinContextualObservedConversionRate ||
      (selectedDecisionCandidate.observedConversionRate || 0) >= opts.strongObservedRoutineMinObservedConversionRate
    ) &&
    (Number(recommendation?.mlFeatures?.timePatternStrength) || 0) >= opts.strongObservedRoutineMinTimePatternStrength
  );
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
  const anchoredRoutineStraightRoadWindow = Boolean(
    lowDemandCruise &&
    recommendation.type === 'predicted_stop' &&
    typeof recommendation.reason === 'string' &&
    recommendation.reason.startsWith('Anchored routine stop ahead') &&
    tripDurationSeconds >= opts.anchoredRoutineMinTripAwarenessSeconds &&
    (
      !Number.isFinite(timeToStationSeconds) ||
      timeToStationSeconds >= opts.preferredSurfaceLeadSeconds
    ) &&
    noticeabilityScore >= opts.anchoredRoutineStraightRoadMinNoticeability &&
    (recommendation.confidence || 0) >= opts.anchoredRoutineStraightRoadMinConfidence
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

  const genericSurfaceWindow = (
    tripDurationSeconds >= opts.minTripAwarenessSeconds &&
    (
      (
        stopOpportunityScore >= 0.82 &&
        noticeabilityScore >= (
          strongObservedRoutinePresentationAssist
            ? opts.strongObservedRoutinePauseNoticeability
            : 0.5
        )
      ) ||
      (
        lowDemandCruise &&
        tripDurationSeconds >= opts.preferredTripAwarenessSeconds &&
        noticeabilityScore >= 0.62
      )
    )
  );
  const leadWindowSatisfied = (
    !Number.isFinite(timeToStationSeconds) ||
    timeToStationSeconds >= opts.minSurfaceLeadSeconds
  );
  const surfaceNow = (
    leadWindowSatisfied &&
    (
      genericSurfaceWindow ||
      anchoredRoutineStraightRoadWindow
    )
  );

  return {
    surfaceNow,
    preferredSurface: surfaceNow ? 'live_activity' : 'defer',
    attentionState,
    reason: surfaceNow
      ? (trafficPause.stopLightLike || trafficPause.stopSignLike
        ? 'pause_window'
        : anchoredRoutineStraightRoadWindow
        ? 'anchored_straight_road_window'
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
  const observedConversionRate = clamp(Number(candidate?.observedConversionRate) || 0, 0, 1);
  const contextualObservedConversionRate = clamp(Number(candidate?.contextualObservedConversionRate) || 0, 0, 1);
  const observedSkipScore = clamp(Number(candidate?.observedSkipScore) || 0, 0, 1);
  const closeDistanceEdge = isHighwayCruise ? opts.strongSpeculativeDistanceMeters + 1500 : opts.strongSpeculativeDistanceMeters;
  const farDistanceEdge = isHighwayCruise ? opts.maxSpeculativeDistanceMeters + 1500 : opts.maxSpeculativeDistanceMeters;
  const distanceSignal = 1 - smoothstep(
    closeDistanceEdge,
    farDistanceEdge,
    Number(candidate?.alongTrack) || 0
  );
  const urgencySignal = clamp(urgency / 0.95, 0, 1);

  return clamp(
    (physicalIntentScore * 0.26) +
    (captureSignal * 0.17) +
    (decelSignal * 0.14) +
    (approachSignal * 0.11) +
    (pathSignal * 0.08) +
    (crossTrackFit * 0.08) +
    (distanceSignal * 0.08) +
    (urgencySignal * 0.04) +
    (Math.min(historyStrength, 0.6) * 0.02) +
    (contextualObservedConversionRate * 0.10) +
    (observedConversionRate * 0.04) -
    (observedSkipScore * 0.14),
    0,
    1
  );
}

function computeObservedBehaviorStrength(candidate) {
  const observedConversionRate = clamp(Number(candidate?.observedConversionRate) || 0, 0, 1);
  const contextualObservedConversionRate = clamp(Number(candidate?.contextualObservedConversionRate) || 0, 0, 1);
  const visitShare = clamp(Number(candidate?.visitShare) || 0, 0, 1);
  const historyContextMatch = clamp(Number(candidate?.historyContextMatch) || 0, 0, 1);
  const exposureContextMatch = clamp(Number(candidate?.exposureContextMatch) || 0, 0, 1);
  const observedSkipScore = clamp(Number(candidate?.observedSkipScore) || 0, 0, 1);
  return clamp(
    (contextualObservedConversionRate * 0.42) +
    (observedConversionRate * 0.18) +
    (visitShare * 0.16) +
    (historyContextMatch * 0.10) +
    (exposureContextMatch * 0.08) +
    (clamp(1 - observedSkipScore, 0, 1) * 0.06) -
    (observedSkipScore * 0.16),
    0,
    1
  );
}

function computeHistoryReliability(candidate) {
  const observedConversionRate = clamp(Number(candidate?.observedConversionRate) || 0, 0, 1);
  const contextualObservedConversionRate = clamp(Number(candidate?.contextualObservedConversionRate) || 0, 0, 1);
  const exposureContextMatch = clamp(Number(candidate?.exposureContextMatch) || 0, 0, 1);
  const observedSkipScore = clamp(Number(candidate?.observedSkipScore) || 0, 0, 1);
  const hasObservedBehavior = (
    observedConversionRate > 0 ||
    contextualObservedConversionRate > 0 ||
    exposureContextMatch > 0 ||
    observedSkipScore > 0
  );
  if (!hasObservedBehavior) {
    return 1;
  }
  return clamp(
    0.32 +
    (contextualObservedConversionRate * 0.48) +
    (observedConversionRate * 0.20) -
    (observedSkipScore * 0.28),
    0.18,
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

function getRouteHabitKeys(station = {}) {
  const simulationKeys = station?.simulationRouteContext?.routeHabitKeys;
  if (Array.isArray(simulationKeys) && simulationKeys.length > 0) {
    return simulationKeys.map(key => String(key || '').trim()).filter(Boolean);
  }
  const routeApproachKeys = station?.routeApproach?.routeHabitKeys;
  if (Array.isArray(routeApproachKeys) && routeApproachKeys.length > 0) {
    return routeApproachKeys.map(key => String(key || '').trim()).filter(Boolean);
  }
  return [];
}

function computeRouteStationHabitShare(profile, station, nowMs) {
  return computeRouteHabitShareForKeys(
    profile?.routeStationHabits,
    getRouteHabitKeys(station),
    station?.stationId,
    nowMs,
  );
}

function computeRouteStationObservedMetrics(profile, station, nowMs) {
  return computeRouteStationObservedMetricsForKeys(
    profile?.routeStationHabits,
    profile?.routeStationExposures,
    getRouteHabitKeys(station),
    station?.stationId,
    nowMs,
  );
}

function computeRouteObservedSupport(candidate = {}) {
  const conversionRate = clamp(Number(candidate?.routeObservedConversionRate) || 0, 0, 1);
  const reliability = clamp(Number(candidate?.routeObservedReliability) || 0, 0, 1);
  const skipScore = clamp(Number(candidate?.routeObservedSkipScore) || 0, 0, 1);
  return clamp(
    conversionRate * (0.55 + (reliability * 0.45)) * clamp(1 - skipScore, 0, 1),
    0,
    1
  );
}

function getCandidateDisplayedPrice(candidate) {
  const effectivePrice = Number(candidate?.station?.effectivePrice ?? candidate?.effectivePrice);
  if (Number.isFinite(effectivePrice) && effectivePrice > 0) {
    return effectivePrice;
  }
  const stationPrice = Number(candidate?.station?.price ?? candidate?.price);
  if (Number.isFinite(stationPrice) && stationPrice > 0) {
    return stationPrice;
  }
  return null;
}

function computeCandidateVisiblePriceLeadSavings(candidate, candidates = [], opts = DEFAULT_OPTIONS) {
  if (!candidate) return 0;
  const candidatePrice = getCandidateDisplayedPrice(candidate);
  if (!Number.isFinite(candidatePrice)) return 0;
  const visiblePrices = (Array.isArray(candidates) ? candidates : [])
    .map(entry => getCandidateDisplayedPrice(entry))
    .filter(price => Number.isFinite(price))
    .sort((left, right) => left - right);
  if (!visiblePrices.length) {
    return 0;
  }
  const cheapestPrice = visiblePrices[0];
  if (!Number.isFinite(cheapestPrice) || candidatePrice > (cheapestPrice + (opts.visiblePriceLeaderTolerancePerGal || 0))) {
    return 0;
  }
  const secondCheapestPrice = visiblePrices.length > 1 ? visiblePrices[1] : cheapestPrice;
  if (!Number.isFinite(secondCheapestPrice)) {
    return 0;
  }
  return Math.max(0, secondCheapestPrice - candidatePrice);
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
  const timePatternScore = context.candidate
    ? (Number(context.candidate.timePatternScore) || 0)
    : computeTimePatternScore(station, profile, nowMs);
  const routeHabitShare = context.candidate
    ? clamp(Number(context.candidate.routeHabitShare) || 0, 0, 1)
    : computeRouteStationHabitShare(profile, station, nowMs);
  const brandAffinity = computeBrandAffinity(station, profile);
  const observedBehaviorStrength = context.candidate
    ? computeObservedBehaviorStrength(context.candidate)
    : 0;
  const observedConversionRate = context.candidate
    ? clamp(Number(context.candidate.observedConversionRate) || 0, 0, 1)
    : 0;
  const contextualObservedConversionRate = context.candidate
    ? clamp(Number(context.candidate.contextualObservedConversionRate) || 0, 0, 1)
    : 0;
  const observedSkipScore = context.candidate
    ? clamp(Number(context.candidate.observedSkipScore) || 0, 0, 1)
    : 0;
  const observedSkipPenalty = clamp(
    observedSkipScore -
    (contextualObservedConversionRate * 0.75) -
    (observedConversionRate * 0.50) -
    ((context.candidate ? clamp(Number(context.candidate.visitShare) || 0, 0, 1) : 0) * 0.12),
    0,
    1
  );
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
    historyScore * (0.22 + (historyContextMatch * 0.78)),
    routeHabitShare * (0.34 + (historyContextMatch * 0.40))
  );
  const learnedStrength = Math.max(historicalStrength, observedBehaviorStrength);
  const learnedIntent = clamp(
    (historicalStrength * 0.44) +
    (observedBehaviorStrength * 0.30) +
    (contextualHistoryScore * 0.10) +
    (routeHabitShare * 0.12) +
    (brandAffinity * 0.10) +
    (historyContextMatch * 0.04) +
    (contextualObservedConversionRate * 0.06) +
    (observedConversionRate * 0.02) -
    (observedSkipPenalty * 0.18),
    0,
    1
  );
  const adjustedColdStartScore = clamp(
    coldStartScore +
    (routeHabitShare * 0.04) +
    (contextualObservedConversionRate * 0.06) +
    (observedConversionRate * 0.04) -
    (observedSkipPenalty * 0.28),
    0,
    1
  );

  if (learnedStrength >= 0.20) {
    return clamp((learnedIntent * 0.76) + (adjustedColdStartScore * 0.24), 0, 1);
  }
  if (learnedStrength >= 0.12) {
    return clamp((learnedIntent * 0.60) + (adjustedColdStartScore * 0.40), 0, 1);
  }
  return clamp((adjustedColdStartScore * 0.74) + (learnedIntent * 0.26), 0, 1);
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
  const emitSkip = (reason, extra = {}) => {
    if (typeof opts.onRecommendationSkipped === 'function') {
      opts.onRecommendationSkipped({
        reason,
        routeId: opts.routeId || null,
        routeSampleIndex: Number.isInteger(opts.routeSampleIndex) ? opts.routeSampleIndex : null,
        routeSampleCount: Number.isInteger(opts.routeSampleCount) ? opts.routeSampleCount : null,
        routeProgress: Number.isFinite(Number(opts.routeProgress)) ? Number(opts.routeProgress) : null,
        ...extra,
      });
    }
    return null;
  };
  if (!window || window.length < opts.minWindowSize) return emitSkip('window_too_small');
  if (!stations || stations.length === 0) return emitSkip('no_stations');

  // Require the vehicle to be actively driving. Multiple sub-1mps samples in
  // a row mean "parked", not "at a stop light".
  const recent = window.slice(-Math.max(6, opts.minWindowSize + 1));
  const activeRecent = recent.filter(s => (s.speed || 0) >= opts.stoppedSpeedMps);
  const trafficPause = inferTrafficPause(recent, opts);
  const allowsTrafficPauseEvaluation = trafficPause.likelyTrafficPause || trafficPause.stopLightLike || trafficPause.stopSignLike;
  if (activeRecent.length < 3 && !allowsTrafficPauseEvaluation) {
    return emitSkip('not_actively_driving', {
      activeRecentCount: activeRecent.length,
      trafficPauseLike: allowsTrafficPauseEvaluation,
    });
  }
  // Reject unreasonable speeds (driving modes only).
  const maxSpeedInWindow = Math.max(...window.map(s => s.speed || 0));
  if (maxSpeedInWindow > opts.maxDrivingSpeedMps) {
    return emitSkip('unreasonable_speed', {
      maxSpeedInWindow,
    });
  }

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
  const tripDistanceMeters = Math.max(0, Number(options.tripDistanceMeters) || 0);
  const estimatedRemainingMiles = Number(fuelState?.estimatedRemainingMiles) || 0;
  const tripDemandPressure = estimatedRemainingMiles > 0
    ? clamp(
      ((tripDistanceMeters / 1609.344) + (effectiveProjectionDistance / 1609.344)) /
      Math.max(30, estimatedRemainingMiles),
      0,
      2
    )
    : 0;
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
  if (candidates.length === 0) {
    return emitSkip('no_corridor_candidates', {
      effectiveProjectionDistance,
      effectiveCorridorHalfWidthMeters,
      effectiveMinTriggerDistanceMeters,
    });
  }

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
    const rawGenericHistoryScore = computeHistoryScore(candidate.station, profile, nowMs);
    const rawContextualHistoryScore = computeContextualHistoryScore(candidate.station, profile, nowMs, liveHistoryContext);
    const rawHistoryContextMatch = computeHistoryContextMatch(candidate.station, profile, nowMs, liveHistoryContext);
    const observedConversionRate = computeObservedConversionRate(candidate.station, profile);
    const contextualObservedConversionRate = computeContextualObservedConversionRate(candidate.station, profile, nowMs, liveHistoryContext);
    const exposureContextMatch = computeExposureContextMatch(candidate.station, profile, nowMs, liveHistoryContext);
    const observedSkipScore = computeObservedSkipScore(candidate.station, profile, nowMs, liveHistoryContext);
    const historyReliability = computeHistoryReliability({
      observedConversionRate,
      contextualObservedConversionRate,
      exposureContextMatch,
      observedSkipScore,
    });
    const genericHistoryScore = rawGenericHistoryScore * historyReliability;
    const contextualHistoryScore = rawContextualHistoryScore * historyReliability;
    const historyContextMatch = rawHistoryContextMatch * historyReliability;
    const timePatternScore = computeTimePatternScore(candidate.station, profile, nowMs) * historyReliability;
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
        timePatternScore,
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
      timePatternScore,
      historyReliability,
      observedConversionRate,
      contextualObservedConversionRate,
      exposureContextMatch,
      observedSkipScore,
      physicalIntentScore,
      physicalFeatures,
    };
  }).map(candidate => {
    const observedBehaviorStrength = computeObservedBehaviorStrength(candidate);
    const routeHabitShare = computeRouteStationHabitShare(profile, candidate.station, nowMs);
    const routeObservedMetrics = computeRouteStationObservedMetrics(profile, candidate.station, nowMs);
    const routeObservedSupport = computeRouteObservedSupport({
      routeObservedConversionRate: routeObservedMetrics.conversionRate,
      routeObservedSkipScore: routeObservedMetrics.skipScore,
      routeObservedReliability: routeObservedMetrics.reliability,
    });
    const historyStrengthCandidate = Math.max(
      candidate.contextualHistoryScore || 0,
      candidate.timePatternScore || 0,
      (candidate.genericHistoryScore || 0) * (0.22 + ((candidate.historyContextMatch || 0) * 0.78)),
      routeHabitShare * (0.34 + ((candidate.historyContextMatch || 0) * 0.40)),
      (routeObservedMetrics.conversionRate || 0) * (0.22 + ((routeObservedMetrics.reliability || 0) * 0.26)),
      observedBehaviorStrength * 0.95
    );
    return {
      ...candidate,
      visitShare: computeVisitShare(candidate.station, profile),
      routeHabitShare,
      routeObservedConversionRate: routeObservedMetrics.conversionRate || 0,
      routeObservedExposureShare: routeObservedMetrics.exposureShare || 0,
      routeObservedSkipScore: routeObservedMetrics.skipScore || 0,
      routeObservedReliability: routeObservedMetrics.reliability || 0,
      routeObservedExposureCount: routeObservedMetrics.exposureCount || 0,
      routeObservedSupport,
      observedBehaviorStrength,
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
  let scored = initiallyScored.map(candidate => ({
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
  const visibleDisplayedPrices = scored
    .map(candidate => getCandidateDisplayedPrice(candidate))
    .filter(price => Number.isFinite(price))
    .sort((left, right) => left - right);
  const cheapestVisibleDisplayedPrice = visibleDisplayedPrices[0] ?? null;
  const secondCheapestVisibleDisplayedPrice = visibleDisplayedPrices.length > 1
    ? visibleDisplayedPrices[1]
    : cheapestVisibleDisplayedPrice;
  const mostExpensiveVisibleDisplayedPrice = visibleDisplayedPrices.length
    ? visibleDisplayedPrices[visibleDisplayedPrices.length - 1]
    : cheapestVisibleDisplayedPrice;
  const visibleMarketPriceSpread = (
    Number.isFinite(cheapestVisibleDisplayedPrice) &&
    Number.isFinite(mostExpensiveVisibleDisplayedPrice)
  )
    ? Math.max(0, mostExpensiveVisibleDisplayedPrice - cheapestVisibleDisplayedPrice)
    : 0;
  scored = scored.map(candidate => {
    const displayedPrice = getCandidateDisplayedPrice(candidate);
    const priceLeader = Boolean(
      Number.isFinite(displayedPrice) &&
      Number.isFinite(cheapestVisibleDisplayedPrice) &&
      displayedPrice <= (cheapestVisibleDisplayedPrice + opts.visiblePriceLeaderTolerancePerGal)
    );
    const visiblePriceGapToCheapest = (
      Number.isFinite(displayedPrice) &&
      Number.isFinite(cheapestVisibleDisplayedPrice)
    )
      ? Math.max(0, displayedPrice - cheapestVisibleDisplayedPrice)
      : 0;
    const visiblePriceGapToSecondCheapest = (
      priceLeader &&
      Number.isFinite(displayedPrice) &&
      Number.isFinite(secondCheapestVisibleDisplayedPrice)
    )
      ? Math.max(0, secondCheapestVisibleDisplayedPrice - displayedPrice)
      : 0;
    const visiblePriceOpportunity = (
      priceLeader &&
      Number.isFinite(displayedPrice) &&
      Number.isFinite(mostExpensiveVisibleDisplayedPrice)
    )
      ? Math.max(0, mostExpensiveVisibleDisplayedPrice - displayedPrice)
      : 0;
    return {
      ...candidate,
      effectiveStationPrice: displayedPrice,
      priceLeader,
      visiblePriceGapToCheapest,
      visiblePriceGapToSecondCheapest,
      visiblePriceOpportunity,
      visibleMarketPriceSpread,
    };
  });
  const computeCandidateVisibleSavings = candidate => {
    if (!candidate) return 0;
    const nextBestVisible = [...scored]
      .filter(entry => entry?.station?.stationId !== candidate?.station?.stationId)
      .sort((left, right) =>
        (Number(left?.netStationCost) || Number.POSITIVE_INFINITY) - (Number(right?.netStationCost) || Number.POSITIVE_INFINITY)
      )[0] || null;
    if (!nextBestVisible) {
      return 0;
    }
    return Math.max(
      0,
      (Number(nextBestVisible.netStationCost) || Number.POSITIVE_INFINITY) -
      (Number(candidate.netStationCost) || Number.POSITIVE_INFINITY)
    );
  };
  const recentFillPrices = (Array.isArray(profile?.fillUpHistory) ? profile.fillUpHistory : [])
    .slice(-opts.estimatedSavingsRecentFillWindow)
    .map(entry => Number(entry?.pricePerGallon))
    .filter(value => Number.isFinite(value) && value > 0);
  const recentFillPriceBaseline = recentFillPrices.length >= opts.estimatedSavingsMinRecentFills
    ? [...recentFillPrices].sort((left, right) => left - right)[Math.floor(recentFillPrices.length / 2)]
    : null;
  const computeCandidateEstimatedSavings = candidate => {
    if (!candidate) return 0;
    const visibleSavings = computeCandidateVisibleSavings(candidate);
    const candidatePrice = Number(candidate?.effectiveStationPrice) ||
      Number(candidate?.station?.price) ||
      Number(candidate?.station?.observedPrice) ||
      0;
    const historyBaselineOpportunity = (
      Number.isFinite(recentFillPriceBaseline) &&
      candidatePrice > 0
    )
      ? clamp(recentFillPriceBaseline - candidatePrice, 0, opts.estimatedSavingsMaxHistoryDelta)
      : 0;
    const visiblePriceOpportunity = clamp(
      Number(candidate?.visiblePriceOpportunity) || 0,
      0,
      opts.estimatedSavingsMaxHistoryDelta
    );
    return Math.max(visibleSavings, visiblePriceOpportunity, historyBaselineOpportunity);
  };
  const rankedByDestination = [...scored].sort((a, b) =>
    b.effectiveDestinationProbability - a.effectiveDestinationProbability ||
    b.destinationProbability - a.destinationProbability
  );
  const rankedByObservedBehavior = [...scored].sort((a, b) =>
    (b.observedBehaviorStrength || 0) - (a.observedBehaviorStrength || 0) ||
    (b.effectiveDestinationProbability || 0) - (a.effectiveDestinationProbability || 0)
  );

  // Find the user's "predicted default" — the candidate with highest
  // destinationProbability. This is where they'd stop if the app didn't say
  // anything.
  const coldStartPredictedDefault = [...scored].sort((a, b) =>
    (a.netStationCost - (a.intentEvidence * 0.22) - (a.coldStartScore * 0.12)) -
    (b.netStationCost - (b.intentEvidence * 0.22) - (b.coldStartScore * 0.12)) ||
    b.intentEvidence - a.intentEvidence
  )[0] || null;
  const intentLeader = [...scored].sort((a, b) =>
    (b.intentEvidence || 0) - (a.intentEvidence || 0)
  )[0] || null;
  const valueLeader = [...scored].sort((a, b) =>
    (b.valueScore || 0) - (a.valueScore || 0)
  )[0] || null;
  const learnedPredictedDefault = rankedByDestination[0] || null;
  const learnedHistoryStrength = learnedPredictedDefault
    ? Math.max(learnedPredictedDefault.historyStrength || 0, learnedPredictedDefault.observedBehaviorStrength || 0)
    : 0;
  const totalHistoryVisits = Array.isArray(profile?.visitHistory)
    ? profile.visitHistory.reduce((sum, entry) => sum + (Number(entry?.visitCount) || 0), 0)
    : 0;
  const tripFuelIntentScore = computeTripFuelIntentScore(scored, opts, urgency, isHighwayCruise);
  const highFuelObservedDefaultOverride = Boolean(
    learnedPredictedDefault &&
    coldStartPredictedDefault &&
    learnedPredictedDefault.station?.stationId !== coldStartPredictedDefault.station?.stationId &&
    scored.length > 1 &&
    scored.length <= opts.highFuelObservedDefaultOverrideMaxCandidateCount &&
    totalHistoryVisits >= opts.highFuelObservedLowSpecificityMinHistoryVisits &&
    fuelNeedScore >= opts.highFuelObservedLowSpecificityMinFuelNeed &&
    tripFuelIntentScore >= opts.highFuelObservedLowSpecificityMinTripFuelIntentScore &&
    learnedPredictedDefault.alongTrack <= opts.highFuelObservedDefaultOverrideMaxDistanceMeters &&
    (learnedPredictedDefault.visitShare || 0) >= opts.highFuelObservedLowSpecificityMinVisitShare &&
    (
      (learnedPredictedDefault.contextualObservedConversionRate || 0) >= opts.highFuelObservedLowSpecificityMinContextualObservedConversionRate ||
      (learnedPredictedDefault.observedConversionRate || 0) >= opts.highFuelObservedLowSpecificityMinObservedConversionRate
    ) &&
    (learnedPredictedDefault.observedSkipScore || 0) <= opts.highFuelObservedLowSpecificityMaxObservedSkip &&
    (learnedPredictedDefault.intentEvidence || 0) >= opts.highFuelObservedLowSpecificityMinIntentEvidence &&
      (learnedPredictedDefault.effectiveDestinationProbability || 0) >= opts.highFuelObservedLowSpecificityMinEffectiveProbability
  );
  const observedBehaviorLeader = rankedByObservedBehavior[0] || null;
  const routeObservedLeader = [...scored].sort((a, b) =>
    (b.routeObservedSupport || 0) - (a.routeObservedSupport || 0) ||
    (b.routeHabitShare || 0) - (a.routeHabitShare || 0) ||
    (b.contextualObservedConversionRate || 0) - (a.contextualObservedConversionRate || 0) ||
    (b.effectiveDestinationProbability || 0) - (a.effectiveDestinationProbability || 0)
  )[0] || null;
  const routeSupportedColdStartDefaultOverride = Boolean(
    routeObservedLeader &&
    coldStartPredictedDefault &&
    routeObservedLeader.station?.stationId !== coldStartPredictedDefault.station?.stationId &&
    scored.length > 1 &&
    scored.length <= opts.routeSupportedColdStartOverrideMaxCandidateCount &&
    fuelNeedScore >= opts.routeSupportedColdStartOverrideMinFuelNeed &&
    tripFuelIntentScore >= opts.routeSupportedColdStartOverrideMinTripFuelIntentScore &&
    routeObservedLeader.alongTrack <= opts.routeSupportedColdStartOverrideMaxDistanceMeters &&
    (routeObservedLeader.routeHabitShare || 0) >= opts.routeSupportedColdStartOverrideMinRouteHabitShare &&
    (routeObservedLeader.routeObservedSupport || 0) >= opts.routeSupportedColdStartOverrideMinRouteObservedSupport &&
    (routeObservedLeader.contextualObservedConversionRate || 0) >= opts.routeSupportedColdStartOverrideMinContextualObservedConversionRate &&
    (routeObservedLeader.routeObservedSkipScore || 0) <= opts.routeSupportedColdStartOverrideMaxRouteObservedSkip &&
    (routeObservedLeader.intentEvidence || 0) >= opts.routeSupportedColdStartOverrideMinIntentEvidence &&
    (routeObservedLeader.effectiveDestinationProbability || 0) >= opts.routeSupportedColdStartOverrideMinEffectiveProbability &&
    Math.abs(
      (coldStartPredictedDefault.effectiveDestinationProbability || 0) -
      (routeObservedLeader.effectiveDestinationProbability || 0)
    ) <= opts.routeSupportedColdStartOverrideMaxLeadGap &&
    (coldStartPredictedDefault.routeHabitShare || 0) <= opts.routeSupportedColdStartDefaultMaxRouteHabitShare &&
    (coldStartPredictedDefault.routeObservedSupport || 0) <= opts.routeSupportedColdStartDefaultMaxRouteObservedSupport &&
    (coldStartPredictedDefault.observedBehaviorStrength || 0) <= opts.routeSupportedColdStartDefaultMaxObservedBehaviorStrength
  );
  const nearTieObservedDefaultOverride = Boolean(
    opts.enableNearTieObservedDefaultOverride &&
    observedBehaviorLeader &&
    coldStartPredictedDefault &&
    observedBehaviorLeader.station?.stationId !== coldStartPredictedDefault.station?.stationId &&
    scored.length > 1 &&
    scored.length <= opts.nearTieObservedDefaultOverrideMaxCandidateCount &&
    totalHistoryVisits >= opts.nearTieObservedDefaultOverrideMinHistoryVisits &&
    tripFuelIntentScore >= opts.nearTieObservedDefaultOverrideMinTripFuelIntentScore &&
    observedBehaviorLeader.alongTrack <= opts.nearTieObservedDefaultOverrideMaxDistanceMeters &&
    (observedBehaviorLeader.visitShare || 0) >= opts.nearTieObservedDefaultOverrideMinVisitShare &&
    (
      (observedBehaviorLeader.contextualObservedConversionRate || 0) >= opts.nearTieObservedDefaultOverrideMinContextualObservedConversionRate ||
      (observedBehaviorLeader.observedConversionRate || 0) >= opts.nearTieObservedDefaultOverrideMinObservedConversionRate
    ) &&
    (observedBehaviorLeader.observedSkipScore || 0) <= opts.nearTieObservedDefaultOverrideMaxObservedSkip &&
    (observedBehaviorLeader.intentEvidence || 0) >= opts.nearTieObservedDefaultOverrideMinIntentEvidence &&
    Math.abs(
      (coldStartPredictedDefault.effectiveDestinationProbability || 0) -
      (observedBehaviorLeader.effectiveDestinationProbability || 0)
    ) <= opts.nearTieObservedDefaultOverrideMaxLeadGap &&
    Math.max(
      coldStartPredictedDefault.visitShare || 0,
      coldStartPredictedDefault.routeHabitShare || 0,
      coldStartPredictedDefault.routeObservedSupport || 0,
      coldStartPredictedDefault.observedBehaviorStrength || 0,
      coldStartPredictedDefault.contextualObservedConversionRate || 0,
      coldStartPredictedDefault.observedConversionRate || 0
    ) <= opts.nearTieObservedDefaultOverrideColdStartDefaultMaxObservedSupport &&
    (coldStartPredictedDefault.observedSkipScore || 0) >= opts.nearTieObservedDefaultOverrideColdStartDefaultMinObservedSkip
  );
  const skipDominatedColdStartDefaultOverride = Boolean(
    observedBehaviorLeader &&
    coldStartPredictedDefault &&
    intentLeader &&
    observedBehaviorLeader.station?.stationId !== coldStartPredictedDefault.station?.stationId &&
    observedBehaviorLeader.station?.stationId === intentLeader.station?.stationId &&
    scored.length > 1 &&
    scored.length <= opts.skipDominatedColdStartOverrideMaxCandidateCount &&
    totalHistoryVisits >= opts.highFuelObservedLowSpecificityMinHistoryVisits &&
    fuelNeedScore >= opts.skipDominatedColdStartOverrideMinFuelNeed &&
    tripFuelIntentScore >= opts.skipDominatedColdStartOverrideMinTripFuelIntentScore &&
    observedBehaviorLeader.alongTrack <= opts.skipDominatedColdStartOverrideMaxDistanceMeters &&
    (observedBehaviorLeader.visitShare || 0) >= opts.skipDominatedColdStartOverrideMinVisitShare &&
    (observedBehaviorLeader.routeHabitShare || 0) >= opts.skipDominatedColdStartOverrideMinRouteHabitShare &&
    (
      (observedBehaviorLeader.contextualObservedConversionRate || 0) >= opts.skipDominatedColdStartOverrideMinContextualObservedConversionRate ||
      (observedBehaviorLeader.observedConversionRate || 0) >= opts.skipDominatedColdStartOverrideMinObservedConversionRate
    ) &&
    (observedBehaviorLeader.observedSkipScore || 0) <= opts.skipDominatedColdStartOverrideMaxObservedSkip &&
    (observedBehaviorLeader.intentEvidence || 0) >= opts.skipDominatedColdStartOverrideMinIntentEvidence &&
    (observedBehaviorLeader.effectiveDestinationProbability || 0) >= opts.skipDominatedColdStartOverrideMinEffectiveProbability &&
    Math.abs(
      (coldStartPredictedDefault.effectiveDestinationProbability || 0) -
      (observedBehaviorLeader.effectiveDestinationProbability || 0)
    ) <= opts.skipDominatedColdStartOverrideMaxLeadGap &&
    (coldStartPredictedDefault.observedBehaviorStrength || 0) <= opts.skipDominatedColdStartDefaultMaxObservedBehaviorStrength &&
    (coldStartPredictedDefault.observedSkipScore || 0) >= opts.skipDominatedColdStartDefaultMinObservedSkip
  );
  const predictedDefault = highFuelObservedDefaultOverride
    ? learnedPredictedDefault
    : routeSupportedColdStartDefaultOverride
    ? routeObservedLeader
    : nearTieObservedDefaultOverride
    ? observedBehaviorLeader
    : skipDominatedColdStartDefaultOverride
    ? observedBehaviorLeader
    : (learnedHistoryStrength < 0.20)
    ? coldStartPredictedDefault
    : learnedPredictedDefault;
  const runnerUp = rankedByDestination[1] || null;
  const leadMargin = predictedDefault && runnerUp
    ? predictedDefault.effectiveDestinationProbability - runnerUp.effectiveDestinationProbability
    : (predictedDefault ? predictedDefault.effectiveDestinationProbability : 0);
  const predictedDefaultNetCostAdvantage = predictedDefault && runnerUp
    ? Math.max(0, (Number(runnerUp.netStationCost) || Number.POSITIVE_INFINITY) - (Number(predictedDefault.netStationCost) || Number.POSITIVE_INFINITY))
    : 0;
  const predictedDefaultVisibleSavings = predictedDefault
    ? computeCandidateVisibleSavings(predictedDefault)
    : 0;
  const predictedDefaultEstimatedSavings = predictedDefault
    ? computeCandidateEstimatedSavings(predictedDefault)
    : 0;
  const historyStrength = predictedDefault
    ? Math.max(
      predictedDefault.contextualHistoryScore || 0,
      predictedDefault.timePatternScore || 0,
      (predictedDefault.genericHistoryScore || 0) * (0.22 + ((predictedDefault.historyContextMatch || 0) * 0.78))
    )
    : 0;
  const timePatternStrength = predictedDefault
    ? (predictedDefault.timePatternScore || 0)
    : 0;
  const tripFuelIntentThreshold = computeTripFuelIntentThreshold(opts, urgency, historyStrength, isHighwayCruise);
  const predictedBrandAffinity = clamp(predictedDefault?.brandAffinity || 0, 0, 1);
  const profileValueSeekingScore = computeProfileValueSeekingScore(profile, stations);
  const opportunisticFillScore = computeOpportunisticFillScore(profile, fuelState);
  const singleRoutineCandidate = scored.length === 1 ? scored[0] : null;
  const singleCandidateRoutineFallbackAllowed = Boolean(
    singleRoutineCandidate &&
    totalHistoryVisits >= opts.singleCandidateRoutineMinHistoryVisits &&
    predictedDefault?.station?.stationId === singleRoutineCandidate.station?.stationId &&
    (
      (singleRoutineCandidate.contextualObservedConversionRate || 0) >= opts.singleCandidateRoutineMinContextualObservedConversionRate ||
      (singleRoutineCandidate.observedConversionRate || 0) >= opts.singleCandidateRoutineMinObservedConversionRate
    ) &&
    (singleRoutineCandidate.visitShare || 0) >= opts.singleCandidateRoutineMinVisitShare &&
    (singleRoutineCandidate.observedSkipScore || 0) <= opts.singleCandidateRoutineMaxObservedSkip
  );
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
    totalHistoryVisits >= opts.historyRecoveryMinTotalVisits &&
    (predictedDefault.visitShare || 0) >= opts.historyRecoveryMinVisitShare &&
    (predictedDefault.observedSkipScore || 0) <= opts.historyRecoveryMaxObservedSkip &&
    predictedDefault.alongTrack >= effectiveMinTriggerDistanceMeters &&
    predictedDefault.alongTrack <= historyRecoveryMaxDistanceMeters &&
    predictedDefault.effectiveDestinationProbability >= opts.historyRecoveryMinProbability &&
    (predictedDefault.intentEvidence || 0) >= opts.historyRecoveryMinIntentEvidence &&
    (predictedDefault.valueScore || 0) >= opts.historyRecoveryMinValueScore &&
    predictedDefaultPathScore >= opts.historyRecoveryMinPathScore &&
    fuelNeedScore >= historyRecoveryMinFuelNeed &&
    tripFuelIntentScore >= historyRecoveryTripIntentFloor
  );
  const predictedDefaultObservedBehaviorEdge = predictedDefault
    ? Math.max(
      0,
      (predictedDefault.observedBehaviorStrength || 0) - (
        rankedByObservedBehavior.find(candidate =>
          candidate.station?.stationId !== predictedDefault.station?.stationId
        )?.observedBehaviorStrength || 0
      )
    )
    : 0;

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
    const routeSampleIndex = Number.isInteger(opts.routeSampleIndex)
      ? opts.routeSampleIndex
      : null;
    const routeSampleCount = Number.isInteger(opts.routeSampleCount)
      ? opts.routeSampleCount
      : null;
    const routeProgress = Number.isFinite(Number(opts.routeProgress))
      ? Number(opts.routeProgress)
      : (
        routeSampleIndex != null &&
        routeSampleCount != null &&
        routeSampleCount > 1
          ? routeSampleIndex / (routeSampleCount - 1)
          : null
      );

    return {
      routeId: opts.routeId || null,
      routeSampleIndex,
      routeSampleCount,
      routeProgress,
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
      tripDistanceMeters,
      tripDemandPressure,
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
          effectivePrice: candidate.effectiveStationPrice ?? null,
          accessPenaltyPrice: candidate.accessPenaltyPrice || 0,
          netStationCost: candidate.netStationCost || 0,
          priceLeader: Boolean(candidate.priceLeader),
          visiblePriceGapToCheapest: candidate.visiblePriceGapToCheapest || 0,
          visiblePriceGapToSecondCheapest: candidate.visiblePriceGapToSecondCheapest || 0,
          visiblePriceOpportunity: candidate.visiblePriceOpportunity || 0,
          visibleMarketPriceSpread: candidate.visibleMarketPriceSpread || 0,
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
          routeHabitShare: candidate.routeHabitShare || 0,
          routeObservedConversionRate: candidate.routeObservedConversionRate || 0,
          routeObservedExposureShare: candidate.routeObservedExposureShare || 0,
          routeObservedSkipScore: candidate.routeObservedSkipScore || 0,
          routeObservedReliability: candidate.routeObservedReliability || 0,
          routeObservedExposureCount: candidate.routeObservedExposureCount || 0,
          routeObservedSupport: candidate.routeObservedSupport || 0,
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
          observedBehaviorStrength: candidate.observedBehaviorStrength || 0,
          observedBehaviorRank: rankCandidate(rankedByObservedBehavior, candidate, 'observedBehaviorStrength'),
          observedBehaviorMarginToLeader: computeLeaderMargin(rankedByObservedBehavior, candidate, 'observedBehaviorStrength'),
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
        tripDistanceMeters,
        tripDemandPressure,
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
      candidateEffectivePrice: candidate.effectiveStationPrice ?? null,
      candidateAccessPenaltyPrice: candidate.accessPenaltyPrice || 0,
      candidateNetStationCost: candidate.netStationCost || 0,
      candidateNetCostDeltaFromBest: Math.max(0, (candidate.netStationCost || 0) - (cheapestByNet?.netStationCost || 0)),
      candidatePriceLeader: Boolean(candidate.priceLeader),
      candidateVisiblePriceGapToCheapest: candidate.visiblePriceGapToCheapest || 0,
      candidateVisiblePriceGapToSecondCheapest: candidate.visiblePriceGapToSecondCheapest || 0,
      candidateVisiblePriceOpportunity: candidate.visiblePriceOpportunity || 0,
      candidateVisibleMarketPriceSpread: candidate.visibleMarketPriceSpread || 0,
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
      candidateRouteHabitShare: candidate.routeHabitShare || 0,
      candidateRouteObservedConversionRate: candidate.routeObservedConversionRate || 0,
      candidateRouteObservedExposureShare: candidate.routeObservedExposureShare || 0,
      candidateRouteObservedSkipScore: candidate.routeObservedSkipScore || 0,
      candidateRouteObservedReliability: candidate.routeObservedReliability || 0,
      candidateRouteObservedSupport: candidate.routeObservedSupport || 0,
      candidateObservedConversionRate: candidate.observedConversionRate || 0,
      candidateContextualObservedConversionRate: candidate.contextualObservedConversionRate || 0,
      candidateExposureContextMatch: candidate.exposureContextMatch || 0,
      candidateObservedSkipScore: candidate.observedSkipScore || 0,
      candidateObservedBehaviorStrength: candidate.observedBehaviorStrength || 0,
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
      predictedDefaultRouteHabitShare: predictedDefault?.routeHabitShare || 0,
      predictedDefaultRouteObservedConversionRate: predictedDefault?.routeObservedConversionRate || 0,
      predictedDefaultRouteObservedSkipScore: predictedDefault?.routeObservedSkipScore || 0,
      predictedDefaultRouteObservedSupport: predictedDefault?.routeObservedSupport || 0,
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
      tripDistanceMeters,
      tripDemandPressure,
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
    const relaxedMinTriggerDistance = (
      recommendation.reason === 'Predicted stop (observed corridor capture)' ||
      recommendation.reason === 'Predicted stop (high-fuel corridor recovery)' ||
      recommendation.reason === 'Predicted stop (late observed corridor recovery)'
    )
      ? Math.max(1100, effectiveMinTriggerDistanceMeters - 400)
      : (
        typeof recommendation.reason === 'string' && recommendation.reason.startsWith('High-value stop ahead')
          ? Math.max(1200, effectiveMinTriggerDistanceMeters - 300)
          : effectiveMinTriggerDistanceMeters
      );
    if ((recommendation.forwardDistance || 0) < relaxedMinTriggerDistance) return null;
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
  function suppressRecommendation(reason, candidate = null, extra = {}) {
    if (typeof opts.onRecommendationSuppressed === 'function') {
      opts.onRecommendationSuppressed({
        reason,
        routeId: opts.routeId || null,
        routeSampleIndex: Number.isInteger(opts.routeSampleIndex) ? opts.routeSampleIndex : null,
        routeSampleCount: Number.isInteger(opts.routeSampleCount) ? opts.routeSampleCount : null,
        routeProgress: Number.isFinite(Number(opts.routeProgress)) ? Number(opts.routeProgress) : null,
        candidateStationId: candidate?.station?.stationId || null,
        predictedDefaultStationId: predictedDefault?.station?.stationId || null,
        decisionSnapshot: baseDecisionSnapshot,
        ...extra,
      });
    }
    return null;
  }

  // If we have a strong predicted default AND there's a cheaper one on the
  // same corridor that's not too much of a detour, recommend the cheaper one.
  if (predictedDefault && predictedDefault.effectiveDestinationProbability >= opts.cheaperAlternativeMinProbability) {
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
        const intentFactor = clamp(predictedDefault.effectiveDestinationProbability, opts.cheaperAlternativeMinProbability, 1.0);
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
      candidate.alongTrack >= effectiveMinTriggerDistanceMeters &&
      !(
        (candidate.observedSkipScore || 0) > 0.48 &&
        (candidate.observedBehaviorStrength || 0) < 0.08 &&
        (candidate.intentEvidence || 0) < 0.50
      )
    )
  );
  if (scored.length === 1) {
    const onlyCandidate = scored[0];
    const singleCandidateRouteHabitSupported = (onlyCandidate.routeHabitShare || 0) >= opts.routeHabitMinShare;
    const singleCandidateRouteHabitFallbackDriven = Boolean(
      singleCandidateRouteHabitSupported &&
      (onlyCandidate.visitShare || 0) < opts.strongObservedRoutineMinVisitShare &&
      (onlyCandidate.contextualObservedConversionRate || 0) < opts.strongObservedRoutineMinContextualObservedConversionRate
    );
    const singleCandidateRouteHabitFallbackProbabilityFloor = (
      singleCandidateRouteHabitFallbackDriven &&
      onlyCandidate.alongTrack > opts.routeHabitFallbackLongDistanceMeters
    )
      ? opts.routeHabitFallbackLongDistanceMinProbability
      : opts.routeHabitFallbackMinProbability;
    const brandHabitFallbackDriven = Boolean(
      (onlyCandidate.routeHabitShare || 0) >= opts.routeHabitObservedRoutineMinShare &&
      (onlyCandidate.brandAffinity || 0) >= opts.brandHabitFallbackMinBrandAffinity &&
      (onlyCandidate.visitShare || 0) < opts.brandHabitFallbackMinVisitShare &&
      (onlyCandidate.contextualObservedConversionRate || 0) < opts.brandHabitFallbackMaxContextualObservedConversionRate
    );
    const longDistanceLowNeedRoutine = Boolean(
      onlyCandidate.alongTrack > opts.lowNeedLongDistanceRoutineMeters &&
      fuelNeedScore < opts.lowNeedLongDistanceRoutineMinFuelNeed &&
      timePatternStrength < opts.strongObservedRoutineMinTimePatternStrength
    );
    const singleCandidateRoutineProbabilityFloor = Math.max(
      singleCandidateRouteHabitFallbackProbabilityFloor,
      brandHabitFallbackDriven ? opts.brandHabitFallbackMinProbability : 0,
      longDistanceLowNeedRoutine ? opts.lowNeedLongDistanceRoutineMinProbability : 0,
    );
    const singleCandidateRoutineMinProbability = singleCandidateRouteHabitSupported
      ? Math.max(0.18, opts.singleCandidateRoutineMinProbability - 0.04)
      : opts.singleCandidateRoutineMinProbability;
    const anchoredSingleCandidateRoutineMinProbability = singleCandidateRouteHabitSupported
      ? Math.max(0.12, opts.anchoredSingleCandidateRoutineMinProbability - 0.02)
      : opts.anchoredSingleCandidateRoutineMinProbability;
    const singleCandidateRoutineConfidence = clamp(
      (tripFuelIntentScore * 0.34) +
      ((onlyCandidate.intentEvidence || 0) * 0.24) +
      ((onlyCandidate.contextualObservedConversionRate || 0) * 0.16) +
      ((onlyCandidate.observedConversionRate || 0) * 0.10) +
      ((onlyCandidate.visitShare || 0) * 0.08) +
      ((onlyCandidate.routeHabitShare || 0) * 0.10) +
      (clamp(1 - (onlyCandidate.observedSkipScore || 0), 0, 1) * 0.08) +
      (clamp(1 - onlyCandidate.crossTrack / opts.corridorHalfWidthMeters, 0, 1) * 0.08),
      0,
      1
    );
    const singleCandidateRoutineEligible = (
      totalHistoryVisits >= opts.singleCandidateRoutineMinHistoryVisits &&
      predictedDefault?.station?.stationId === onlyCandidate.station?.stationId &&
      (predictedDefault?.effectiveDestinationProbability || 0) >= singleCandidateRoutineMinProbability &&
      onlyCandidate.alongTrack >= effectiveMinTriggerDistanceMeters &&
      onlyCandidate.alongTrack <= opts.singleCandidateRoutineMaxDistanceMeters &&
      tripFuelIntentScore >= (tripFuelIntentThreshold + opts.singleCandidateRoutineMinTripFuelIntentBuffer) &&
      (onlyCandidate.intentEvidence || 0) >= opts.singleCandidateRoutineMinIntentEvidence &&
      (
        (onlyCandidate.contextualObservedConversionRate || 0) >= opts.singleCandidateRoutineMinContextualObservedConversionRate ||
        (onlyCandidate.observedConversionRate || 0) >= opts.singleCandidateRoutineMinObservedConversionRate
      ) &&
      (
        (onlyCandidate.visitShare || 0) >= opts.singleCandidateRoutineMinVisitShare ||
        singleCandidateRouteHabitSupported
      ) &&
      (onlyCandidate.observedSkipScore || 0) <= opts.singleCandidateRoutineMaxObservedSkip &&
      (
        timePatternStrength >= opts.singleCandidateRoutineMinTimePatternStrength ||
        (onlyCandidate.contextualHistoryScore || 0) >= opts.singleCandidateRoutineMinTimePatternStrength ||
        singleCandidateRouteHabitSupported
      ) &&
      (
        !singleCandidateRouteHabitFallbackDriven ||
        (predictedDefault?.effectiveDestinationProbability || 0) >= singleCandidateRoutineProbabilityFloor
      ) &&
      singleCandidateRoutineConfidence >= Math.max(opts.triggerThreshold, opts.singleCandidateRoutineMinConfidence)
    );
    const anchoredSingleCandidateRoutineEligible = (
      !isHighwayCruise &&
      totalHistoryVisits >= opts.anchoredSingleCandidateRoutineMinHistoryVisits &&
      predictedDefault?.station?.stationId === onlyCandidate.station?.stationId &&
      (predictedDefault?.effectiveDestinationProbability || 0) >= anchoredSingleCandidateRoutineMinProbability &&
      onlyCandidate.alongTrack >= effectiveMinTriggerDistanceMeters &&
      onlyCandidate.alongTrack <= opts.anchoredSingleCandidateRoutineMaxDistanceMeters &&
      tripFuelIntentScore >= (tripFuelIntentThreshold + opts.anchoredSingleCandidateRoutineMinTripFuelIntentBuffer) &&
      fuelNeedScore >= opts.anchoredSingleCandidateRoutineMinFuelNeed &&
      (onlyCandidate.intentEvidence || 0) >= opts.anchoredSingleCandidateRoutineMinIntentEvidence &&
      (
        (onlyCandidate.contextualObservedConversionRate || 0) >= opts.anchoredSingleCandidateRoutineMinContextualObservedConversionRate ||
        (onlyCandidate.observedConversionRate || 0) >= opts.anchoredSingleCandidateRoutineMinObservedConversionRate
      ) &&
      (
        (onlyCandidate.visitShare || 0) >= opts.anchoredSingleCandidateRoutineMinVisitShare ||
        singleCandidateRouteHabitSupported
      ) &&
      (onlyCandidate.observedSkipScore || 0) <= opts.anchoredSingleCandidateRoutineMaxObservedSkip &&
      (
        timePatternStrength >= opts.anchoredSingleCandidateRoutineMinTimePatternStrength ||
        (onlyCandidate.contextualHistoryScore || 0) >= opts.anchoredSingleCandidateRoutineMinTimePatternStrength ||
        singleCandidateRouteHabitSupported
      ) &&
      (
        !singleCandidateRouteHabitFallbackDriven ||
        (predictedDefault?.effectiveDestinationProbability || 0) >= singleCandidateRoutineProbabilityFloor
      ) &&
      singleCandidateRoutineConfidence >= Math.max(opts.anchoredSingleCandidateRoutineMinConfidence, opts.triggerThreshold)
    );
    const timedRoutineRecoveryConfidence = clamp(
      singleCandidateRoutineConfidence +
      (historyStrength * 0.10) +
      (timePatternStrength * 0.10) +
      ((onlyCandidate.routeHabitShare || 0) * 0.08) +
      (fuelNeedScore * 0.05),
      0,
      1
    );
    const timedRoutineRecoveryEligible = (
      !isHighwayCruise &&
      totalHistoryVisits >= opts.timedRoutineRecoveryMinHistoryVisits &&
      predictedDefault?.station?.stationId === onlyCandidate.station?.stationId &&
      onlyCandidate.alongTrack >= effectiveMinTriggerDistanceMeters &&
      onlyCandidate.alongTrack <= opts.timedRoutineRecoveryMaxDistanceMeters &&
      historyStrength >= opts.timedRoutineRecoveryMinHistoryStrength &&
      (
        timePatternStrength >= opts.timedRoutineRecoveryMinTimePatternStrength ||
        singleCandidateRouteHabitSupported
      ) &&
      fuelNeedScore >= opts.timedRoutineRecoveryMinFuelNeed &&
      tripDemandPressure >= opts.timedRoutineRecoveryMinTripDemandPressure &&
      (predictedDefault?.effectiveDestinationProbability || 0) >= opts.timedRoutineRecoveryMinProbability &&
      (onlyCandidate.intentEvidence || 0) >= opts.timedRoutineRecoveryMinIntentEvidence &&
      (
        (onlyCandidate.contextualObservedConversionRate || 0) >= opts.timedRoutineRecoveryMinContextualObservedConversionRate ||
        (onlyCandidate.observedConversionRate || 0) >= opts.timedRoutineRecoveryMinObservedConversionRate
      ) &&
      (onlyCandidate.visitShare || 0) >= opts.timedRoutineRecoveryMinVisitShare &&
      (onlyCandidate.observedSkipScore || 0) <= opts.timedRoutineRecoveryMaxObservedSkip &&
      (
        !singleCandidateRouteHabitFallbackDriven ||
        (predictedDefault?.effectiveDestinationProbability || 0) >= singleCandidateRoutineProbabilityFloor
      ) &&
      timedRoutineRecoveryConfidence >= opts.timedRoutineRecoveryMinConfidence
    );
    if (singleCandidateRoutineEligible) {
      return finalizeRecommendation({
        stationId: onlyCandidate.station.stationId,
        type: 'predicted_stop',
        confidence: singleCandidateRoutineConfidence,
        reason: `Routine stop ahead (${Math.round(singleCandidateRoutineConfidence * 100)}% confidence, ${Math.round(onlyCandidate.alongTrack)}m out)`,
        forwardDistance: onlyCandidate.alongTrack,
        predictedDefault: onlyCandidate.station.stationId,
        savings: computeCandidateEstimatedSavings(onlyCandidate),
      }, onlyCandidate);
    }
    if (anchoredSingleCandidateRoutineEligible) {
      return finalizeRecommendation({
        stationId: onlyCandidate.station.stationId,
        type: 'predicted_stop',
        confidence: singleCandidateRoutineConfidence,
        reason: `Anchored routine stop ahead (${Math.round(singleCandidateRoutineConfidence * 100)}% confidence, ${Math.round(onlyCandidate.alongTrack)}m out)`,
        forwardDistance: onlyCandidate.alongTrack,
        predictedDefault: onlyCandidate.station.stationId,
        savings: computeCandidateEstimatedSavings(onlyCandidate),
      }, onlyCandidate);
    }
    if (timedRoutineRecoveryEligible) {
      return finalizeRecommendation({
        stationId: onlyCandidate.station.stationId,
        type: 'predicted_stop',
        confidence: timedRoutineRecoveryConfidence,
        reason: `Timed routine stop ahead (${Math.round(timedRoutineRecoveryConfidence * 100)}% confidence, ${Math.round(onlyCandidate.alongTrack)}m out)`,
        forwardDistance: onlyCandidate.alongTrack,
        predictedDefault: onlyCandidate.station.stationId,
        savings: computeCandidateEstimatedSavings(onlyCandidate),
      }, onlyCandidate);
    }
  }

  // Fall-through: predicted-stop mode. If we have a high-probability default
  // station ahead and no better alternative, still surface the info so the
  // driver knows the app is tracking them — this is the "confirm the plan"
  // notification.
  if (predictedDefault && !shouldSuppressDefaultForCheaperOption) {
    const allowUrgentHighwayFallback = (
      isHighwayCruise &&
      urgency >= opts.urgencyOnlyThreshold &&
      fuelNeedScore >= opts.fuelNeedHighThreshold
    );
    if (speculativeUrbanHistoryMode) {
      return suppressRecommendation('predicted_stop_speculative_urban_history', predictedDefault);
    }
    const strongObservedRoutineLiveIntentAssist = Boolean(
      !isHighwayCruise &&
      scored.length === 1 &&
      totalHistoryVisits >= opts.strongObservedRoutineMinHistoryVisits &&
      fuelNeedScore >= opts.strongObservedRoutineMinFuelNeed &&
      (
        (predictedDefault.visitShare || 0) >= opts.strongObservedRoutineMinVisitShare ||
        (predictedDefault.routeHabitShare || 0) >= opts.routeHabitObservedRoutineMinShare
      ) &&
      (predictedDefault.observedSkipScore || 0) <= opts.strongObservedRoutineMaxObservedSkip &&
      (
        (predictedDefault.contextualObservedConversionRate || 0) >= opts.strongObservedRoutineMinContextualObservedConversionRate ||
        (predictedDefault.observedConversionRate || 0) >= opts.strongObservedRoutineMinObservedConversionRate
      ) &&
      (
        timePatternStrength >= opts.strongObservedRoutineMinTimePatternStrength ||
        (predictedDefault.routeHabitShare || 0) >= opts.routeHabitObservedRoutineMinShare
      )
    );
    const minimumTripFuelIntentScore = strongObservedRoutineLiveIntentAssist
      ? Math.max(
        0,
        tripFuelIntentThreshold - opts.strongObservedRoutineLiveIntentBuffer
      )
      : tripFuelIntentThreshold;
    const insufficientLiveIntent = (
      tripFuelIntentScore < minimumTripFuelIntentScore ||
      (
        urgency < 0.82 &&
        predictedDefault.alongTrack > opts.maxSpeculativeDistanceMeters &&
        predictedDefault.intentEvidence < 0.54 &&
        tripFuelIntentScore < (
          strongObservedRoutineLiveIntentAssist
            ? Math.max(0, tripFuelIntentThreshold - (opts.strongObservedRoutineLiveIntentBuffer * 0.5))
            : (tripFuelIntentThreshold + 0.08)
        )
      )
    );
    if (insufficientLiveIntent) {
      return suppressRecommendation('predicted_stop_insufficient_live_intent', predictedDefault);
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
    const routeHabitHistoryConfirmationOverride = Boolean(
      predictedDefault &&
      scored.length <= opts.routeHabitHistoryConfirmationOverrideMaxCandidateCount &&
      (predictedDefault.routeHabitShare || 0) >= opts.routeHabitHistoryConfirmationOverrideMinRouteHabitShare &&
      (predictedDefault.visitShare || 0) >= opts.routeHabitHistoryConfirmationOverrideMinVisitShare &&
      (predictedDefault.contextualObservedConversionRate || 0) >= opts.routeHabitHistoryConfirmationOverrideMinContextualObservedConversionRate &&
      (predictedDefault.intentEvidence || 0) >= opts.routeHabitHistoryConfirmationOverrideMinIntentEvidence &&
      tripFuelIntentScore >= opts.routeHabitHistoryConfirmationOverrideMinTripFuelIntentScore &&
      (predictedDefault.effectiveDestinationProbability || 0) >= opts.routeHabitHistoryConfirmationOverrideMinEffectiveProbability &&
      (predictedDefault.observedSkipScore || 0) <= opts.routeHabitHistoryConfirmationOverrideMaxObservedSkip
    );
    const routeHabitLowNeedConfirmationOverride = Boolean(
      predictedDefault &&
      scored.length <= opts.routeHabitHistoryConfirmationOverrideMaxCandidateCount &&
      (predictedDefault.routeHabitShare || 0) >= opts.routeHabitLowNeedConfirmationOverrideMinRouteHabitShare &&
      (predictedDefault.visitShare || 0) >= opts.routeHabitLowNeedConfirmationOverrideMinVisitShare &&
      (predictedDefault.contextualObservedConversionRate || 0) >= opts.routeHabitLowNeedConfirmationOverrideMinContextualObservedConversionRate &&
      tripFuelIntentScore >= opts.routeHabitLowNeedConfirmationOverrideMinTripFuelIntentScore &&
      fuelNeedScore <= opts.routeHabitLowNeedConfirmationOverrideMaxFuelNeed &&
      (predictedDefault.effectiveDestinationProbability || 0) >= opts.routeHabitLowNeedConfirmationOverrideMinEffectiveProbability &&
      (predictedDefault.observedSkipScore || 0) <= opts.routeHabitLowNeedConfirmationOverrideMaxObservedSkip
    );
    if (
      historyNeedsConfirmation &&
      !routeHabitHistoryConfirmationOverride &&
      !routeHabitLowNeedConfirmationOverride
    ) {
      return suppressRecommendation('predicted_stop_history_needs_confirmation', predictedDefault);
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
      return suppressRecommendation('predicted_stop_speculative_weak_history_city_guard', predictedDefault);
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
        return suppressRecommendation('predicted_stop_weak_specificity_history_guard', predictedDefault);
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
      return suppressRecommendation('predicted_stop_diffuse_history_dominated', predictedDefault);
    }
    const strongObservedPatternCandidate = (
      totalHistoryVisits >= opts.observedPatternMinHistoryVisits &&
      (predictedDefault.observedBehaviorStrength || 0) >= (opts.observedPatternMinObservedBehaviorStrength + 0.02) &&
      (
        (predictedDefault.contextualObservedConversionRate || 0) >= opts.observedPatternMinContextualObservedConversionRate ||
        (predictedDefault.observedConversionRate || 0) >= opts.observedPatternMinObservedConversionRate
      ) &&
      (predictedDefault.visitShare || 0) >= opts.observedPatternMinVisitShare &&
      (predictedDefault.observedSkipScore || 0) <= Math.min(0.44, opts.observedPatternMaxObservedSkip) &&
      predictedDefaultObservedBehaviorEdge >= Math.max(0.06, opts.observedPatternMinBehaviorEdge) &&
      (predictedDefault.intentEvidence || 0) >= opts.observedPatternMinIntentEvidence &&
      tripFuelIntentScore >= (tripFuelIntentThreshold + Math.max(0.01, opts.observedPatternMinTripFuelIntentBuffer - 0.01))
    );
    const smallCandidateObservedRoutineEligible = Boolean(
      predictedDefault &&
      scored.length > 0 &&
      scored.length <= opts.smallCandidateObservedRoutineMaxCandidateCount &&
      totalHistoryVisits >= opts.smallCandidateObservedRoutineMinHistoryVisits &&
      predictedDefault.alongTrack >= effectiveMinTriggerDistanceMeters &&
      predictedDefault.alongTrack <= opts.smallCandidateObservedRoutineMaxDistanceMeters &&
      (predictedDefault.effectiveDestinationProbability || 0) >= opts.smallCandidateObservedRoutineMinProbability &&
      tripFuelIntentScore >= (tripFuelIntentThreshold + opts.smallCandidateObservedRoutineMinTripFuelIntentBuffer) &&
      (predictedDefault.intentEvidence || 0) >= opts.smallCandidateObservedRoutineMinIntentEvidence &&
      (
        (predictedDefault.contextualObservedConversionRate || 0) >= opts.smallCandidateObservedRoutineMinContextualObservedConversionRate ||
        (predictedDefault.observedConversionRate || 0) >= opts.smallCandidateObservedRoutineMinObservedConversionRate
      ) &&
      (
        (predictedDefault.observedBehaviorStrength || 0) >= opts.smallCandidateObservedRoutineMinObservedBehaviorStrength ||
        (predictedDefault.routeHabitShare || 0) >= opts.routeHabitObservedRoutineMinShare
      ) &&
      (
        (predictedDefault.visitShare || 0) >= opts.smallCandidateObservedRoutineMinVisitShare ||
        (predictedDefault.routeHabitShare || 0) >= opts.routeHabitObservedRoutineMinShare
      ) &&
      (predictedDefault.observedSkipScore || 0) <= opts.smallCandidateObservedRoutineMaxObservedSkip &&
      (
        scored.length === 1 ||
        leadMargin >= opts.smallCandidateObservedRoutineMinLeadMargin
      ) &&
      fuelNeedScore >= opts.smallCandidateObservedRoutineMinFuelNeed &&
      !shouldSuppressDefaultForCheaperOption
    );
    const routeHabitObservedFallbackDriven = Boolean(
      predictedDefault &&
      (predictedDefault.routeHabitShare || 0) >= opts.routeHabitObservedRoutineMinShare &&
      (predictedDefault.visitShare || 0) < opts.strongObservedRoutineMinVisitShare &&
      (predictedDefault.contextualObservedConversionRate || 0) < opts.strongObservedRoutineMinContextualObservedConversionRate
    );
    const routeHabitObservedFallbackProbabilityFloor = (
      routeHabitObservedFallbackDriven &&
      predictedDefault?.alongTrack > opts.routeHabitFallbackLongDistanceMeters
    )
      ? opts.routeHabitFallbackLongDistanceMinProbability
      : opts.routeHabitFallbackMinProbability;
    const effectiveSmallCandidateObservedRoutineEligible = Boolean(
      smallCandidateObservedRoutineEligible &&
      (
        !routeHabitObservedFallbackDriven ||
        (predictedDefault.effectiveDestinationProbability || 0) >= routeHabitObservedFallbackProbabilityFloor
      ) &&
      (
        (predictedDefault.routeHabitShare || 0) > opts.weakObservedRoutineMaxRouteHabitShare ||
        (predictedDefault.observedBehaviorStrength || 0) > opts.weakObservedRoutineMaxObservedBehaviorStrength ||
        (predictedDefault.effectiveDestinationProbability || 0) >= opts.weakObservedRoutineMinProbability
      )
    );
    const smallCandidateObservedRoutineConfidence = smallCandidateObservedRoutineEligible
      ? clamp(
        (tripFuelIntentScore * 0.24) +
        ((predictedDefault.intentEvidence || 0) * 0.18) +
        ((predictedDefault.observedBehaviorStrength || 0) * 0.15) +
        ((predictedDefault.contextualObservedConversionRate || 0) * 0.12) +
        ((predictedDefault.observedConversionRate || 0) * 0.10) +
        ((predictedDefault.visitShare || 0) * 0.10) +
        ((predictedDefault.routeHabitShare || 0) * 0.08) +
        (clamp(1 - (predictedDefault.observedSkipScore || 0), 0, 1) * 0.07) +
        (clamp(leadMargin / Math.max(opts.smallCandidateObservedRoutineMinLeadMargin, 0.01), 0, 1) * 0.08) +
        (clamp(predictedDefault.alongTrack / effectiveProjectionDistance, 0, 1) * 0.02) +
        (fuelNeedScore * 0.04),
        0,
        1
      )
      : 0;
    const strongObservedRoutineEligible = Boolean(
      !isHighwayCruise &&
      predictedDefault &&
      scored.length === 1 &&
      totalHistoryVisits >= opts.strongObservedRoutineMinHistoryVisits &&
      predictedDefault.alongTrack >= effectiveMinTriggerDistanceMeters &&
      predictedDefault.alongTrack <= opts.strongObservedRoutineMaxDistanceMeters &&
      fuelNeedScore >= opts.strongObservedRoutineMinFuelNeed &&
      (tripFuelIntentScore - tripFuelIntentThreshold) >= opts.strongObservedRoutineMinTripFuelIntentSurplus &&
      (predictedDefault.intentEvidence || 0) >= opts.strongObservedRoutineMinIntentEvidence &&
      (predictedDefault.effectiveDestinationProbability || 0) >= opts.strongObservedRoutineMinProbability &&
      (
        (predictedDefault.contextualObservedConversionRate || 0) >= opts.strongObservedRoutineMinContextualObservedConversionRate ||
        (predictedDefault.observedConversionRate || 0) >= opts.strongObservedRoutineMinObservedConversionRate
      ) &&
      (
        (predictedDefault.visitShare || 0) >= opts.strongObservedRoutineMinVisitShare ||
        (predictedDefault.routeHabitShare || 0) >= opts.routeHabitObservedRoutineMinShare
      ) &&
      (predictedDefault.observedSkipScore || 0) <= opts.strongObservedRoutineMaxObservedSkip &&
      (
        timePatternStrength >= opts.strongObservedRoutineMinTimePatternStrength ||
        (predictedDefault.routeHabitShare || 0) >= opts.routeHabitObservedRoutineMinShare
      ) &&
      (
        !routeHabitObservedFallbackDriven ||
        (predictedDefault.effectiveDestinationProbability || 0) >= routeHabitObservedFallbackProbabilityFloor
      ) &&
      !shouldSuppressDefaultForCheaperOption
    );
    const strongObservedRoutineConfidence = strongObservedRoutineEligible
      ? clamp(
        (tripFuelIntentScore * 0.24) +
        ((predictedDefault.intentEvidence || 0) * 0.18) +
        ((predictedDefault.contextualObservedConversionRate || 0) * 0.18) +
        ((predictedDefault.observedConversionRate || 0) * 0.08) +
        ((predictedDefault.visitShare || 0) * 0.10) +
        ((predictedDefault.routeHabitShare || 0) * 0.08) +
        (clamp(1 - (predictedDefault.observedSkipScore || 0), 0, 1) * 0.10) +
        (Math.max(timePatternStrength, predictedDefault.routeHabitShare || 0) * 0.08) +
        (fuelNeedScore * 0.04),
        0,
        1
      )
      : 0;
    const supportedLowSpecificityCandidate = Boolean(
      lowSpecificityColdStart &&
      predictedDefault &&
      scored.length > 0 &&
      scored.length <= opts.supportedLowSpecificityMaxCandidateCount &&
      predictedDefault.alongTrack >= effectiveMinTriggerDistanceMeters &&
      predictedDefault.alongTrack <= (
        totalHistoryVisits === 0
          ? Math.min(opts.supportedLowSpecificityMaxDistanceMeters, 3500)
          : opts.supportedLowSpecificityMaxDistanceMeters
      ) &&
      fuelNeedScore >= opts.supportedLowSpecificityMinFuelNeed &&
      (tripFuelIntentScore - tripFuelIntentThreshold) >= (
        totalHistoryVisits === 0
          ? Math.max(opts.supportedLowSpecificityMinTripFuelIntentSurplus, 0.12)
          : opts.supportedLowSpecificityMinTripFuelIntentSurplus
      ) &&
      (predictedDefault.intentEvidence || 0) >= opts.supportedLowSpecificityMinIntentEvidence &&
      (predictedDefault.effectiveDestinationProbability || 0) >= (
        totalHistoryVisits === 0
          ? Math.max(opts.supportedLowSpecificityMinEffectiveProbability, 0.18)
          : opts.supportedLowSpecificityMinEffectiveProbability
      ) &&
      leadMargin >= (
        totalHistoryVisits === 0
          ? Math.max(opts.supportedLowSpecificityMinLeadMargin, 0.18)
          : opts.supportedLowSpecificityMinLeadMargin
      ) &&
      (predictedDefault.observedSkipScore || 0) <= opts.supportedLowSpecificityMaxObservedSkip &&
      predictedDefaultEstimatedSavings >= opts.supportedLowSpecificityMinVisibleSavings
    );
    const highFuelObservedLowSpecificityCandidate = Boolean(
      lowSpecificityColdStart &&
      predictedDefault &&
      scored.length > 0 &&
      scored.length <= opts.highFuelObservedLowSpecificityMaxCandidateCount &&
      totalHistoryVisits >= opts.highFuelObservedLowSpecificityMinHistoryVisits &&
      predictedDefault.alongTrack <= opts.highFuelObservedLowSpecificityMaxDistanceMeters &&
      fuelNeedScore >= opts.highFuelObservedLowSpecificityMinFuelNeed &&
      tripFuelIntentScore >= opts.highFuelObservedLowSpecificityMinTripFuelIntentScore &&
      (predictedDefault.intentEvidence || 0) >= opts.highFuelObservedLowSpecificityMinIntentEvidence &&
      (predictedDefault.effectiveDestinationProbability || 0) >= opts.highFuelObservedLowSpecificityMinEffectiveProbability &&
      (
        (predictedDefault.contextualObservedConversionRate || 0) >= opts.highFuelObservedLowSpecificityMinContextualObservedConversionRate ||
        (predictedDefault.observedConversionRate || 0) >= opts.highFuelObservedLowSpecificityMinObservedConversionRate
      ) &&
      (predictedDefault.visitShare || 0) >= opts.highFuelObservedLowSpecificityMinVisitShare &&
      (predictedDefault.observedSkipScore || 0) <= opts.highFuelObservedLowSpecificityMaxObservedSkip &&
      !shouldSuppressDefaultForCheaperOption
    );
    const relaxedValueDrivenMinTriggerDistance = Math.max(1200, effectiveMinTriggerDistanceMeters - 300);
    const relaxedObservedCorridorMinTriggerDistance = Math.max(1100, effectiveMinTriggerDistanceMeters - 400);
    const valueDrivenLowSpecificityCandidate = Boolean(
      lowSpecificityColdStart &&
      predictedDefault &&
      scored.length > 0 &&
      scored.length <= opts.valueDrivenLowSpecificityMaxCandidateCount &&
      predictedDefault.alongTrack >= relaxedValueDrivenMinTriggerDistance &&
      predictedDefault.alongTrack <= opts.valueDrivenLowSpecificityMaxDistanceMeters &&
      fuelNeedScore >= opts.valueDrivenLowSpecificityMinFuelNeed &&
      tripFuelIntentScore >= opts.valueDrivenLowSpecificityMinTripFuelIntentScore &&
      (predictedDefault.intentEvidence || 0) >= opts.valueDrivenLowSpecificityMinIntentEvidence &&
      (predictedDefault.effectiveDestinationProbability || 0) >= opts.valueDrivenLowSpecificityMinEffectiveProbability &&
      (predictedDefault.observedSkipScore || 0) <= opts.valueDrivenLowSpecificityMaxObservedSkip &&
      (
        predictedDefaultNetCostAdvantage >= opts.valueDrivenLowSpecificityMinNetCostAdvantage ||
        predictedDefaultVisibleSavings >= opts.valueDrivenLowSpecificityMinNetSavings
      ) &&
      (
        (predictedDefault.valueScore || 0) >= opts.valueDrivenLowSpecificityMinValueScore ||
        predictedDefaultVisibleSavings >= opts.minPriceSavingsPerGal
      ) &&
      !shouldSuppressDefaultForCheaperOption
    );
    const highFuelCorridorRecoveryCandidate = Boolean(
      predictedDefault &&
      totalHistoryVisits >= opts.highFuelCorridorRecoveryMinHistoryVisits &&
      scored.length > 0 &&
      scored.length <= opts.highFuelCorridorRecoveryMaxCandidateCount &&
      predictedDefault.alongTrack >= relaxedObservedCorridorMinTriggerDistance &&
      predictedDefault.alongTrack <= opts.highFuelCorridorRecoveryMaxDistanceMeters &&
      fuelNeedScore >= opts.highFuelCorridorRecoveryMinFuelNeed &&
      tripFuelIntentScore >= opts.highFuelCorridorRecoveryMinTripFuelIntentScore &&
      (predictedDefault.intentEvidence || 0) >= opts.highFuelCorridorRecoveryMinIntentEvidence &&
      (predictedDefault.effectiveDestinationProbability || 0) >= opts.highFuelCorridorRecoveryMinEffectiveProbability &&
      (predictedDefault.observedSkipScore || 0) <= opts.highFuelCorridorRecoveryMaxObservedSkip &&
      (
        (predictedDefault.contextualObservedConversionRate || 0) >= opts.highFuelCorridorRecoveryMinContextualObservedConversionRate ||
        (predictedDefault.observedConversionRate || 0) >= opts.highFuelCorridorRecoveryMinObservedConversionRate ||
        (predictedDefault.visitShare || 0) >= opts.highFuelCorridorRecoveryMinVisitShare ||
        (predictedDefault.routeHabitShare || 0) >= opts.highFuelCorridorRecoveryMinRouteHabitShare
      ) &&
      predictedDefaultEstimatedSavings >= opts.highFuelCorridorRecoveryMinVisibleSavings &&
      !shouldSuppressDefaultForCheaperOption
    );
  const observedCorridorCaptureCandidate = Boolean(
      predictedDefault &&
      totalHistoryVisits >= opts.observedCorridorCaptureMinHistoryVisits &&
      scored.length > 0 &&
      scored.length <= opts.observedCorridorCaptureMaxCandidateCount &&
      predictedDefault.alongTrack >= relaxedObservedCorridorMinTriggerDistance &&
      predictedDefault.alongTrack <= opts.observedCorridorCaptureMaxDistanceMeters &&
      tripFuelIntentScore >= opts.observedCorridorCaptureMinTripFuelIntentScore &&
      (predictedDefault.intentEvidence || 0) >= opts.observedCorridorCaptureMinIntentEvidence &&
      (predictedDefault.effectiveDestinationProbability || 0) >= opts.observedCorridorCaptureMinEffectiveProbability &&
      (
        (predictedDefault.contextualObservedConversionRate || 0) >= opts.observedCorridorCaptureMinContextualObservedConversionRate ||
        (predictedDefault.observedConversionRate || 0) >= opts.observedCorridorCaptureMinObservedConversionRate
      ) &&
      (predictedDefault.visitShare || 0) >= opts.observedCorridorCaptureMinVisitShare &&
      (predictedDefault.observedSkipScore || 0) <= opts.observedCorridorCaptureMaxObservedSkip &&
      predictedDefaultEstimatedSavings >= opts.observedCorridorCaptureMinVisibleSavings &&
      !shouldSuppressDefaultForCheaperOption
    );
  const lateObservedCorridorRecoveryCandidate = Boolean(
    opts.enableLateObservedCorridorRecovery &&
    predictedDefault &&
    totalHistoryVisits >= opts.lateObservedCorridorRecoveryMinHistoryVisits &&
    scored.length > 0 &&
    scored.length <= opts.lateObservedCorridorRecoveryMaxCandidateCount &&
    predictedDefault.alongTrack >= effectiveMinTriggerDistanceMeters &&
    predictedDefault.alongTrack <= opts.lateObservedCorridorRecoveryMaxDistanceMeters &&
    fuelNeedScore >= opts.lateObservedCorridorRecoveryMinFuelNeed &&
    (tripFuelIntentScore - tripFuelIntentThreshold) >= opts.lateObservedCorridorRecoveryMinTripFuelIntentSurplus &&
    (predictedDefault.intentEvidence || 0) >= opts.lateObservedCorridorRecoveryMinIntentEvidence &&
    (predictedDefault.effectiveDestinationProbability || 0) >= opts.lateObservedCorridorRecoveryMinEffectiveProbability &&
    (
      (predictedDefault.contextualObservedConversionRate || 0) >= opts.lateObservedCorridorRecoveryMinContextualObservedConversionRate ||
      (predictedDefault.observedConversionRate || 0) >= opts.lateObservedCorridorRecoveryMinObservedConversionRate
    ) &&
    (
      (predictedDefault.visitShare || 0) >= opts.lateObservedCorridorRecoveryMinVisitShare ||
      (predictedDefault.routeHabitShare || 0) >= opts.lateObservedCorridorRecoveryMinRouteHabitShare
    ) &&
    (predictedDefault.observedSkipScore || 0) <= opts.lateObservedCorridorRecoveryMaxObservedSkip &&
    predictedDefaultEstimatedSavings >= opts.lateObservedCorridorRecoveryMinVisibleSavings &&
    !shouldSuppressDefaultForCheaperOption
  );
  const routeHabitLowNeedRecoveryCandidate = Boolean(
      !lowSpecificityColdStart &&
      !isHighwayCruise &&
      predictedDefault &&
      scored.length >= opts.routeHabitLowNeedRecoveryMinCandidateCount &&
      scored.length <= opts.routeHabitLowNeedRecoveryMaxCandidateCount &&
      (predictedDefault.routeHabitShare || 0) >= opts.routeHabitLowNeedRecoveryMinRouteHabitShare &&
      (predictedDefault.visitShare || 0) >= opts.routeHabitLowNeedRecoveryMinVisitShare &&
      (predictedDefault.contextualObservedConversionRate || 0) >= opts.routeHabitLowNeedRecoveryMinContextualObservedConversionRate &&
      tripFuelIntentScore >= opts.routeHabitLowNeedRecoveryMinTripFuelIntentScore &&
      fuelNeedScore <= opts.routeHabitLowNeedRecoveryMaxFuelNeed &&
      (predictedDefault.effectiveDestinationProbability || 0) >= opts.routeHabitLowNeedRecoveryMinEffectiveProbability &&
      (predictedDefault.observedSkipScore || 0) <= opts.routeHabitLowNeedRecoveryMaxObservedSkip &&
      !shouldSuppressDefaultForCheaperOption
    );
  const stableLearnedCorridorCandidate = Boolean(
      !lowSpecificityColdStart &&
      !isHighwayCruise &&
      predictedDefault &&
      scored.length === 1 &&
      historyStrength >= 0.20 &&
      totalHistoryVisits >= opts.stableLearnedCorridorMinHistoryVisits &&
      predictedDefault.alongTrack >= Math.max(1200, effectiveMinTriggerDistanceMeters - 250) &&
      predictedDefault.alongTrack <= opts.stableLearnedCorridorMaxDistanceMeters &&
      fuelNeedScore >= opts.stableLearnedCorridorMinFuelNeed &&
      (tripFuelIntentScore - tripFuelIntentThreshold) >= opts.stableLearnedCorridorMinTripFuelIntentSurplus &&
      (predictedDefault.intentEvidence || 0) >= opts.stableLearnedCorridorMinIntentEvidence &&
      (predictedDefault.effectiveDestinationProbability || 0) >= opts.stableLearnedCorridorMinEffectiveProbability &&
      (predictedDefault.visitShare || 0) >= opts.stableLearnedCorridorMinVisitShare &&
      (predictedDefault.routeHabitShare || 0) >= opts.stableLearnedCorridorMinRouteHabitShare &&
      (predictedDefault.observedBehaviorStrength || 0) >= opts.stableLearnedCorridorMinObservedBehaviorStrength &&
      (
        (predictedDefault.contextualObservedConversionRate || 0) >= opts.stableLearnedCorridorMinContextualObservedConversionRate ||
        (predictedDefault.observedConversionRate || 0) >= opts.stableLearnedCorridorMinObservedConversionRate
      ) &&
      (predictedDefault.observedSkipScore || 0) <= opts.stableLearnedCorridorMaxObservedSkip &&
      !shouldSuppressDefaultForCheaperOption
    );
    const minimumProbability = strongObservedRoutineEligible
      ? opts.strongObservedRoutineMinProbability
      : effectiveSmallCandidateObservedRoutineEligible
      ? opts.smallCandidateObservedRoutineMinProbability
      : stableLearnedCorridorCandidate
      ? opts.stableLearnedCorridorMinEffectiveProbability
      : routeHabitLowNeedRecoveryCandidate
      ? opts.routeHabitLowNeedRecoveryMinEffectiveProbability
      : skipDominatedColdStartDefaultOverride
      ? opts.skipDominatedColdStartSupportedMinProbability
      : highFuelObservedLowSpecificityCandidate
      ? opts.highFuelObservedLowSpecificityMinEffectiveProbability
      : valueDrivenLowSpecificityCandidate
      ? opts.valueDrivenLowSpecificityMinEffectiveProbability
      : highFuelCorridorRecoveryCandidate
      ? opts.highFuelCorridorRecoveryMinEffectiveProbability
      : observedCorridorCaptureCandidate
      ? opts.observedCorridorCaptureMinEffectiveProbability
      : lateObservedCorridorRecoveryCandidate
      ? opts.lateObservedCorridorRecoveryMinEffectiveProbability
      : supportedLowSpecificityCandidate
      ? opts.supportedLowSpecificityMinEffectiveProbability
      : strongObservedPatternCandidate
      ? 0.26
      : historyStrength >= 0.20
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
    const effectivePredictedStopConfidence = strongObservedRoutineEligible
      ? Math.max(confidence, strongObservedRoutineConfidence)
      : effectiveSmallCandidateObservedRoutineEligible
      ? Math.max(confidence, smallCandidateObservedRoutineConfidence)
      : confidence;
    if (lowSpecificityColdStart) {
      const coldStartBrandValueSignal = (
        predictedBrandAffinity >= 0.45 &&
        (predictedDefault.valueScore || 0) >= opts.lowSpecificityColdStartBrandValueFloor
      );
      const mediumFuelNeed = fuelNeedScore >= opts.fuelNeedMediumThreshold;
      const lowSpecificityBlocked = (
        ((!coldStartBrandValueSignal && !mediumFuelNeed) && !singleCandidateRoutineFallbackAllowed) ||
        predictedDefault.alongTrack > opts.lowSpecificityColdStartMaxDistanceMeters ||
        tripFuelIntentScore < (tripFuelIntentThreshold + opts.lowSpecificityColdStartIntentBuffer - (mediumFuelNeed ? opts.lowSpecificityFuelNeedBuffer : 0)) ||
        Math.max(predictedDefault.intentEvidence, fuelNeedScore) < (mediumFuelNeed ? opts.lowSpecificityColdStartMinIntentEvidence - 0.06 : opts.lowSpecificityColdStartMinIntentEvidence) ||
        (
          effectivePredictedStopConfidence < Math.max(
            strongObservedRoutineEligible
              ? opts.strongObservedRoutineMinConfidence
              : effectiveSmallCandidateObservedRoutineEligible
              ? opts.smallCandidateObservedRoutineMinConfidence
              : supportedLowSpecificityCandidate
              ? opts.supportedLowSpecificityMinConfidence
              : strongObservedPatternCandidate
              ? Math.max(opts.observedPatternMinConfidence, opts.triggerThreshold - 0.04)
              : opts.triggerThreshold,
            opts.lowSpecificityColdStartMinConfidence
          ) &&
          !singleCandidateRoutineFallbackAllowed
        )
      );
      if (
        lowSpecificityBlocked &&
        !strongObservedPatternCandidate &&
        !strongObservedRoutineEligible &&
        !effectiveSmallCandidateObservedRoutineEligible &&
        !highFuelObservedLowSpecificityCandidate &&
        !valueDrivenLowSpecificityCandidate &&
        !lateObservedCorridorRecoveryCandidate &&
        !supportedLowSpecificityCandidate
      ) {
        return suppressRecommendation('predicted_stop_low_specificity_blocked', predictedDefault, {
          strongObservedPatternCandidate,
          strongObservedRoutineEligible,
          smallCandidateObservedRoutineEligible: effectiveSmallCandidateObservedRoutineEligible,
          highFuelObservedLowSpecificityCandidate,
          valueDrivenLowSpecificityCandidate,
          lateObservedCorridorRecoveryCandidate,
          supportedLowSpecificityCandidate,
        });
      }
    }
    const confidenceFloor = strongObservedRoutineEligible
      ? opts.strongObservedRoutineMinConfidence
      : effectiveSmallCandidateObservedRoutineEligible
      ? opts.smallCandidateObservedRoutineMinConfidence
      : stableLearnedCorridorCandidate
      ? opts.stableLearnedCorridorMinConfidence
      : routeHabitLowNeedRecoveryCandidate
      ? opts.routeHabitLowNeedRecoveryMinConfidence
      : skipDominatedColdStartDefaultOverride
      ? opts.skipDominatedColdStartSupportedMinConfidence
      : highFuelObservedLowSpecificityCandidate
      ? opts.highFuelObservedLowSpecificityMinConfidence
      : valueDrivenLowSpecificityCandidate
      ? opts.valueDrivenLowSpecificityMinConfidence
      : highFuelCorridorRecoveryCandidate
      ? opts.highFuelCorridorRecoveryMinConfidence
      : observedCorridorCaptureCandidate
      ? opts.observedCorridorCaptureMinConfidence
      : lateObservedCorridorRecoveryCandidate
      ? opts.lateObservedCorridorRecoveryMinConfidence
      : supportedLowSpecificityCandidate
      ? opts.supportedLowSpecificityMinConfidence
      : strongObservedPatternCandidate
      ? Math.max(opts.observedPatternMinConfidence, opts.triggerThreshold - 0.04)
      : opts.triggerThreshold;
    const learnedPredictedStop = Boolean(
      historyStrength >= 0.20 ||
      strongObservedPatternCandidate ||
      strongObservedRoutineEligible ||
      effectiveSmallCandidateObservedRoutineEligible ||
      routeHabitLowNeedRecoveryCandidate ||
      highFuelObservedLowSpecificityCandidate ||
      valueDrivenLowSpecificityCandidate ||
      highFuelCorridorRecoveryCandidate ||
      observedCorridorCaptureCandidate ||
      lateObservedCorridorRecoveryCandidate ||
      (predictedDefault.routeHabitShare || 0) >= opts.routeHabitObservedRoutineMinShare
    );
    const valueDrivenRoadtripColdStartGuard = Boolean(
      opts.enableValueDrivenRoadtripColdStartGuard &&
      valueDrivenLowSpecificityCandidate &&
      totalHistoryVisits >= opts.valueDrivenRoadtripColdStartGuardMinHistoryVisits &&
      scored.length > 0 &&
      scored.length <= opts.valueDrivenRoadtripColdStartMaxCandidateCount &&
      tripDemandPressure >= opts.valueDrivenRoadtripColdStartMinTripDemandPressure &&
      (predictedDefault.alongTrack || 0) >= opts.valueDrivenRoadtripColdStartMinAlongTrack &&
      Math.max(
        predictedDefault.visitShare || 0,
        predictedDefault.routeHabitShare || 0,
        predictedDefault.routeObservedSupport || 0,
        predictedDefault.observedBehaviorStrength || 0,
        predictedDefault.contextualObservedConversionRate || 0,
        predictedDefault.observedConversionRate || 0
      ) <= opts.valueDrivenRoadtripColdStartMaxLearnedSupport &&
      (predictedDefault.observedSkipScore || 0) >= opts.valueDrivenRoadtripColdStartMinObservedSkip
    );
    if (valueDrivenRoadtripColdStartGuard) {
      return suppressRecommendation('predicted_stop_value_driven_roadtrip_guard', predictedDefault);
    }
    if (predictedDefault.effectiveDestinationProbability >= minimumProbability && effectivePredictedStopConfidence >= confidenceFloor) {
      return finalizeRecommendation({
        stationId: predictedDefault.station.stationId,
        type: learnedPredictedStop ? 'predicted_stop' : 'cold_start_best_value',
        confidence: effectivePredictedStopConfidence,
        reason: strongObservedRoutineEligible
          ? `Observed strong routine stop ahead (${Math.round(effectivePredictedStopConfidence * 100)}% confidence)`
          : effectiveSmallCandidateObservedRoutineEligible
          ? `Observed routine stop ahead (${Math.round(effectivePredictedStopConfidence * 100)}% confidence)`
          : stableLearnedCorridorCandidate
          ? `Predicted stop (stable corridor match)`
          : routeHabitLowNeedRecoveryCandidate
          ? `Predicted stop (${Math.round(predictedDefault.effectiveDestinationProbability * 100)}% match)`
          : highFuelObservedLowSpecificityCandidate
          ? `Predicted stop (${Math.round(predictedDefault.effectiveDestinationProbability * 100)}% match)`
          : highFuelCorridorRecoveryCandidate
          ? `Predicted stop (high-fuel corridor recovery)`
          : observedCorridorCaptureCandidate
          ? `Predicted stop (observed corridor capture)`
          : lateObservedCorridorRecoveryCandidate
          ? `Predicted stop (late observed corridor recovery)`
          : valueDrivenLowSpecificityCandidate
          ? `High-value stop ahead (${Math.round(effectivePredictedStopConfidence * 100)}% confidence, ${Math.round(predictedDefault.alongTrack)}m out)`
          : supportedLowSpecificityCandidate
          ? `Viable stop ahead (${Math.round(effectivePredictedStopConfidence * 100)}% confidence, ${Math.round(predictedDefault.alongTrack)}m out)`
          : historyStrength >= 0.20
          ? `Predicted stop (${Math.round(predictedDefault.effectiveDestinationProbability * 100)}% match)`
          : `Best stop ahead (${Math.round(predictedDefault.effectiveDestinationProbability * 100)}% fit, ${Math.round(predictedDefault.alongTrack)}m out)`,
        forwardDistance: predictedDefault.alongTrack,
        predictedDefault: predictedDefault.station.stationId,
        savings: computeCandidateEstimatedSavings(predictedDefault),
      }, predictedDefault);
    }
    if (!allowUrgentHighwayFallback) {
      return suppressRecommendation('predicted_stop_below_probability_or_confidence', predictedDefault, {
        minimumProbability,
        confidenceFloor,
        effectivePredictedStopConfidence,
        effectiveDestinationProbability: predictedDefault.effectiveDestinationProbability,
        strongObservedPatternCandidate,
        strongObservedRoutineEligible,
        smallCandidateObservedRoutineEligible: effectiveSmallCandidateObservedRoutineEligible,
        stableLearnedCorridorCandidate,
        routeHabitLowNeedRecoveryCandidate,
        highFuelObservedLowSpecificityCandidate,
        valueDrivenLowSpecificityCandidate,
        highFuelCorridorRecoveryCandidate,
        observedCorridorCaptureCandidate,
        lateObservedCorridorRecoveryCandidate,
        supportedLowSpecificityCandidate,
      });
    }
    if (typeof opts.onRecommendationSuppressed === 'function') {
      opts.onRecommendationSuppressed({
        reason: 'predicted_stop_highway_fallback_to_urgent',
        candidateStationId: predictedDefault?.station?.stationId || null,
        predictedDefaultStationId: predictedDefault?.station?.stationId || null,
        decisionSnapshot: baseDecisionSnapshot,
        minimumProbability,
        confidenceFloor,
        effectivePredictedStopConfidence,
        effectiveDestinationProbability: predictedDefault.effectiveDestinationProbability,
      });
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
      savings: computeCandidateEstimatedSavings(predictedDefault),
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
      const historyObservedNegative = (
        totalHistoryVisits > 0 &&
        (bestColdStart.observedSkipScore || 0) >= 0.22 &&
        (bestColdStart.contextualObservedConversionRate || 0) <= 0.22
      );
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
      if (
        historyStrength < 0.20 &&
        !isHighwayCruise &&
        fuelNeedScore < 0.80 &&
        tripDemandPressure < 0.14
      ) {
        return null;
      }
      if (historyObservedNegative) {
        if (
          fuelNeedScore < 0.88 ||
          tripFuelIntentScore < (tripFuelIntentThreshold + 0.16) ||
          coldStartNetAdvantage < Math.max(0.14, opts.minPriceSavingsPerGal + 0.04) ||
          coldStartConfidence < (opts.triggerThreshold + 0.08)
        ) {
          return null;
        }
      }
      if (bestColdStartLowSpecificity) {
        const coldStartBrandValueSignal = (
          (bestColdStart.brandAffinity || 0) >= 0.45 &&
          (bestColdStart.valueScore || 0) >= opts.lowSpecificityColdStartBrandValueFloor
        );
        const mediumFuelNeed = fuelNeedScore >= opts.fuelNeedMediumThreshold;
        if (
          (!coldStartBrandValueSignal && !mediumFuelNeed) ||
          bestColdStart.alongTrack > opts.lowSpecificityColdStartMaxDistanceMeters ||
          tripDemandPressure < 0.18 ||
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
          savings: computeCandidateEstimatedSavings(bestColdStart),
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
        savings: computeCandidateEstimatedSavings(onlyCandidate),
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
          savings: computeCandidateEstimatedSavings(turnInLeader),
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
  let tripDistanceMeters = 0;
  const cooldowns = new Map(); // stationId -> expiry ms
  const firedEvents = []; // history of all recommendations this session
  let pendingRecommendation = null;
  let recommendationCandidate = null;
  let latestDecisionSnapshot = null;
  let latestSuppression = null;
  const learnedCommitmentStates = new Map();
  let noOfferCommitment = 0;
  let learnedSuppressionAccumulator = null;
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

  function getLearnedCommitmentState(stationId) {
    if (!stationId) return null;
    return learnedCommitmentStates.get(String(stationId)) || null;
  }

  function decayLearnedCommitmentStates(nowMs, visibleStationIds = new Set()) {
    for (const [stationId, state] of learnedCommitmentStates.entries()) {
      const visible = visibleStationIds.has(String(stationId));
      const decayedScore = (Number(state?.score) || 0) * (visible ? 1 : opts.learnedCommitmentAccumulatorDecay);
      const updatedState = {
        ...state,
        score: decayedScore,
        persistenceSamples: visible ? (Number(state?.persistenceSamples) || 0) : 0,
        notVisibleSamples: visible ? 0 : ((Number(state?.notVisibleSamples) || 0) + 1),
        lastUpdatedAt: nowMs,
      };
      if (updatedState.score < 0.05 && (updatedState.notVisibleSamples || 0) >= 6) {
        learnedCommitmentStates.delete(stationId);
      } else {
        learnedCommitmentStates.set(stationId, updatedState);
      }
    }
    noOfferCommitment *= opts.learnedCommitmentAccumulatorNoOfferDecay;
  }

  function cloneDecisionSnapshotWithSelectedCandidate(snapshot, selectedStationId, recommendation) {
    if (!snapshot) return null;
    return {
      ...snapshot,
      recommendation: recommendation
        ? {
          stationId: recommendation.stationId,
          type: recommendation.type,
          confidence: recommendation.confidence,
          forwardDistance: recommendation.forwardDistance,
        }
        : null,
      candidates: Array.isArray(snapshot.candidates)
        ? snapshot.candidates.map(candidate => ({
          ...candidate,
          selected: candidate?.stationId === selectedStationId,
        }))
        : [],
    };
  }

  function computeLearnedCommitmentSupport(snapshot, candidate, state) {
    if (!snapshot || !candidate) {
      return { support: 0, noOfferPressure: 0, margin: 0 };
    }
    const tripFuelIntentSurplus = Math.max(
      0,
      (Number(snapshot.tripFuelIntentScore) || 0) - (Number(snapshot.tripFuelIntentThreshold) || 0)
    );
    const leadMargin = Math.max(
      0,
      (Number(candidate.destinationMarginToLeader) || 0) * -1
    );
    const closingAlongTrack = (
      Number.isFinite(Number(state?.lastAlongTrack)) &&
      Number.isFinite(Number(candidate.alongTrack)) &&
      Number(candidate.alongTrack) < Number(state.lastAlongTrack)
    ) ? 1 : 0;
    const support = clamp(
      (tripFuelIntentSurplus * 0.26) +
      ((Number(snapshot.tripFuelIntentScore) || 0) * 0.14) +
      ((Number(snapshot.fuelNeedScore) || 0) * 0.10) +
      ((Number(candidate.intentEvidence) || 0) * 0.18) +
      ((Number(candidate.effectiveDestinationProbability) || 0) * 0.10) +
      ((Number(candidate.contextualObservedConversionRate) || 0) * 0.10) +
      ((Number(candidate.observedConversionRate) || 0) * 0.06) +
      ((Number(candidate.visitShare) || 0) * 0.08) +
      ((Number(candidate.routeHabitShare) || 0) * 0.10) +
      ((Number(candidate.predictedDefaultAligned) ? 0.08 : 0)) +
      ((Number(candidate.destinationRank) === 1 ? 0.04 : 0)) +
      (leadMargin * 0.04) +
      (closingAlongTrack * 0.04) -
      ((Number(candidate.observedSkipScore) || 0) * 0.10),
      0,
      1.1,
    );
    const strongestHistorySignal = Math.max(
      Number(candidate.visitShare) || 0,
      Number(candidate.routeHabitShare) || 0,
      Number(candidate.contextualObservedConversionRate) || 0,
      Number(candidate.observedConversionRate) || 0,
    );
    const noOfferPressure = clamp(
      opts.learnedCommitmentAccumulatorNoOfferBase +
      (clamp((0.28 - (Number(snapshot.fuelNeedScore) || 0)) / 0.28, 0, 1) * opts.learnedCommitmentAccumulatorNoOfferLowNeedWeight) +
      (clamp((0.10 - Math.max(0, leadMargin)) / 0.10, 0, 1) * opts.learnedCommitmentAccumulatorNoOfferAmbiguityWeight) +
      (clamp((0.18 - strongestHistorySignal) / 0.18, 0, 1) * opts.learnedCommitmentAccumulatorNoOfferWeakHistoryWeight),
      0,
      1,
    );
    const nextScore = clamp(
      ((Number(state?.score) || 0) * opts.learnedCommitmentAccumulatorDecay) +
      (support * 0.22),
      0,
      1.6
    );
    const nextNoOfferCommitment = clamp(
      (noOfferCommitment * opts.learnedCommitmentAccumulatorNoOfferDecay) +
      (noOfferPressure * 0.22),
      0,
      1.6
    );
    return {
      support,
      noOfferPressure,
      nextScore,
      nextNoOfferCommitment,
      margin: nextScore - nextNoOfferCommitment,
    };
  }

  function updateLearnedCommitmentAccumulator(snapshot, nowMs) {
    if (!opts.enableLearnedCommitmentAccumulator || !snapshot || getTotalHistoryVisits() < opts.learnedCommitmentAccumulatorMinHistoryVisits) {
      decayLearnedCommitmentStates(nowMs);
      return;
    }
    const candidateCount = Number(snapshot?.candidateCount) || 0;
    const visibleCandidates = Array.isArray(snapshot?.candidates) ? snapshot.candidates : [];
    const visibleStationIds = new Set(visibleCandidates.map(candidate => String(candidate?.stationId || '')));
    decayLearnedCommitmentStates(nowMs, visibleStationIds);
    if (candidateCount <= 0 || candidateCount > opts.learnedCommitmentAccumulatorMaxCandidateCount) {
      return;
    }
    for (const candidate of visibleCandidates) {
      const stationId = String(candidate?.stationId || '');
      if (!stationId) continue;
      const meaningfulLearnedSupport = (
        (Number(candidate.visitShare) || 0) >= opts.learnedCommitmentAccumulatorMinVisitShare ||
        (Number(candidate.routeHabitShare) || 0) >= opts.learnedCommitmentAccumulatorMinRouteHabitShare ||
        (Number(candidate.contextualObservedConversionRate) || 0) >= opts.learnedCommitmentAccumulatorMinContextualObservedConversionRate ||
        (Number(candidate.observedConversionRate) || 0) >= opts.learnedCommitmentAccumulatorMinObservedConversionRate
      );
      if (!meaningfulLearnedSupport) continue;
      const priorState = getLearnedCommitmentState(stationId) || {
        score: 0,
        visibleSamples: 0,
        persistenceSamples: 0,
        notVisibleSamples: 0,
        lastAlongTrack: null,
      };
      const metrics = computeLearnedCommitmentSupport(snapshot, candidate, priorState);
      const persistentLeader = Boolean(
        candidate?.selected ||
        candidate?.predictedDefaultAligned ||
        Number(candidate?.destinationRank) === 1
      );
      learnedCommitmentStates.set(stationId, {
        score: metrics.nextScore,
        visibleSamples: (Number(priorState.visibleSamples) || 0) + 1,
        persistenceSamples: persistentLeader
          ? ((Number(priorState.persistenceSamples) || 0) + 1)
          : 0,
        lastSeenAt: nowMs,
        lastUpdatedAt: nowMs,
        lastAlongTrack: Number(candidate?.alongTrack) || null,
        lastCandidateCount: candidateCount,
        lastMargin: metrics.margin,
        lastSupport: metrics.support,
        lastTripFuelIntentSurplus: Math.max(
          0,
          (Number(snapshot.tripFuelIntentScore) || 0) - (Number(snapshot.tripFuelIntentThreshold) || 0)
        ),
        lastFuelNeedScore: Number(snapshot.fuelNeedScore) || 0,
        lastIntentEvidence: Number(candidate.intentEvidence) || 0,
        lastEffectiveProbability: Number(candidate.effectiveDestinationProbability) || 0,
        lastVisitShare: Number(candidate.visitShare) || 0,
        lastRouteHabitShare: Number(candidate.routeHabitShare) || 0,
        lastContextualObservedConversionRate: Number(candidate.contextualObservedConversionRate) || 0,
        lastObservedConversionRate: Number(candidate.observedConversionRate) || 0,
        lastObservedSkipScore: Number(candidate.observedSkipScore) || 0,
      });
      noOfferCommitment = metrics.nextNoOfferCommitment;
    }
  }

  function getLearnedCommitmentBoost(snapshot, recommendation) {
    if (
      !opts.enableLearnedCommitmentAccumulator ||
      !snapshot ||
      !recommendation ||
      recommendation.type !== 'predicted_stop'
    ) {
      return null;
    }
    const candidate = findMatchingDecisionCandidate(snapshot, recommendation);
    const state = getLearnedCommitmentState(recommendation.stationId);
    if (!candidate || !state) {
      return null;
    }
    return {
      score: Number(state.score) || 0,
      margin: Number(state.lastMargin) || 0,
      visibleSamples: Number(state.visibleSamples) || 0,
      persistenceSamples: Number(state.persistenceSamples) || 0,
      candidate,
    };
  }

  function buildAccumulatedLearnedRecommendation(snapshot) {
    if (
      !opts.enableLearnedCommitmentAccumulator ||
      !latestSuppression ||
      !snapshot ||
      getTotalHistoryVisits() < opts.learnedCommitmentAccumulatorMinHistoryVisits
    ) {
      return null;
    }
    if (
      latestSuppression.reason !== 'predicted_stop_below_probability_or_confidence' &&
      latestSuppression.reason !== 'predicted_stop_low_specificity_blocked'
    ) {
      return null;
    }
    const candidateCount = Number(snapshot?.candidateCount) || 0;
    if (candidateCount <= 0 || candidateCount > opts.learnedCommitmentAccumulatorMaxCandidateCount) {
      return null;
    }
    const candidateStationId = String(
      latestSuppression.candidateStationId ||
      latestSuppression.predictedDefaultStationId ||
      snapshot.predictedDefaultStationId ||
      ''
    );
    if (!candidateStationId) {
      return null;
    }
    const candidate = Array.isArray(snapshot.candidates)
      ? snapshot.candidates.find(entry => String(entry?.stationId || '') === candidateStationId)
      : null;
    const state = getLearnedCommitmentState(candidateStationId);
    const tripFuelIntentSurplus = Math.max(
      0,
      (Number(snapshot.tripFuelIntentScore) || 0) - (Number(snapshot.tripFuelIntentThreshold) || 0)
    );
    if (!candidate || !state) {
      return null;
    }
    if (
      (Number(state.visibleSamples) || 0) < opts.learnedCommitmentAccumulatorMinVisibleSamples ||
      (Number(state.persistenceSamples) || 0) < opts.learnedCommitmentAccumulatorMinPersistenceSamples ||
      (Number(state.score) || 0) < opts.learnedCommitmentAccumulatorMinScore ||
      (Number(state.lastMargin) || 0) < opts.learnedCommitmentAccumulatorMinMargin ||
      (Number(candidate.alongTrack) || 0) < opts.minTriggerDistanceMeters ||
      (Number(candidate.alongTrack) || 0) > opts.learnedCommitmentAccumulatorMaxDistanceMeters ||
      (Number(snapshot.fuelNeedScore) || 0) < opts.learnedCommitmentAccumulatorMinFuelNeed ||
      tripFuelIntentSurplus < opts.learnedCommitmentAccumulatorMinTripFuelIntentSurplus ||
      (Number(candidate.intentEvidence) || 0) < opts.learnedCommitmentAccumulatorMinIntentEvidence ||
      (Number(candidate.effectiveDestinationProbability) || 0) < opts.learnedCommitmentAccumulatorMinEffectiveProbability ||
      (Number(candidate.observedSkipScore) || 0) > opts.learnedCommitmentAccumulatorMaxObservedSkip
    ) {
      return null;
    }
    const recommendation = {
      stationId: candidate.stationId,
      type: 'predicted_stop',
      confidence: clamp(
        0.42 +
        ((Number(state.score) || 0) * 0.16) +
        ((Number(state.lastMargin) || 0) * 0.30),
        0,
        0.82
      ),
      reason: `Predicted stop (accumulated corridor support ${Math.round(clamp(Number(state.score) || 0, 0, 1.5) * 100 / 1.5)}%)`,
      forwardDistance: Number(candidate.alongTrack) || 0,
      fuelNeedScore: Number(snapshot.fuelNeedScore) || 0,
      decisionSnapshot: null,
      mlFeatures: {
        tripFuelIntentScore: Number(snapshot.tripFuelIntentScore) || 0,
        tripFuelIntentThreshold: Number(snapshot.tripFuelIntentThreshold) || 0,
        timePatternStrength: Number(snapshot.timePatternStrength) || 0,
        fuelNeedScore: Number(snapshot.fuelNeedScore) || 0,
        historyStrength: Number(snapshot.historyStrength) || 0,
        candidateEffectiveDestinationProbability: Number(candidate.effectiveDestinationProbability) || 0,
        candidateIntentEvidence: Number(candidate.intentEvidence) || 0,
        candidateVisitShare: Number(candidate.visitShare) || 0,
        candidateRouteHabitShare: Number(candidate.routeHabitShare) || 0,
        candidateContextualObservedConversionRate: Number(candidate.contextualObservedConversionRate) || 0,
        candidateObservedConversionRate: Number(candidate.observedConversionRate) || 0,
        candidateObservedSkipScore: Number(candidate.observedSkipScore) || 0,
        commitmentScore: Number(state.score) || 0,
        commitmentMargin: Number(state.lastMargin) || 0,
        commitmentVisibleSamples: Number(state.visibleSamples) || 0,
        commitmentPersistenceSamples: Number(state.persistenceSamples) || 0,
      },
    };
    recommendation.decisionSnapshot = cloneDecisionSnapshotWithSelectedCandidate(
      snapshot,
      candidate.stationId,
      recommendation,
    );
    recommendation.presentation = buildPresentationPlan(window, recommendation, candidate, opts);
    recommendation.commitmentAccumulator = {
      score: Number(state.score) || 0,
      margin: Number(state.lastMargin) || 0,
      visibleSamples: Number(state.visibleSamples) || 0,
      persistenceSamples: Number(state.persistenceSamples) || 0,
      synthesized: true,
      suppressionReason: latestSuppression.reason,
    };
    return recommendation;
  }

  function resetLearnedSuppressionAccumulator() {
    learnedSuppressionAccumulator = null;
  }

  function updateLearnedSuppressionAccumulator(suppression) {
    if (
      !opts.enableLearnedSuppressionAccumulatorRecovery ||
      !suppression ||
      getTotalHistoryVisits() < opts.learnedSuppressionAccumulatorMinHistoryVisits
    ) {
      resetLearnedSuppressionAccumulator();
      return;
    }
    if (suppression.reason !== 'predicted_stop_below_probability_or_confidence') {
      resetLearnedSuppressionAccumulator();
      return;
    }
    const snapshot = suppression.decisionSnapshot;
    const stationId = String(
      suppression.candidateStationId ||
      suppression.predictedDefaultStationId ||
      snapshot?.predictedDefaultStationId ||
      ''
    );
    const candidate = Array.isArray(snapshot?.candidates)
      ? snapshot.candidates.find(entry => String(entry?.stationId || '') === stationId)
      : null;
    const candidateCount = Number(snapshot?.candidateCount) || 0;
    const tripFuelIntentSurplus = Math.max(
      0,
      (Number(snapshot?.tripFuelIntentScore) || 0) - (Number(snapshot?.tripFuelIntentThreshold) || 0)
    );
    const eligible = Boolean(
      stationId &&
      candidate &&
      candidateCount === opts.learnedSuppressionAccumulatorMaxCandidateCount &&
      (Number(candidate.alongTrack) || 0) <= opts.learnedSuppressionAccumulatorMaxDistanceMeters &&
      (Number(snapshot?.fuelNeedScore) || 0) >= opts.learnedSuppressionAccumulatorMinFuelNeed &&
      tripFuelIntentSurplus >= opts.learnedSuppressionAccumulatorMinTripFuelIntentSurplus &&
      (Number(candidate.intentEvidence) || 0) >= opts.learnedSuppressionAccumulatorMinIntentEvidence &&
      (Number(candidate.visitShare) || 0) >= opts.learnedSuppressionAccumulatorMinVisitShare &&
      (Number(candidate.routeHabitShare) || 0) >= opts.learnedSuppressionAccumulatorMinRouteHabitShare &&
      (
        (Number(candidate.contextualObservedConversionRate) || 0) >= opts.learnedSuppressionAccumulatorMinContextualObservedConversionRate ||
        (Number(candidate.observedConversionRate) || 0) >= opts.learnedSuppressionAccumulatorMinObservedConversionRate
      )
    );
    if (!eligible) {
      resetLearnedSuppressionAccumulator();
      return;
    }
    const routeSampleIndex = Number.isInteger(suppression?.routeSampleIndex)
      ? suppression.routeSampleIndex
      : null;
    const consecutive = Boolean(
      learnedSuppressionAccumulator &&
      learnedSuppressionAccumulator.stationId === stationId &&
      routeSampleIndex != null &&
      learnedSuppressionAccumulator.lastRouteSampleIndex != null &&
      routeSampleIndex <= (learnedSuppressionAccumulator.lastRouteSampleIndex + opts.learnedSuppressionAccumulatorGapToleranceSamples)
    );
    const priorAccumulator = consecutive ? learnedSuppressionAccumulator : null;
    const priorProbability = Number(priorAccumulator?.lastEffectiveProbability);
    const priorIntentEvidence = Number(priorAccumulator?.lastIntentEvidence);
    const priorTripFuelIntent = Number(priorAccumulator?.lastTripFuelIntentScore);
    const currentProbability = Number(candidate.effectiveDestinationProbability) || 0;
    const currentIntentEvidence = Number(candidate.intentEvidence) || 0;
    const currentTripFuelIntent = Number(snapshot?.tripFuelIntentScore) || 0;
    const observedSamples = priorAccumulator ? (Number(priorAccumulator.observedSamples) || 0) + 1 : 1;
    const sumAbsProbabilityDelta = (Number(priorAccumulator?.sumAbsProbabilityDelta) || 0) +
      (priorAccumulator && Number.isFinite(priorProbability)
        ? Math.abs(currentProbability - priorProbability)
        : 0);
    const sumAbsIntentDelta = (Number(priorAccumulator?.sumAbsIntentDelta) || 0) +
      (priorAccumulator && Number.isFinite(priorIntentEvidence)
        ? Math.abs(currentIntentEvidence - priorIntentEvidence)
        : 0);
    const sumAbsTripFuelIntentDelta = (Number(priorAccumulator?.sumAbsTripFuelIntentDelta) || 0) +
      (priorAccumulator && Number.isFinite(priorTripFuelIntent)
        ? Math.abs(currentTripFuelIntent - priorTripFuelIntent)
        : 0);
    const minEffectiveProbability = priorAccumulator
      ? Math.min(Number(priorAccumulator.minEffectiveProbability) || currentProbability, currentProbability)
      : currentProbability;
    const maxEffectiveProbability = priorAccumulator
      ? Math.max(Number(priorAccumulator.maxEffectiveProbability) || currentProbability, currentProbability)
      : currentProbability;
    learnedSuppressionAccumulator = {
      stationId,
      streak: priorAccumulator ? (priorAccumulator.streak + 1) : 1,
      observedSamples,
      lastRouteSampleIndex: routeSampleIndex,
      candidate,
      snapshot,
      suppressionReason: suppression.reason,
      lastEffectiveProbability: currentProbability,
      lastIntentEvidence: currentIntentEvidence,
      lastTripFuelIntentScore: currentTripFuelIntent,
      sumAbsProbabilityDelta,
      sumAbsIntentDelta,
      sumAbsTripFuelIntentDelta,
      minEffectiveProbability,
      maxEffectiveProbability,
    };
  }

  function buildSuppressionAccumulatedRecommendation() {
    if (
      !opts.enableLearnedSuppressionAccumulatorRecovery ||
      !latestSuppression ||
      !learnedSuppressionAccumulator ||
      learnedSuppressionAccumulator.streak < opts.learnedSuppressionAccumulatorMinStreak
    ) {
      return null;
    }
    const stationId = String(
      latestSuppression.candidateStationId ||
      latestSuppression.predictedDefaultStationId ||
      ''
    );
    if (!stationId || learnedSuppressionAccumulator.stationId !== stationId) {
      return null;
    }
    const candidate = learnedSuppressionAccumulator.candidate;
    const snapshot = learnedSuppressionAccumulator.snapshot;
    if (!candidate || !snapshot) {
      return null;
    }
    const tripFuelIntentSurplus = Math.max(
      0,
      (Number(snapshot.tripFuelIntentScore) || 0) - (Number(snapshot.tripFuelIntentThreshold) || 0)
    );
    const observedSamples = Math.max(1, Number(learnedSuppressionAccumulator.observedSamples) || 1);
    const averageProbabilityDelta = (Number(learnedSuppressionAccumulator.sumAbsProbabilityDelta) || 0) / Math.max(1, observedSamples - 1);
    const averageIntentDelta = (Number(learnedSuppressionAccumulator.sumAbsIntentDelta) || 0) / Math.max(1, observedSamples - 1);
    const averageTripFuelIntentDelta = (Number(learnedSuppressionAccumulator.sumAbsTripFuelIntentDelta) || 0) / Math.max(1, observedSamples - 1);
    const probabilitySpan = Math.max(
      0,
      (Number(learnedSuppressionAccumulator.maxEffectiveProbability) || 0) -
      (Number(learnedSuppressionAccumulator.minEffectiveProbability) || 0)
    );
    if (
      (Number(candidate.alongTrack) || 0) < opts.learnedSuppressionAccumulatorMinDistanceMeters ||
      (Number(candidate.alongTrack) || 0) > opts.learnedSuppressionAccumulatorMaxDistanceMeters ||
      (Number(snapshot.fuelNeedScore) || 0) < opts.learnedSuppressionAccumulatorMinFuelNeed ||
      tripFuelIntentSurplus < opts.learnedSuppressionAccumulatorMinTripFuelIntentSurplus ||
      (Number(candidate.intentEvidence) || 0) < opts.learnedSuppressionAccumulatorMinIntentEvidence ||
      (Number(candidate.effectiveDestinationProbability) || 0) < opts.learnedSuppressionAccumulatorMinEffectiveProbability ||
      (Number(candidate.visitShare) || 0) < opts.learnedSuppressionAccumulatorMinVisitShare ||
      (Number(candidate.routeHabitShare) || 0) < opts.learnedSuppressionAccumulatorMinRouteHabitShare ||
      (Number(candidate.observedSkipScore) || 0) > opts.learnedSuppressionAccumulatorMaxObservedSkip ||
      averageProbabilityDelta > opts.learnedSuppressionAccumulatorMaxAverageProbabilityDelta ||
      averageIntentDelta > opts.learnedSuppressionAccumulatorMaxAverageIntentDelta ||
      averageTripFuelIntentDelta > opts.learnedSuppressionAccumulatorMaxAverageTripFuelIntentDelta ||
      probabilitySpan < opts.learnedSuppressionAccumulatorMinProbabilitySpan
    ) {
      return null;
    }
    const recommendation = {
      stationId: candidate.stationId,
      type: 'predicted_stop',
      confidence: clamp(
        0.46 + (Math.min(0.18, (learnedSuppressionAccumulator.streak - opts.learnedSuppressionAccumulatorMinStreak) * 0.02)),
        0,
        0.70
      ),
      reason: `Predicted stop (stable learned support ${learnedSuppressionAccumulator.streak}x)`,
      forwardDistance: Number(candidate.alongTrack) || 0,
      fuelNeedScore: Number(snapshot.fuelNeedScore) || 0,
      decisionSnapshot: null,
      mlFeatures: {
        tripFuelIntentScore: Number(snapshot.tripFuelIntentScore) || 0,
        tripFuelIntentThreshold: Number(snapshot.tripFuelIntentThreshold) || 0,
        timePatternStrength: Number(snapshot.timePatternStrength) || 0,
        fuelNeedScore: Number(snapshot.fuelNeedScore) || 0,
        historyStrength: Number(snapshot.historyStrength) || 0,
        candidateEffectiveDestinationProbability: Number(candidate.effectiveDestinationProbability) || 0,
        candidateIntentEvidence: Number(candidate.intentEvidence) || 0,
        candidateVisitShare: Number(candidate.visitShare) || 0,
        candidateRouteHabitShare: Number(candidate.routeHabitShare) || 0,
        candidateContextualObservedConversionRate: Number(candidate.contextualObservedConversionRate) || 0,
        candidateObservedConversionRate: Number(candidate.observedConversionRate) || 0,
        candidateObservedSkipScore: Number(candidate.observedSkipScore) || 0,
        learnedSuppressionStreak: learnedSuppressionAccumulator.streak,
        learnedSuppressionAverageProbabilityDelta: averageProbabilityDelta,
        learnedSuppressionAverageIntentDelta: averageIntentDelta,
        learnedSuppressionAverageTripFuelIntentDelta: averageTripFuelIntentDelta,
        learnedSuppressionProbabilitySpan: probabilitySpan,
      },
    };
    recommendation.decisionSnapshot = cloneDecisionSnapshotWithSelectedCandidate(
      snapshot,
      candidate.stationId,
      recommendation,
    );
    recommendation.presentation = buildPresentationPlan(window, recommendation, candidate, opts);
    recommendation.commitmentAccumulator = {
      synthesized: true,
      suppressionStreak: learnedSuppressionAccumulator.streak,
      suppressionReason: learnedSuppressionAccumulator.suppressionReason,
      averageProbabilityDelta,
      averageIntentDelta,
      averageTripFuelIntentDelta,
      probabilitySpan,
    };
    return recommendation;
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
    tripDistanceMeters += deltaMeters;
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
    const routineSingleCandidate = (
      recommendation.type === 'predicted_stop' &&
      recommendation.decisionSnapshot?.candidateCount === 1 &&
      typeof recommendation.reason === 'string' &&
      (
        recommendation.reason.startsWith('Routine stop ahead') ||
        recommendation.reason.startsWith('Anchored routine stop ahead') ||
        recommendation.reason.startsWith('Timed routine stop ahead')
      )
    );
    if (routineSingleCandidate) {
      required = hasHistory
        ? Math.min(
          required,
          typeof recommendation.reason === 'string' && recommendation.reason.startsWith('Anchored routine stop ahead')
            ? opts.minStableRecommendationCountAnchoredRoutineSingleCandidate
            : (
              typeof recommendation.reason === 'string' && recommendation.reason.startsWith('Timed routine stop ahead')
                ? opts.minStableRecommendationCountTimedRoutineRecovery
                : opts.minStableRecommendationCountRoutineSingleCandidate
            )
        )
        : required;
    }
    const selectedDecisionCandidate = Array.isArray(recommendation.decisionSnapshot?.candidates)
      ? recommendation.decisionSnapshot.candidates.find(candidate => candidate?.selected)
      : null;
    const runnerUpDecisionCandidate = Array.isArray(recommendation.decisionSnapshot?.candidates)
      ? recommendation.decisionSnapshot.candidates
        .filter(candidate => candidate && !candidate.selected)
        .sort((left, right) =>
          (Number(right?.effectiveDestinationProbability) || 0) - (Number(left?.effectiveDestinationProbability) || 0) ||
          (Number(right?.intentEvidence) || 0) - (Number(left?.intentEvidence) || 0)
        )[0] || null
      : null;
    const noHistoryStrongSingleCandidatePattern = Boolean(
      !hasHistory &&
      recommendation.type === 'cold_start_best_value' &&
      Number(recommendation.decisionSnapshot?.candidateCount) === 1 &&
      selectedDecisionCandidate &&
      (Number(selectedDecisionCandidate.alongTrack) || 0) <= opts.lowSavingsColdStartRecoveryMaxDistanceMeters &&
      fuelNeed >= opts.lowSavingsColdStartRecoveryMinFuelNeed &&
      (Number(recommendation.decisionSnapshot?.tripFuelIntentScore) || 0) >= opts.lowSavingsColdStartRecoveryMinTripFuelIntentScore &&
      Math.max(
        0,
        (Number(recommendation.decisionSnapshot?.tripFuelIntentScore) || 0) -
        (Number(recommendation.decisionSnapshot?.tripFuelIntentThreshold) || 0)
      ) >= opts.lowSavingsColdStartRecoveryMinTripFuelIntentSurplus &&
      (Number(selectedDecisionCandidate.intentEvidence) || 0) >= opts.lowSavingsColdStartRecoveryMinIntentEvidence &&
      (Number(selectedDecisionCandidate.effectiveDestinationProbability) || 0) >= opts.lowSavingsColdStartRecoveryMinEffectiveProbability &&
      (Number(selectedDecisionCandidate.observedSkipScore) || 0) <= opts.zeroSavingsColdStartRecoveryMaxObservedSkip
    );
    const noHistoryHighFuelSingleCandidatePattern = Boolean(
      !hasHistory &&
      recommendation.type === 'cold_start_best_value' &&
      Number(recommendation.decisionSnapshot?.candidateCount) === 1 &&
      selectedDecisionCandidate &&
      (Number(selectedDecisionCandidate.alongTrack) || 0) <= opts.highFuelSingleCandidateLowSavingsRecoveryMaxDistanceMeters &&
      fuelNeed >= opts.highFuelSingleCandidateLowSavingsRecoveryMinFuelNeed &&
      (Number(recommendation.decisionSnapshot?.tripFuelIntentScore) || 0) >= opts.highFuelSingleCandidateLowSavingsRecoveryMinTripFuelIntentScore &&
      Math.max(
        0,
        (Number(recommendation.decisionSnapshot?.tripFuelIntentScore) || 0) -
        (Number(recommendation.decisionSnapshot?.tripFuelIntentThreshold) || 0)
      ) >= opts.highFuelSingleCandidateLowSavingsRecoveryMinTripFuelIntentSurplus &&
      (Number(selectedDecisionCandidate.intentEvidence) || 0) >= opts.highFuelSingleCandidateLowSavingsRecoveryMinIntentEvidence &&
      (Number(selectedDecisionCandidate.effectiveDestinationProbability) || 0) >= opts.highFuelSingleCandidateLowSavingsRecoveryMinEffectiveProbability
    );
    const noHistoryValueLeaderRecoveryPattern = Boolean(
      !hasHistory &&
      recommendation.type === 'cold_start_best_value' &&
      Number(recommendation.decisionSnapshot?.candidateCount) > 1 &&
      Number(recommendation.decisionSnapshot?.candidateCount) <= opts.noHistoryValueLeaderRecoveryMaxCandidateCount &&
      selectedDecisionCandidate &&
      runnerUpDecisionCandidate &&
      (Number(selectedDecisionCandidate.alongTrack) || 0) <= opts.noHistoryValueLeaderRecoveryMaxDistanceMeters &&
      fuelNeed >= opts.noHistoryValueLeaderRecoveryMinFuelNeed &&
      (Number(recommendation.decisionSnapshot?.tripFuelIntentScore) || 0) >= opts.noHistoryValueLeaderRecoveryMinTripFuelIntentScore &&
      Math.max(
        0,
        (Number(recommendation.decisionSnapshot?.tripFuelIntentScore) || 0) -
        (Number(recommendation.decisionSnapshot?.tripFuelIntentThreshold) || 0)
      ) >= opts.noHistoryValueLeaderRecoveryMinTripFuelIntentSurplus &&
      (Number(recommendation.decisionSnapshot?.leadMargin) || 0) >= opts.noHistoryValueLeaderRecoveryMinLeadMargin &&
      (Number(selectedDecisionCandidate.intentEvidence) || 0) >= opts.noHistoryValueLeaderRecoveryMinIntentEvidence &&
      (Number(selectedDecisionCandidate.effectiveDestinationProbability) || 0) >= opts.noHistoryValueLeaderRecoveryMinEffectiveProbability &&
      ((Number(selectedDecisionCandidate.valueScore) || 0) - (Number(runnerUpDecisionCandidate.valueScore) || 0)) >= opts.noHistoryValueLeaderRecoveryMinValueAdvantage &&
      ((Number(selectedDecisionCandidate.intentEvidence) || 0) - (Number(runnerUpDecisionCandidate.intentEvidence) || 0)) >= opts.noHistoryValueLeaderRecoveryMinIntentAdvantage
    );
    const routineSmallCandidateObservedPattern = Boolean(
      hasHistory &&
      recommendation.type === 'predicted_stop' &&
      Number(recommendation.decisionSnapshot?.candidateCount) > 0 &&
      Number(recommendation.decisionSnapshot?.candidateCount) <= opts.smallCandidateObservedRoutineMaxCandidateCount &&
      selectedDecisionCandidate &&
      (selectedDecisionCandidate.observedBehaviorStrength || 0) >= opts.smallCandidateObservedRoutineMinObservedBehaviorStrength &&
      (selectedDecisionCandidate.visitShare || 0) >= opts.smallCandidateObservedRoutineMinVisitShare &&
      (selectedDecisionCandidate.observedSkipScore || 0) <= opts.smallCandidateObservedRoutineMaxObservedSkip
    );
    if (routineSmallCandidateObservedPattern) {
      required = Math.min(required, opts.minStableRecommendationCountObservedRoutineSmallCandidate);
    }
    const supportedLowSpecificityPattern = Boolean(
      recommendation.type === 'predicted_stop' &&
      Number(recommendation.decisionSnapshot?.candidateCount) > 0 &&
      Number(recommendation.decisionSnapshot?.candidateCount) <= opts.supportedLowSpecificityMaxCandidateCount &&
      typeof recommendation.reason === 'string' &&
      recommendation.reason.startsWith('Viable stop ahead')
    );
    if (supportedLowSpecificityPattern) {
      required = Math.min(required, opts.minStableRecommendationCountSupportedLowSpecificity);
    }
    const valueDrivenLowSpecificityPattern = Boolean(
      recommendation.type === 'predicted_stop' &&
      typeof recommendation.reason === 'string' &&
      recommendation.reason.startsWith('High-value stop ahead')
    );
    if (valueDrivenLowSpecificityPattern) {
      required = Math.min(required, opts.minStableRecommendationCountSupportedLowSpecificity);
    }
    const highFuelCorridorRecoveryPattern = Boolean(
      recommendation.type === 'predicted_stop' &&
      typeof recommendation.reason === 'string' &&
      recommendation.reason === 'Predicted stop (high-fuel corridor recovery)'
    );
    if (highFuelCorridorRecoveryPattern) {
      required = 1;
    }
    const observedCorridorCapturePattern = Boolean(
      recommendation.type === 'predicted_stop' &&
      typeof recommendation.reason === 'string' &&
      recommendation.reason === 'Predicted stop (observed corridor capture)'
    );
    if (observedCorridorCapturePattern) {
      required = 1;
    }
    const lateObservedCorridorRecoveryPattern = Boolean(
      recommendation.type === 'predicted_stop' &&
      typeof recommendation.reason === 'string' &&
      recommendation.reason === 'Predicted stop (late observed corridor recovery)'
    );
    if (lateObservedCorridorRecoveryPattern) {
      required = 1;
    }
    const stableLearnedCorridorPattern = Boolean(
      recommendation.type === 'predicted_stop' &&
      typeof recommendation.reason === 'string' &&
      recommendation.reason === 'Predicted stop (stable corridor match)'
    );
    if (stableLearnedCorridorPattern) {
      required = 1;
    }
    const routeHabitLowNeedRecoveryPattern = hasHistory && isRouteHabitLowNeedRecoveryRecommendation(recommendation);
    if (routeHabitLowNeedRecoveryPattern) {
      required = 1;
    }
    if (noHistoryStrongSingleCandidatePattern) {
      required = Math.min(required, opts.minStableRecommendationCountNoHistoryStrongSingleCandidate);
    }
    if (noHistoryHighFuelSingleCandidatePattern) {
      required = Math.min(required, opts.minStableRecommendationCountNoHistoryHighFuelSingleCandidate);
    }
    if (noHistoryValueLeaderRecoveryPattern) {
      required = Math.min(required, opts.minStableRecommendationCountNoHistoryValueLeaderRecovery);
    }
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

  function findMatchingDecisionCandidate(snapshot, recommendation) {
    if (!snapshot || !recommendation || !Array.isArray(snapshot.candidates)) {
      return null;
    }
    return snapshot.candidates.find(candidate => candidate?.stationId === recommendation.stationId) || null;
  }

  function isRouteHabitLowNeedRecoveryRecommendation(recommendation) {
    if (!recommendation || recommendation.type !== 'predicted_stop') {
      return false;
    }
    const snapshot = recommendation.decisionSnapshot;
    const candidate = findMatchingDecisionCandidate(snapshot, recommendation);
    if (!snapshot || !candidate) {
      return false;
    }
    return Boolean(
      Number(snapshot?.candidateCount) >= opts.routeHabitLowNeedRecoveryMinCandidateCount &&
      Number(snapshot?.candidateCount) <= opts.routeHabitLowNeedRecoveryMaxCandidateCount &&
      (Number(candidate.routeHabitShare) || 0) >= opts.routeHabitLowNeedRecoveryMinRouteHabitShare &&
      (Number(candidate.visitShare) || 0) >= opts.routeHabitLowNeedRecoveryMinVisitShare &&
      (Number(candidate.visitShare) || 0) <= opts.routeHabitLowNeedRecoveryMaxVisitShare &&
      (Number(candidate.routeObservedSupport) || 0) <= opts.routeHabitLowNeedRecoveryMaxRouteObservedSupport &&
      (Number(candidate.contextualObservedConversionRate) || 0) >= opts.routeHabitLowNeedRecoveryMinContextualObservedConversionRate &&
      (Number(snapshot.tripFuelIntentScore) || 0) >= opts.routeHabitLowNeedRecoveryMinTripFuelIntentScore &&
      (Number(snapshot.fuelNeedScore) || 0) <= opts.routeHabitLowNeedRecoveryMaxFuelNeed &&
      (Number(candidate.effectiveDestinationProbability) || 0) >= opts.routeHabitLowNeedRecoveryMinEffectiveProbability &&
      (Number(candidate.observedSkipScore) || 0) <= opts.routeHabitLowNeedRecoveryMaxObservedSkip
    );
  }

  function buildPendingCarryCandidate(snapshot, recommendation) {
    const currentCandidate = findMatchingDecisionCandidate(snapshot, recommendation);
    const pendingSnapshotCandidate = findMatchingDecisionCandidate(recommendation?.decisionSnapshot, recommendation);
    if (!currentCandidate && !pendingSnapshotCandidate) {
      return { currentCandidate: null, pendingSnapshotCandidate: null, candidate: null };
    }
    if (!currentCandidate) {
      const fallbackCandidate = {
        ...(pendingSnapshotCandidate || {}),
      };
      if (Number.isFinite(Number(recommendation?.forwardDistance))) {
        fallbackCandidate.alongTrack = Math.max(0, Number(recommendation.forwardDistance));
      }
      return {
        currentCandidate: null,
        pendingSnapshotCandidate,
        candidate: fallbackCandidate,
      };
    }
    if (!pendingSnapshotCandidate) {
      return {
        currentCandidate,
        pendingSnapshotCandidate: null,
        candidate: currentCandidate,
      };
    }
    const candidate = {
      ...pendingSnapshotCandidate,
      ...currentCandidate,
    };
    const stickyMaxFields = [
      'intentEvidence',
      'effectiveDestinationProbability',
      'destinationProbability',
      'historyStrength',
      'visitShare',
      'routeHabitShare',
      'routeObservedSupport',
      'observedConversionRate',
      'contextualObservedConversionRate',
      'observedBehaviorStrength',
      'routeObservedConversionRate',
      'routeObservedExposureShare',
    ];
    for (const field of stickyMaxFields) {
      candidate[field] = Math.max(
        Number(currentCandidate?.[field]) || 0,
        Number(pendingSnapshotCandidate?.[field]) || 0,
      );
    }
    const stickyMinFields = [
      'observedSkipScore',
      'routeObservedSkipScore',
      'predictedDefaultGap',
      'destinationMarginToLeader',
    ];
    for (const field of stickyMinFields) {
      const values = [
        Number(currentCandidate?.[field]),
        Number(pendingSnapshotCandidate?.[field]),
      ].filter(value => Number.isFinite(value));
      if (values.length > 0) {
        candidate[field] = Math.min(...values);
      }
    }
    if (Number.isFinite(Number(currentCandidate?.alongTrack))) {
      candidate.alongTrack = Number(currentCandidate.alongTrack);
    } else if (Number.isFinite(Number(recommendation?.forwardDistance))) {
      candidate.alongTrack = Math.max(0, Number(recommendation.forwardDistance));
    } else if (Number.isFinite(Number(pendingSnapshotCandidate?.alongTrack))) {
      candidate.alongTrack = Number(pendingSnapshotCandidate.alongTrack);
    }
    return {
      currentCandidate,
      pendingSnapshotCandidate,
      candidate,
    };
  }

  function getColdStartGuardSuppressionReason(recommendation) {
    if (!recommendation) {
      return null;
    }
    const recommendationReason = String(recommendation.reason || '');
    const isColdStartLikeRecommendation = (
      recommendation.type === 'cold_start_best_value' ||
      recommendationReason.startsWith('High-value stop ahead') ||
      recommendationReason.startsWith('Viable stop ahead') ||
      recommendationReason.startsWith('Best stop ahead')
    );
    if (!isColdStartLikeRecommendation) {
      return null;
    }
    const snapshot = recommendation.decisionSnapshot;
    if (!snapshot || !Array.isArray(snapshot.candidates)) {
      return null;
    }
    const selectedCandidate = findMatchingDecisionCandidate(snapshot, recommendation);
    if (!selectedCandidate) {
      return null;
    }
    const candidateCount = Number(snapshot?.candidateCount) || snapshot.candidates.length || 0;
    const historyVisitCount = Number(snapshot?.historyVisitCount) || 0;
    const fuelNeedScore = Number(recommendation.fuelNeedScore) || 0;
    const recommendationSavings = Math.max(0, Number(recommendation.savings) || 0);
    const selectedEffectiveProbability = Number(selectedCandidate.effectiveDestinationProbability) || 0;
    const selectedObservedSkip = Number(selectedCandidate.observedSkipScore) || 0;
    const tripDemandPressure = Number(snapshot?.tripDemandPressure) || 0;
    const tripFuelIntentScore = Number(snapshot?.tripFuelIntentScore) || 0;
    const tripFuelIntentThreshold = Number(snapshot?.tripFuelIntentThreshold) || 0;
    const tripFuelIntentSurplus = Math.max(0, tripFuelIntentScore - tripFuelIntentThreshold);
    const lowSpecificityColdStart = Boolean(snapshot?.lowSpecificityColdStart);
    const isHighwayCruise = Boolean(snapshot?.isHighwayCruise);
    const selectedAlongTrack = Number(selectedCandidate.alongTrack) || 0;
    const selectedWeakRouteSupport = Math.max(
      Number(selectedCandidate.routeHabitShare) || 0,
      Number(selectedCandidate.routeObservedSupport) || 0,
      Number(selectedCandidate.observedBehaviorStrength) || 0,
      Number(selectedCandidate.contextualObservedConversionRate) || 0,
      Number(selectedCandidate.observedConversionRate) || 0,
      Number(selectedCandidate.visitShare) || 0,
    );
    const selectedRouteMemorySupport = Math.max(
      Number(selectedCandidate.routeHabitShare) || 0,
      Number(selectedCandidate.routeObservedSupport) || 0,
    );

    if (
      historyVisitCount === 0 &&
      candidateCount === opts.noHistoryShortRangeCompetitiveColdStartMaxCandidateCount &&
      lowSpecificityColdStart &&
      selectedAlongTrack <= opts.noHistoryShortRangeCompetitiveColdStartMaxDistanceMeters &&
      fuelNeedScore <= opts.noHistoryShortRangeCompetitiveColdStartMaxFuelNeed &&
      tripDemandPressure <= opts.noHistoryShortRangeCompetitiveColdStartMaxTripDemandPressure &&
      selectedEffectiveProbability >= opts.noHistoryShortRangeCompetitiveColdStartMinEffectiveProbability &&
      (Number(selectedCandidate.valueScore) || 0) >= opts.noHistoryShortRangeCompetitiveColdStartMinValueScore
    ) {
      return 'blocked_cold_start_no_history_short_range_competitive';
    }

    if (opts.enableNoHistoryFarValueLeaderGuard && historyVisitCount === 0) {
      const rankedByDistance = [...snapshot.candidates]
        .filter(Boolean)
        .sort((left, right) =>
          (Number(left?.alongTrack) || Number.POSITIVE_INFINITY) - (Number(right?.alongTrack) || Number.POSITIVE_INFINITY)
        );
      const nearestAlternativeCandidate = rankedByDistance.find(candidate => candidate?.stationId !== selectedCandidate.stationId) || null;
      const selectedProbability = Number(selectedCandidate.effectiveDestinationProbability) || 0;
      const selectedIntentEvidence = Number(selectedCandidate.intentEvidence) || 0;
      const selectedAlongTrack = Number(selectedCandidate.alongTrack) || Number.POSITIVE_INFINITY;
      const nearestAlternativeAlongTrack = Number(nearestAlternativeCandidate?.alongTrack) || Number.POSITIVE_INFINITY;
      const nearestAlternativeProbability = Number(nearestAlternativeCandidate?.effectiveDestinationProbability) || 0;
      const nearestAlternativeIntentEvidence = Number(nearestAlternativeCandidate?.intentEvidence) || 0;
      const selectedDistanceLead = Number.isFinite(selectedAlongTrack) && Number.isFinite(nearestAlternativeAlongTrack)
        ? selectedAlongTrack - nearestAlternativeAlongTrack
        : 0;
      const selectedIsPureValueLeader = Boolean(
        Number(selectedCandidate.valueRank) === 1 &&
        Number(selectedCandidate.intentRank) !== 1 &&
        Number(selectedCandidate.destinationRank) !== 1
      );
      const closerAlternativeLooksPlausible = Boolean(
        nearestAlternativeCandidate &&
        (selectedProbability - nearestAlternativeProbability) <= opts.noHistoryFarValueLeaderGuardMaxProbabilityGap &&
        (nearestAlternativeIntentEvidence - selectedIntentEvidence) >= opts.noHistoryFarValueLeaderGuardMinIntentAdvantage
      );
      if (
        lowSpecificityColdStart &&
        candidateCount >= opts.noHistoryFarValueLeaderGuardMinCandidateCount &&
        fuelNeedScore <= opts.noHistoryFarValueLeaderGuardMaxFuelNeed &&
        tripFuelIntentScore <= opts.noHistoryFarValueLeaderGuardMaxTripFuelIntentScore &&
        selectedAlongTrack >= opts.noHistoryFarValueLeaderGuardMinSelectedDistanceMeters &&
        selectedDistanceLead >= opts.noHistoryFarValueLeaderGuardMinDistanceLeadMeters &&
        selectedIsPureValueLeader &&
        closerAlternativeLooksPlausible
      ) {
        return 'blocked_cold_start_far_value_leader';
      }
    }

    if (
      lowSpecificityColdStart &&
      isHighwayCruise &&
      candidateCount <= opts.highDemandWeakSupportColdStartMaxCandidateCount &&
      tripDemandPressure >= opts.highDemandWeakSupportColdStartMinTripDemandPressure &&
      fuelNeedScore >= opts.highDemandWeakSupportColdStartMinFuelNeed &&
      selectedAlongTrack >= opts.highDemandWeakSupportColdStartMinDistanceMeters &&
      selectedWeakRouteSupport <= opts.highDemandWeakSupportColdStartMaxWeakSupport
    ) {
      return 'blocked_cold_start_high_demand_weak_support';
    }

    const historyPresentSpeculativeColdStart = Boolean(
      historyVisitCount >= opts.historyPresentSpeculativeColdStartMinHistoryVisits &&
      selectedRouteMemorySupport <= opts.historyPresentSpeculativeColdStartMaxWeakSupport
    );
    if (
      historyPresentSpeculativeColdStart &&
      !isHighwayCruise &&
      recommendationReason.startsWith('Viable stop ahead') &&
      candidateCount <= opts.historyPresentSpeculativeCityViableMaxCandidateCount &&
      fuelNeedScore <= opts.historyPresentSpeculativeCityViableMaxFuelNeed &&
      (
        (Number(selectedCandidate.visitShare) || 0) >= 0.10 ||
        (Number(selectedCandidate.contextualObservedConversionRate) || 0) >= 0.09
      ) &&
      selectedEffectiveProbability <= opts.historyPresentSpeculativeCityViableMaxProbability
    ) {
      return 'blocked_history_present_speculative_city_viable_stop';
    }
    if (
      historyPresentSpeculativeColdStart &&
      isHighwayCruise &&
      recommendationReason.startsWith('Viable stop ahead') &&
      candidateCount <= opts.historyPresentSpeculativeHighwayViableMaxCandidateCount &&
      selectedAlongTrack >= opts.historyPresentSpeculativeHighwayViableMinDistanceMeters &&
      selectedEffectiveProbability <= opts.historyPresentSpeculativeHighwayViableMaxProbability
    ) {
      return 'blocked_history_present_speculative_highway_viable_stop';
    }
    if (
      historyPresentSpeculativeColdStart &&
      recommendationReason.startsWith('Best stop ahead') &&
      candidateCount >= opts.historyPresentSpeculativeBestStopMinCandidateCount &&
      selectedAlongTrack >= opts.historyPresentSpeculativeBestStopMinDistanceMeters &&
      selectedEffectiveProbability <= opts.historyPresentSpeculativeBestStopMaxProbability
    ) {
      return 'blocked_history_present_speculative_best_stop';
    }
    if (
      historyVisitCount >= opts.historyPresentSpeculativeColdStartMinHistoryVisits &&
      fuelNeedScore >= opts.historyPresentHighFuelNoSupportColdStartMinFuelNeed &&
      selectedRouteMemorySupport <= opts.historyPresentHighFuelNoSupportColdStartMaxRouteMemorySupport &&
      recommendationReason.startsWith('Viable stop ahead') &&
      candidateCount <= opts.historyPresentHighFuelNoSupportColdStartMaxCandidateCount &&
      selectedAlongTrack >= opts.historyPresentHighFuelNoSupportColdStartMinDistanceMeters
    ) {
      return 'blocked_history_present_high_fuel_no_support_viable_stop';
    }
    if (
      historyVisitCount >= opts.historyPresentSpeculativeColdStartMinHistoryVisits &&
      fuelNeedScore >= opts.historyPresentHighFuelNoSupportColdStartMinFuelNeed &&
      selectedRouteMemorySupport <= opts.historyPresentHighFuelNoSupportColdStartMaxRouteMemorySupport &&
      recommendationReason.startsWith('Best stop ahead') &&
      candidateCount >= 2 &&
      selectedAlongTrack >= opts.historyPresentHighFuelNoSupportBestStopMinDistanceMeters
    ) {
      return 'blocked_history_present_high_fuel_no_support_best_stop';
    }

    if (opts.enableNoHistoryColdStartGuard && historyVisitCount === 0) {
      const rankedByCost = [...snapshot.candidates]
        .filter(candidate => candidate?.stationId !== selectedCandidate.stationId)
        .sort((left, right) =>
          (Number(left?.netStationCost) || Number.POSITIVE_INFINITY) - (Number(right?.netStationCost) || Number.POSITIVE_INFINITY) ||
          (Number(right?.effectiveDestinationProbability) || 0) - (Number(left?.effectiveDestinationProbability) || 0)
        );
      const nextBestCostCandidate = rankedByCost[0] || null;
      const leadGap = nextBestCostCandidate
        ? Math.abs(
          (Number(selectedCandidate.effectiveDestinationProbability) || 0) -
          (Number(nextBestCostCandidate.effectiveDestinationProbability) || 0)
        )
        : (Number(selectedCandidate.effectiveDestinationProbability) || 0);
      const netSavingsVsNextBest = nextBestCostCandidate
        ? Math.max(
          0,
          (Number(nextBestCostCandidate.netStationCost) || Number.POSITIVE_INFINITY) -
          (Number(selectedCandidate.netStationCost) || Number.POSITIVE_INFINITY)
        )
        : 0;
      const selectedIntentEvidence = Number(selectedCandidate.intentEvidence) || 0;
      const nextBestIntentEvidence = Number(nextBestCostCandidate?.intentEvidence) || 0;
      const selectedValueScore = Number(selectedCandidate.valueScore) || 0;
      const nextBestValueScore = Number(nextBestCostCandidate?.valueScore) || 0;
      const strongSingleCandidateRecovery = Boolean(
        opts.enableNoHistoryStrongSingleCandidateRecovery &&
        candidateCount === 1 &&
        selectedAlongTrack <= opts.noHistoryStrongSingleCandidateRecoveryMaxDistanceMeters &&
        fuelNeedScore >= opts.noHistoryStrongSingleCandidateRecoveryMinFuelNeed &&
        tripFuelIntentScore >= opts.noHistoryStrongSingleCandidateRecoveryMinTripFuelIntentScore &&
        tripFuelIntentSurplus >= opts.noHistoryStrongSingleCandidateRecoveryMinTripFuelIntentSurplus &&
        selectedIntentEvidence >= opts.noHistoryStrongSingleCandidateRecoveryMinIntentEvidence &&
        selectedEffectiveProbability >= opts.noHistoryStrongSingleCandidateRecoveryMinEffectiveProbability &&
        selectedObservedSkip <= opts.noHistoryStrongSingleCandidateRecoveryMaxObservedSkip
      );
    const strongValueLeaderRecovery = Boolean(
      opts.enableNoHistoryValueLeaderRecovery &&
      candidateCount > 1 &&
        candidateCount <= opts.noHistoryValueLeaderRecoveryMaxCandidateCount &&
        selectedAlongTrack <= opts.noHistoryValueLeaderRecoveryMaxDistanceMeters &&
        fuelNeedScore >= opts.noHistoryValueLeaderRecoveryMinFuelNeed &&
        tripFuelIntentScore >= opts.noHistoryValueLeaderRecoveryMinTripFuelIntentScore &&
        tripFuelIntentSurplus >= opts.noHistoryValueLeaderRecoveryMinTripFuelIntentSurplus &&
        selectedIntentEvidence >= opts.noHistoryValueLeaderRecoveryMinIntentEvidence &&
        selectedEffectiveProbability >= opts.noHistoryValueLeaderRecoveryMinEffectiveProbability &&
        leadGap >= opts.noHistoryValueLeaderRecoveryMinLeadMargin &&
        (selectedValueScore - nextBestValueScore) >= opts.noHistoryValueLeaderRecoveryMinValueAdvantage &&
        (selectedIntentEvidence - nextBestIntentEvidence) >= opts.noHistoryValueLeaderRecoveryMinIntentAdvantage
      );
      if (
        candidateCount === 1 &&
        fuelNeedScore < opts.noHistoryColdStartSingleCandidateMinFuelNeed &&
        !strongSingleCandidateRecovery
      ) {
        return 'blocked_cold_start_no_history_single_candidate_low_need';
      }
      if (
        candidateCount > 1 &&
        (
          selectedAlongTrack > opts.noHistoryColdStartMaxDistanceMeters ||
          leadGap < opts.noHistoryColdStartMinLeadMargin ||
          netSavingsVsNextBest < opts.noHistoryColdStartMinNetSavings
      ) &&
      !strongValueLeaderRecovery
    ) {
      return 'blocked_cold_start_no_history_ambiguous_low_value';
    }

  }

    const zeroSavingsColdStartRecovery = Boolean(
      opts.enableZeroSavingsColdStartRecovery &&
      historyVisitCount === 0 &&
      candidateCount === 1 &&
      selectedAlongTrack <= opts.zeroSavingsColdStartRecoveryMaxDistanceMeters &&
      fuelNeedScore >= opts.zeroSavingsColdStartRecoveryMinFuelNeed &&
      tripFuelIntentScore >= opts.zeroSavingsColdStartRecoveryMinTripFuelIntentScore &&
      tripFuelIntentSurplus >= opts.zeroSavingsColdStartRecoveryMinTripFuelIntentSurplus &&
      (Number(selectedCandidate.intentEvidence) || 0) >= opts.zeroSavingsColdStartRecoveryMinIntentEvidence &&
      selectedEffectiveProbability >= opts.zeroSavingsColdStartRecoveryMinEffectiveProbability &&
      selectedObservedSkip <= opts.zeroSavingsColdStartRecoveryMaxObservedSkip
    );
    if (
      opts.enableZeroSavingsColdStartGuard &&
      candidateCount === 1 &&
      recommendationSavings <= opts.zeroSavingsColdStartMaxSavings &&
      fuelNeedScore <= opts.zeroSavingsColdStartMaxFuelNeed &&
      selectedObservedSkip >= opts.zeroSavingsColdStartMinObservedSkip &&
      selectedEffectiveProbability <= opts.zeroSavingsColdStartMaxProbability &&
      !zeroSavingsColdStartRecovery
    ) {
      return 'blocked_cold_start_zero_savings_single_candidate';
    }

    const lowSavingsColdStartRecovery = Boolean(
      opts.enableLowSavingsColdStartRecovery &&
      historyVisitCount === 0 &&
      candidateCount === 1 &&
      selectedAlongTrack <= opts.lowSavingsColdStartRecoveryMaxDistanceMeters &&
      fuelNeedScore >= opts.lowSavingsColdStartRecoveryMinFuelNeed &&
      tripFuelIntentScore >= opts.lowSavingsColdStartRecoveryMinTripFuelIntentScore &&
      tripFuelIntentSurplus >= opts.lowSavingsColdStartRecoveryMinTripFuelIntentSurplus &&
      (Number(selectedCandidate.intentEvidence) || 0) >= opts.lowSavingsColdStartRecoveryMinIntentEvidence &&
      selectedEffectiveProbability >= opts.lowSavingsColdStartRecoveryMinEffectiveProbability
    );
    const highFuelSingleCandidateLowSavingsRecovery = Boolean(
      opts.enableHighFuelSingleCandidateLowSavingsRecovery &&
      historyVisitCount === 0 &&
      candidateCount === 1 &&
      selectedAlongTrack <= opts.highFuelSingleCandidateLowSavingsRecoveryMaxDistanceMeters &&
      fuelNeedScore >= opts.highFuelSingleCandidateLowSavingsRecoveryMinFuelNeed &&
      tripFuelIntentScore >= opts.highFuelSingleCandidateLowSavingsRecoveryMinTripFuelIntentScore &&
      tripFuelIntentSurplus >= opts.highFuelSingleCandidateLowSavingsRecoveryMinTripFuelIntentSurplus &&
      (Number(selectedCandidate.intentEvidence) || 0) >= opts.highFuelSingleCandidateLowSavingsRecoveryMinIntentEvidence &&
      selectedEffectiveProbability >= opts.highFuelSingleCandidateLowSavingsRecoveryMinEffectiveProbability
    );
    if (
      opts.enableZeroSavingsColdStartGuard &&
      candidateCount <= 2 &&
      recommendationSavings <= opts.lowSavingsColdStartMaxSavings &&
      fuelNeedScore <= opts.lowSavingsColdStartMaxFuelNeed &&
      selectedEffectiveProbability <= opts.lowSavingsColdStartMaxProbability &&
      !lowSavingsColdStartRecovery &&
      !highFuelSingleCandidateLowSavingsRecovery
    ) {
      return 'blocked_cold_start_low_savings';
    }

    if (
      candidateCount <= 1 ||
      candidateCount > opts.coldStartRouteSupportedCompetitorMaxCandidateCount
    ) {
      return null;
    }

    const routeSupportedCompetitor = [...snapshot.candidates]
      .filter(candidate => candidate?.stationId !== selectedCandidate.stationId)
      .sort((left, right) =>
        (Number(right?.routeObservedSupport) || 0) - (Number(left?.routeObservedSupport) || 0) ||
        (Number(right?.routeHabitShare) || 0) - (Number(left?.routeHabitShare) || 0) ||
        (Number(right?.contextualObservedConversionRate) || 0) - (Number(left?.contextualObservedConversionRate) || 0) ||
        (Number(right?.effectiveDestinationProbability) || 0) - (Number(left?.effectiveDestinationProbability) || 0)
      )[0] || null;
    if (!routeSupportedCompetitor) {
      return null;
    }

    const selectedRouteHabitShare = Number(selectedCandidate.routeHabitShare) || 0;
    const selectedRouteObservedSupport = Number(selectedCandidate.routeObservedSupport) || 0;
    const selectedObservedBehaviorStrength = Number(selectedCandidate.observedBehaviorStrength) || 0;
    const competitorRouteHabitShare = Number(routeSupportedCompetitor.routeHabitShare) || 0;
    const competitorRouteObservedSupport = Number(routeSupportedCompetitor.routeObservedSupport) || 0;
    const competitorRouteObservedExposureCount = Number(routeSupportedCompetitor.routeObservedExposureCount) || 0;
    const competitorContextualObservedConversionRate = Number(routeSupportedCompetitor.contextualObservedConversionRate) || 0;
    const competitorRouteObservedSkip = Number(routeSupportedCompetitor.routeObservedSkipScore) || 0;
    const competitorEffectiveProbability = Number(routeSupportedCompetitor.effectiveDestinationProbability) || 0;
    const leadGap = Math.abs(selectedEffectiveProbability - competitorEffectiveProbability);

    if (
      fuelNeedScore >= opts.coldStartRouteSupportedCompetitorMinFuelNeed &&
      competitorRouteHabitShare >= opts.coldStartRouteSupportedCompetitorMinRouteHabitShare &&
      competitorRouteObservedSupport >= opts.coldStartRouteSupportedCompetitorMinRouteObservedSupport &&
      competitorRouteObservedExposureCount >= opts.coldStartRouteSupportedCompetitorMinRouteObservedExposureCount &&
      competitorContextualObservedConversionRate >= opts.coldStartRouteSupportedCompetitorMinContextualObservedConversionRate &&
      competitorRouteObservedSkip <= opts.coldStartRouteSupportedCompetitorMaxRouteObservedSkip &&
      leadGap <= opts.coldStartRouteSupportedCompetitorMaxLeadGap &&
      selectedRouteHabitShare <= opts.coldStartRouteSupportedCompetitorSelectedMaxRouteHabitShare &&
      selectedRouteObservedSupport <= opts.coldStartRouteSupportedCompetitorSelectedMaxRouteObservedSupport &&
      selectedObservedBehaviorStrength <= opts.coldStartRouteSupportedCompetitorSelectedMaxObservedBehaviorStrength
    ) {
      return 'blocked_cold_start_route_supported_competitor';
    }

    const selectedColdStartScore = Number(selectedCandidate.coldStartScore) || 0;
    const selectedIntentEvidence = Number(selectedCandidate.intentEvidence) || 0;
    const ambiguousFarCompetitor = [...snapshot.candidates]
      .filter(candidate => candidate?.stationId !== selectedCandidate.stationId)
      .find(candidate => {
        const competitorAlongTrack = Number(candidate?.alongTrack) || 0;
        const competitorEffectiveProbability = Number(candidate?.effectiveDestinationProbability) || 0;
        const competitorColdStartScore = Number(candidate?.coldStartScore) || 0;
        const competitorIntentEvidence = Number(candidate?.intentEvidence) || 0;
        const competitorWeakRouteSupport = Math.max(
          Number(candidate?.routeHabitShare) || 0,
          Number(candidate?.routeObservedSupport) || 0,
          Number(candidate?.observedBehaviorStrength) || 0,
          Number(candidate?.contextualObservedConversionRate) || 0,
          Number(candidate?.visitShare) || 0,
        );
        return (
          competitorAlongTrack >= selectedAlongTrack + opts.coldStartAmbiguousFarCompetitorMinAlongTrackGapMeters &&
          competitorEffectiveProbability >= selectedEffectiveProbability - opts.coldStartAmbiguousFarCompetitorMaxLeadGap &&
          competitorColdStartScore >= selectedColdStartScore + opts.coldStartAmbiguousFarCompetitorMinColdStartAdvantage &&
          competitorIntentEvidence >= opts.coldStartAmbiguousFarCompetitorMinIntentEvidence &&
          competitorWeakRouteSupport <= opts.coldStartAmbiguousFarCompetitorMaxRouteSupport
        );
      }) || null;

    if (
      fuelNeedScore >= opts.coldStartAmbiguousFarCompetitorMinFuelNeed &&
      selectedAlongTrack <= opts.coldStartAmbiguousFarCompetitorMaxSelectedDistanceMeters &&
      selectedWeakRouteSupport <= opts.coldStartAmbiguousFarCompetitorMaxRouteSupport &&
      selectedObservedBehaviorStrength <= opts.coldStartAmbiguousFarCompetitorMaxObservedBehaviorStrength &&
      selectedIntentEvidence >= opts.coldStartAmbiguousFarCompetitorMinIntentEvidence &&
      snapshot.candidates.length <= opts.coldStartAmbiguousFarCompetitorMaxCandidateCount &&
      ambiguousFarCompetitor
    ) {
      return 'blocked_cold_start_ambiguous_far_competitor';
    }

    return null;
  }

  function getCheaperAlternativeGuardSuppressionReason(recommendation) {
    if (!recommendation || recommendation.type !== 'cheaper_alternative') {
      return null;
    }
    const snapshot = recommendation.decisionSnapshot;
    if (!snapshot || !Array.isArray(snapshot.candidates)) {
      return null;
    }
    const selectedCandidate = findMatchingDecisionCandidate(snapshot, recommendation);
    const defaultStationId = recommendation.predictedDefault || snapshot.predictedDefaultStationId;
    const defaultCandidate = snapshot.candidates.find(candidate => candidate?.stationId === defaultStationId) || null;
    const historyVisitCount = Number(snapshot?.historyVisitCount) || 0;
    const fuelNeedScore = Number(recommendation.fuelNeedScore) || 0;
    const candidateCount = Number(snapshot?.candidateCount) || snapshot.candidates.length || 0;
    if (!selectedCandidate || !defaultCandidate) {
      return null;
    }
    const selectedSupport = Math.max(
      Number(selectedCandidate.routeHabitShare) || 0,
      Number(selectedCandidate.routeObservedSupport) || 0,
      Number(selectedCandidate.observedBehaviorStrength) || 0,
      Number(selectedCandidate.contextualObservedConversionRate) || 0,
      Number(selectedCandidate.observedConversionRate) || 0,
      Number(selectedCandidate.visitShare) || 0,
    );
    const defaultGap = Math.abs(
      (Number(defaultCandidate.effectiveDestinationProbability) || 0) -
      (Number(selectedCandidate.effectiveDestinationProbability) || 0)
    );
    if (
      historyVisitCount >= opts.speculativeCheaperAlternativeMinHistoryVisits &&
      candidateCount <= opts.speculativeCheaperAlternativeMaxCandidateCount &&
      fuelNeedScore <= opts.speculativeCheaperAlternativeMaxFuelNeed &&
      (Number(selectedCandidate.alongTrack) || 0) <= opts.speculativeCheaperAlternativeMaxDistanceMeters &&
      selectedSupport <= opts.speculativeCheaperAlternativeMaxSelectedSupport &&
      (Number(selectedCandidate.observedSkipScore) || 0) >= opts.speculativeCheaperAlternativeMinSelectedObservedSkip &&
      (Number(defaultCandidate.routeHabitShare) || 0) >= opts.speculativeCheaperAlternativeMinDefaultRouteHabitShare &&
      (Number(defaultCandidate.contextualObservedConversionRate) || 0) >= opts.speculativeCheaperAlternativeMinDefaultContextualObservedConversionRate &&
      defaultGap <= opts.speculativeCheaperAlternativeMaxDefaultGap
    ) {
      return 'blocked_speculative_cheaper_alternative';
    }
    return null;
  }

  function getRecommendationGuardSuppressionReason(recommendation) {
    return (
      getColdStartGuardSuppressionReason(recommendation) ||
      getCheaperAlternativeGuardSuppressionReason(recommendation) ||
      getRoutineGuardSuppressionReason(recommendation)
    );
  }

  function getRoutineGuardSuppressionReason(recommendation) {
    if (!recommendation || recommendation.type !== 'predicted_stop') {
      return null;
    }
    const reason = String(recommendation.reason || '');
    const isRoutineReason = (
      reason.startsWith('Predicted stop') ||
      reason.startsWith('Routine stop ahead') ||
      reason.startsWith('Anchored routine stop ahead') ||
      reason.startsWith('Observed routine stop ahead')
    );
    if (!isRoutineReason) {
      return null;
    }
    if (reason === 'Predicted stop (late observed corridor recovery)') {
      return null;
    }
    const snapshot = recommendation.decisionSnapshot;
    const candidate = findMatchingDecisionCandidate(snapshot, recommendation);
    if (!candidate) {
      return null;
    }

    const candidateCount = Number(snapshot?.candidateCount) || 0;
    const effectiveProbability = Number(candidate.effectiveDestinationProbability) || 0;
    const routeHabitShare = Number(candidate.routeHabitShare) || 0;
    const routeObservedSkipScore = Number(candidate.routeObservedSkipScore) || 0;
    const routeObservedReliability = Number(candidate.routeObservedReliability) || 0;
    const visitShare = Number(candidate.visitShare) || 0;
    const contextualObservedConversionRate = Number(candidate.contextualObservedConversionRate) || 0;
    const observedBehaviorStrength = Number(candidate.observedBehaviorStrength) || 0;
    const brandAffinity = Number(candidate.brandAffinity) || 0;
    const alongTrack = Number(candidate.alongTrack) || 0;
    const fuelNeedScore = Number(recommendation.fuelNeedScore) || 0;
    const timePatternStrength = Number(snapshot?.timePatternStrength) || 0;
    const observedSkipScore = Number(candidate.observedSkipScore) || 0;
    const recommendationSavings = Math.max(0, Number(recommendation.savings) || 0);
    const tripDemandPressure = Number(snapshot?.tripDemandPressure) || 0;
    const isPredictedStopRoutineReason = (
      reason.startsWith('Predicted stop') ||
      reason.startsWith('Routine stop ahead') ||
      reason.startsWith('Anchored routine stop ahead') ||
      reason.startsWith('Observed routine stop ahead')
    );

    if (
      isPredictedStopRoutineReason &&
      candidateCount === 1 &&
      routeHabitShare >= opts.routeObservedRoutineLeakMinRouteHabitShare &&
      routeObservedReliability >= opts.routeObservedRoutineLeakMinRouteObservedReliability &&
      routeObservedSkipScore >= opts.routeObservedRoutineLeakMinRouteObservedSkip &&
      contextualObservedConversionRate >= opts.routeObservedRoutineLeakMinContextualObservedConversionRate &&
      observedSkipScore >= opts.routeObservedRoutineLeakMinObservedSkip
    ) {
      return 'blocked_route_observed_routine_leak';
    }

    if (
      isPredictedStopRoutineReason &&
      candidateCount <= opts.routeHabitRepeatPredictedStopMaxCandidateCount &&
      routeHabitShare >= opts.routeHabitRepeatPredictedStopMinRouteHabitShare &&
      visitShare >= opts.routeHabitRepeatPredictedStopMinVisitShare &&
      fuelNeedScore <= opts.routeHabitRepeatPredictedStopMaxFuelNeed &&
      timePatternStrength <= opts.routeHabitRepeatPredictedStopMaxTimePatternStrength &&
      alongTrack >= opts.routeHabitRepeatPredictedStopMinDistanceMeters &&
      effectiveProbability <= opts.routeHabitRepeatPredictedStopMaxProbability
    ) {
      return 'blocked_route_habit_repeat_low_need_predicted_stop';
    }

    if (
      reason.startsWith('Predicted stop') &&
      candidateCount <= opts.routeHabitLowNeedPredictedStopMaxCandidateCount &&
      routeHabitShare >= opts.routeHabitLowNeedPredictedStopMinRouteHabitShare &&
      contextualObservedConversionRate >= opts.routeHabitLowNeedPredictedStopMinContextualObservedConversionRate &&
      fuelNeedScore <= opts.routeHabitLowNeedPredictedStopMaxFuelNeed &&
      timePatternStrength <= opts.routeHabitLowNeedPredictedStopMaxTimePatternStrength &&
      alongTrack >= opts.routeHabitLowNeedPredictedStopMinDistanceMeters &&
      effectiveProbability <= opts.routeHabitLowNeedPredictedStopMaxProbability
    ) {
      return 'blocked_route_habit_low_need_predicted_stop';
    }

    if (
      candidateCount === 1 &&
      routeHabitShare >= opts.routeHabitObservedRoutineMinShare &&
      brandAffinity >= opts.brandHabitFallbackMinBrandAffinity &&
      visitShare < opts.brandHabitFallbackMinVisitShare &&
      contextualObservedConversionRate < opts.brandHabitFallbackMaxContextualObservedConversionRate &&
      effectiveProbability < opts.brandHabitFallbackMinProbability
    ) {
      return 'blocked_brand_habit_routine';
    }

    if (
      candidateCount === 1 &&
      alongTrack > opts.lowNeedLongDistanceRoutineMeters &&
      fuelNeedScore < opts.lowNeedLongDistanceRoutineMinFuelNeed &&
      timePatternStrength < opts.strongObservedRoutineMinTimePatternStrength &&
      effectiveProbability < opts.lowNeedLongDistanceRoutineMinProbability
    ) {
      return 'blocked_low_need_long_distance_routine';
    }

    if (
      reason.startsWith('Observed routine stop ahead') &&
      routeHabitShare < opts.weakObservedRoutineMaxRouteHabitShare &&
      observedBehaviorStrength < opts.weakObservedRoutineMaxObservedBehaviorStrength &&
      effectiveProbability < opts.weakObservedRoutineMinProbability
    ) {
      return 'blocked_weak_observed_routine';
    }

    if (
      reason.startsWith('Observed routine stop ahead') &&
      (Number(candidate.observedSkipScore) || 0) >= opts.highSkipObservedRoutineMinSkip &&
      effectiveProbability < opts.highSkipObservedRoutineMaxProbability
    ) {
      return 'blocked_high_skip_observed_routine';
    }

    if (
      reason.startsWith('Observed routine stop ahead') &&
      tripDemandPressure <= opts.lowDemandObservedRoutineMaxTripDemandPressure &&
      fuelNeedScore <= opts.lowDemandObservedRoutineMaxFuelNeed &&
      alongTrack >= opts.lowDemandObservedRoutineMinDistanceMeters &&
      routeHabitShare <= opts.lowDemandObservedRoutineMaxRouteHabitShare &&
      (Number(candidate.routeObservedSupport) || 0) <= opts.lowDemandObservedRoutineMaxRouteObservedSupport
    ) {
      return 'blocked_low_demand_observed_routine';
    }

    if (
      reason.startsWith('Observed routine stop ahead') &&
      candidateCount === 1 &&
      alongTrack >= opts.longDistanceObservedRoutineMinDistanceMeters &&
      tripDemandPressure <= opts.longDistanceObservedRoutineMaxTripDemandPressure &&
      fuelNeedScore <= opts.longDistanceObservedRoutineMaxFuelNeed &&
      effectiveProbability <= opts.longDistanceObservedRoutineMaxProbability
    ) {
      return 'blocked_long_distance_observed_routine';
    }

    if (
      reason === 'Predicted stop (observed corridor capture)' &&
      tripDemandPressure <= opts.lowDemandObservedCaptureMaxTripDemandPressure &&
      fuelNeedScore <= opts.lowDemandObservedCaptureMaxFuelNeed &&
      routeHabitShare <= opts.lowDemandObservedCaptureMaxRouteHabitShare
    ) {
      return 'blocked_low_demand_observed_capture';
    }

    if (
      reason === 'Predicted stop (observed corridor capture)' &&
      candidateCount === 1 &&
      routeHabitShare >= opts.routeHabitObservedCaptureLeakMinRouteHabitShare &&
      (Number(candidate.routeObservedSupport) || 0) <= opts.routeHabitObservedCaptureLeakMaxRouteObservedSupport &&
      routeObservedSkipScore >= opts.routeHabitObservedCaptureLeakMinRouteObservedSkip &&
      tripDemandPressure <= opts.routeHabitObservedCaptureLeakMaxTripDemandPressure &&
      fuelNeedScore <= opts.routeHabitObservedCaptureLeakMaxFuelNeed
    ) {
      return 'blocked_route_habit_observed_capture_leak';
    }

    if (
      opts.enableZeroSavingsObservedCaptureGuard &&
      reason === 'Predicted stop (observed corridor capture)' &&
      candidateCount === 1 &&
      recommendationSavings <= opts.zeroSavingsObservedCaptureMaxSavings &&
      fuelNeedScore <= opts.zeroSavingsObservedCaptureMaxFuelNeed &&
      alongTrack >= opts.zeroSavingsObservedCaptureMinDistanceMeters &&
      effectiveProbability <= opts.zeroSavingsObservedCaptureMaxProbability &&
      observedSkipScore >= opts.zeroSavingsObservedCaptureMinObservedSkip
    ) {
      return 'blocked_zero_savings_observed_capture';
    }

    if (
      opts.enableZeroSavingsRoutineGuard &&
      candidateCount === 1 &&
      recommendationSavings <= opts.zeroSavingsRoutineMaxSavings &&
      fuelNeedScore <= opts.zeroSavingsRoutineMaxFuelNeed &&
      alongTrack >= opts.zeroSavingsRoutineMinDistanceMeters &&
      effectiveProbability <= opts.zeroSavingsRoutineMaxProbability &&
      observedSkipScore >= opts.zeroSavingsRoutineMinObservedSkip &&
      (
        reason.startsWith('Observed routine stop ahead') ||
        reason.startsWith('Routine stop ahead') ||
        reason.startsWith('Anchored routine stop ahead')
      )
    ) {
      return 'blocked_zero_savings_routine';
    }

    if (
      reason.startsWith('Predicted stop') &&
      candidateCount === 1 &&
      fuelNeedScore <= opts.genericBrandHabitPredictedStopMaxFuelNeed &&
      routeHabitShare >= opts.routeHabitObservedRoutineMinShare &&
      brandAffinity >= opts.brandHabitFallbackMinBrandAffinity &&
      visitShare < opts.brandHabitFallbackMinVisitShare &&
      contextualObservedConversionRate < opts.brandHabitFallbackMaxContextualObservedConversionRate &&
      effectiveProbability < opts.genericBrandHabitPredictedStopMinProbability
    ) {
      return 'blocked_generic_brand_habit_predicted_stop';
    }

    if (
      reason.startsWith('Predicted stop') &&
      candidateCount === 1 &&
      fuelNeedScore <= opts.genericPredictedStopLowTimePatternMaxFuelNeed &&
      timePatternStrength <= opts.genericPredictedStopLowTimePatternMaxTimePatternStrength &&
      routeHabitShare >= opts.genericPredictedStopLowTimePatternMinRouteHabitShare &&
      brandAffinity >= opts.genericPredictedStopLowTimePatternMinBrandAffinity &&
      visitShare <= opts.genericPredictedStopLowTimePatternMaxVisitShare &&
      contextualObservedConversionRate <= opts.genericPredictedStopLowTimePatternMaxContextualObservedConversionRate &&
      effectiveProbability <= opts.genericPredictedStopLowTimePatternMaxProbability
    ) {
      return 'blocked_generic_low_time_pattern_predicted_stop';
    }

    if (
      reason.startsWith('Routine stop ahead') &&
      candidateCount === 1 &&
      routeHabitShare >= opts.highConversionRouteHabitRoutineMinRouteHabitShare &&
      visitShare >= opts.highConversionRouteHabitRoutineMinVisitShare &&
      contextualObservedConversionRate >= opts.highConversionRouteHabitRoutineMinContextualObservedConversionRate &&
      timePatternStrength >= opts.highConversionRouteHabitRoutineMinTimePatternStrength &&
      alongTrack >= opts.highConversionRouteHabitRoutineMinDistanceMeters &&
      fuelNeedScore <= opts.highConversionRouteHabitRoutineMaxFuelNeed &&
      effectiveProbability <= opts.highConversionRouteHabitRoutineMaxProbability
    ) {
      return 'blocked_high_conversion_route_habit_routine';
    }

    if (
      reason.startsWith('Routine stop ahead') &&
      candidateCount === 1 &&
      fuelNeedScore <= opts.lowNeedRoutineMaxFuelNeed &&
      timePatternStrength <= opts.lowNeedRoutineMaxTimePatternStrength &&
      routeHabitShare >= opts.lowNeedRoutineMinRouteHabitShare &&
      effectiveProbability <= opts.lowNeedRoutineMaxProbability
    ) {
      return 'blocked_low_need_routine';
    }

    if (
      reason.startsWith('Anchored routine stop ahead') &&
      candidateCount === 1 &&
      fuelNeedScore <= opts.highSkipAnchoredRoutineMaxFuelNeed &&
      timePatternStrength <= opts.highSkipAnchoredRoutineMaxTimePatternStrength &&
      routeHabitShare >= opts.highSkipAnchoredRoutineMinRouteHabitShare &&
      (Number(candidate.observedSkipScore) || 0) >= opts.highSkipAnchoredRoutineMinSkip &&
      effectiveProbability <= opts.highSkipAnchoredRoutineMaxProbability
    ) {
      return 'blocked_high_skip_anchored_routine';
    }

    if (
      (
        reason.startsWith('Routine stop ahead') ||
        reason.startsWith('Anchored routine stop ahead')
      ) &&
      alongTrack >= opts.longDistanceRoutineMinDistanceMeters &&
      fuelNeedScore <= opts.longDistanceRoutineMaxFuelNeed &&
      effectiveProbability < opts.longDistanceRoutineMaxProbability
    ) {
      return 'blocked_long_distance_routine';
    }

    if (
      reason.startsWith('Routine stop ahead') &&
      candidateCount === 1 &&
      alongTrack >= opts.speculativeLongDistanceRouteHabitRoutineMinDistanceMeters &&
      fuelNeedScore <= opts.speculativeLongDistanceRouteHabitRoutineMaxFuelNeed &&
      (Number(snapshot?.tripFuelIntentScore) || 0) <= opts.speculativeLongDistanceRouteHabitRoutineMaxTripFuelIntentScore &&
      routeHabitShare >= opts.speculativeLongDistanceRouteHabitRoutineMinRouteHabitShare &&
      effectiveProbability <= opts.speculativeLongDistanceRouteHabitRoutineMaxProbability
    ) {
      return 'blocked_speculative_long_distance_route_habit_routine';
    }

    if (
      reason.startsWith('Viable stop ahead') &&
      routeHabitShare < opts.weakObservedRoutineMaxRouteHabitShare &&
      observedBehaviorStrength < opts.weakObservedRoutineMaxObservedBehaviorStrength &&
      effectiveProbability < opts.weakSupportedLowSpecificityMaxProbability
    ) {
      return 'blocked_weak_supported_low_specificity';
    }

    return null;
  }

  function shouldAllowPendingRelease(snapshot, recommendation, minReleaseDistanceMeters) {
    const pendingCarryReason = String(recommendation?.reason || '');
    const noHistorySingleCandidatePendingCarrySupport = Boolean(
      getTotalHistoryVisits() === 0 &&
      recommendation?.type === 'cold_start_best_value' &&
      (Number(recommendation?.decisionSnapshot?.candidateCount) || 0) === 1 &&
      (Number(recommendation?.decisionSnapshot?.fuelNeedScore) || 0) >= opts.lowSavingsColdStartRecoveryMinFuelNeed &&
      (Number(recommendation?.decisionSnapshot?.tripFuelIntentScore) || 0) >= opts.lowSavingsColdStartRecoveryMinTripFuelIntentScore &&
      Math.max(
        0,
        (Number(recommendation?.decisionSnapshot?.tripFuelIntentScore) || 0) -
        (Number(recommendation?.decisionSnapshot?.tripFuelIntentThreshold) || 0)
      ) >= opts.lowSavingsColdStartRecoveryMinTripFuelIntentSurplus
    );
    const noHistoryHighFuelSingleCandidatePendingCarrySupport = Boolean(
      getTotalHistoryVisits() === 0 &&
      recommendation?.type === 'cold_start_best_value' &&
      (Number(recommendation?.decisionSnapshot?.candidateCount) || 0) === 1 &&
      (Number(recommendation?.decisionSnapshot?.fuelNeedScore) || 0) >= opts.highFuelSingleCandidateLowSavingsRecoveryMinFuelNeed &&
      (Number(recommendation?.decisionSnapshot?.tripFuelIntentScore) || 0) >= opts.highFuelSingleCandidateLowSavingsRecoveryMinTripFuelIntentScore &&
      Math.max(
        0,
        (Number(recommendation?.decisionSnapshot?.tripFuelIntentScore) || 0) -
        (Number(recommendation?.decisionSnapshot?.tripFuelIntentThreshold) || 0)
      ) >= opts.highFuelSingleCandidateLowSavingsRecoveryMinTripFuelIntentSurplus
    );
    const carryPatternEligible = (
      (
        recommendation?.type === 'predicted_stop' &&
        (
          pendingCarryReason === 'Predicted stop (observed corridor capture)' ||
          pendingCarryReason === 'Predicted stop (late observed corridor recovery)' ||
          pendingCarryReason === 'Predicted stop (stable corridor match)'
        )
      ) ||
      noHistorySingleCandidatePendingCarrySupport ||
      noHistoryHighFuelSingleCandidatePendingCarrySupport
    );
    const {
      currentCandidate,
      candidate,
    } = carryPatternEligible
      ? buildPendingCarryCandidate(snapshot, recommendation)
      : {
        currentCandidate: findMatchingDecisionCandidate(snapshot, recommendation),
        candidate: findMatchingDecisionCandidate(snapshot, recommendation),
      };
    if (!candidate) {
      return { allow: false, reason: 'candidate_missing', candidate: null };
    }
    if (
      Number.isFinite(Number(candidate.alongTrack)) &&
      Number(candidate.alongTrack) < minReleaseDistanceMeters
    ) {
      return { allow: false, reason: 'candidate_too_near', candidate };
    }
    const snapshotTripFuelIntentScore = (
      snapshot && snapshot.tripFuelIntentScore != null
        ? Number(snapshot.tripFuelIntentScore)
        : Number(recommendation?.decisionSnapshot?.tripFuelIntentScore)
    ) || 0;
    const snapshotTripFuelIntentThreshold = (
      snapshot && snapshot.tripFuelIntentThreshold != null
        ? Number(snapshot.tripFuelIntentThreshold)
        : Number(recommendation?.decisionSnapshot?.tripFuelIntentThreshold)
    ) || 0;
    const snapshotFuelNeedScore = (
      snapshot && snapshot.fuelNeedScore != null
        ? Number(snapshot.fuelNeedScore)
        : (
          Number(recommendation?.fuelNeedScore) ||
          Number(recommendation?.decisionSnapshot?.fuelNeedScore)
        )
    ) || 0;
    const liveIntentSatisfied = (
      snapshotTripFuelIntentScore >= (snapshotTripFuelIntentThreshold + 0.02) ||
      snapshotFuelNeedScore >= opts.fuelNeedMediumThreshold
    );
    if (!liveIntentSatisfied) {
      return { allow: false, reason: 'live_intent_too_low', candidate };
    }
    const observedOrHabitSupport = Math.max(
      Number(candidate.observedBehaviorStrength) || 0,
      Number(candidate.routeHabitShare) || 0,
      Number(candidate.contextualObservedConversionRate) || 0,
      Number(candidate.observedConversionRate) || 0,
      Number(candidate.historyStrength) || 0,
    );
    const currentSpecificitySupport = (
      snapshot?.predictedDefaultStationId === recommendation.stationId ||
      (candidate.intentRank === 1 && (Number(candidate.intentEvidence) || 0) >= 0.42) ||
      (candidate.destinationRank === 1 && (Number(candidate.effectiveDestinationProbability) || 0) >= 0.16) ||
      observedOrHabitSupport >= 0.18
    );
    if (!currentSpecificitySupport) {
      return { allow: false, reason: 'specificity_too_low', candidate };
    }
    const observedPendingCarrySupport = Boolean(
      recommendation?.type === 'predicted_stop' &&
      typeof recommendation?.reason === 'string' &&
      recommendation.reason.startsWith('Observed routine stop ahead') &&
      (Number(candidate.visitShare) || 0) >= opts.observedPendingCarryMinVisitShare &&
      (Number(candidate.routeHabitShare) || 0) <= opts.observedPendingCarryMaxRouteHabitShare &&
      (
        (Number(candidate.contextualObservedConversionRate) || 0) >= opts.observedPendingCarryMinContextualObservedConversionRate ||
        (Number(candidate.observedConversionRate) || 0) >= opts.observedPendingCarryMinObservedConversionRate
      ) &&
      (Number(candidate.observedSkipScore) || 0) <= opts.observedPendingCarryMaxObservedSkip &&
      (Number(candidate.alongTrack) || 0) <= opts.observedPendingCarryMaxDistanceMeters &&
      snapshotTripFuelIntentScore >= 0.50
    );
    const stableLearnedCorridorPendingCarrySupport = Boolean(
      recommendation?.type === 'predicted_stop' &&
      recommendation?.reason === 'Predicted stop (stable corridor match)' &&
      (Number(candidate.visitShare) || 0) >= opts.stableLearnedCorridorMinVisitShare &&
      (Number(candidate.routeHabitShare) || 0) >= opts.stableLearnedCorridorMinRouteHabitShare &&
      (Number(candidate.observedBehaviorStrength) || 0) >= opts.stableLearnedCorridorMinObservedBehaviorStrength &&
      (
        (Number(candidate.contextualObservedConversionRate) || 0) >= opts.stableLearnedCorridorMinContextualObservedConversionRate ||
        (Number(candidate.observedConversionRate) || 0) >= opts.stableLearnedCorridorMinObservedConversionRate
      ) &&
      (Number(candidate.alongTrack) || 0) <= opts.stableLearnedCorridorMaxDistanceMeters &&
      snapshotTripFuelIntentScore >= (snapshotTripFuelIntentThreshold + opts.stableLearnedCorridorMinTripFuelIntentSurplus)
    );
    const highFuelObservedPendingCarrySupport = Boolean(
      recommendation?.type === 'predicted_stop' &&
      (Number(snapshot?.candidateCount) || 0) <= opts.highFuelObservedLowSpecificityMaxCandidateCount &&
      snapshotFuelNeedScore >= opts.highFuelObservedLowSpecificityMinFuelNeed &&
      snapshotTripFuelIntentScore >= opts.highFuelObservedLowSpecificityMinTripFuelIntentScore &&
      (Number(candidate.visitShare) || 0) >= opts.highFuelObservedLowSpecificityMinVisitShare &&
      (
        (Number(candidate.contextualObservedConversionRate) || 0) >= opts.highFuelObservedLowSpecificityMinContextualObservedConversionRate ||
        (Number(candidate.observedConversionRate) || 0) >= opts.highFuelObservedLowSpecificityMinObservedConversionRate
      ) &&
      (Number(candidate.intentEvidence) || 0) >= opts.highFuelObservedLowSpecificityMinIntentEvidence &&
      (Number(candidate.effectiveDestinationProbability) || 0) >= opts.highFuelObservedLowSpecificityMinEffectiveProbability &&
      (Number(candidate.observedSkipScore) || 0) <= opts.highFuelObservedLowSpecificityMaxObservedSkip &&
      (Number(candidate.alongTrack) || 0) <= opts.highFuelObservedLowSpecificityMaxDistanceMeters
    );
    const observedCorridorPendingCarrySupport = Boolean(
      recommendation?.type === 'predicted_stop' &&
      recommendation?.reason === 'Predicted stop (observed corridor capture)' &&
      (Number(snapshot?.candidateCount) || 0) <= opts.observedCorridorCaptureMaxCandidateCount &&
      snapshotTripFuelIntentScore >= opts.observedCorridorCaptureMinTripFuelIntentScore &&
      (Number(candidate.intentEvidence) || 0) >= opts.observedCorridorCaptureMinIntentEvidence &&
      (Number(candidate.effectiveDestinationProbability) || 0) >= opts.observedCorridorCaptureMinEffectiveProbability &&
      (Number(candidate.visitShare) || 0) >= opts.observedCorridorCaptureMinVisitShare &&
      (
        (Number(candidate.contextualObservedConversionRate) || 0) >= opts.observedCorridorCaptureMinContextualObservedConversionRate ||
        (Number(candidate.observedConversionRate) || 0) >= opts.observedCorridorCaptureMinObservedConversionRate
      ) &&
      (Number(candidate.observedSkipScore) || 0) <= opts.smallCandidateObservedRoutineMaxObservedSkip &&
      (Number(candidate.alongTrack) || 0) <= opts.observedCorridorCaptureMaxDistanceMeters
    );
    const lateObservedCorridorPendingCarrySupport = Boolean(
      recommendation?.type === 'predicted_stop' &&
      recommendation?.reason === 'Predicted stop (late observed corridor recovery)' &&
      (Number(snapshot?.candidateCount) || 0) <= opts.lateObservedCorridorRecoveryMaxCandidateCount &&
      snapshotFuelNeedScore >= opts.lateObservedCorridorRecoveryMinFuelNeed &&
      (snapshotTripFuelIntentScore - snapshotTripFuelIntentThreshold) >= opts.lateObservedCorridorRecoveryMinTripFuelIntentSurplus &&
      (Number(candidate.intentEvidence) || 0) >= opts.lateObservedCorridorPendingCarryMinIntentEvidence &&
      (Number(candidate.effectiveDestinationProbability) || 0) >= opts.lateObservedCorridorPendingCarryMinEffectiveProbability &&
      (
        (Number(candidate.contextualObservedConversionRate) || 0) >= opts.lateObservedCorridorPendingCarryMinContextualObservedConversionRate ||
        (Number(candidate.observedConversionRate) || 0) >= opts.lateObservedCorridorPendingCarryMinObservedConversionRate
      ) &&
      (
        (Number(candidate.visitShare) || 0) >= opts.lateObservedCorridorPendingCarryMinVisitShare ||
        (Number(candidate.routeHabitShare) || 0) >= opts.lateObservedCorridorPendingCarryMinRouteHabitShare ||
        (Number(candidate.routeObservedSupport) || 0) >= opts.lateObservedCorridorPendingCarryMinRouteObservedSupport
      ) &&
      (Number(candidate.observedSkipScore) || 0) <= opts.lateObservedCorridorPendingCarryMaxObservedSkip &&
      (Number(candidate.alongTrack) || 0) <= opts.lateObservedCorridorRecoveryMaxDistanceMeters
    );
    if (
      snapshot?.lowSpecificityColdStart &&
      (Number(candidate.routeHabitShare) || 0) < opts.routeHabitLowSpecificityMinShare &&
      observedOrHabitSupport < 0.22 &&
      !observedPendingCarrySupport &&
      !stableLearnedCorridorPendingCarrySupport &&
      !highFuelObservedPendingCarrySupport &&
      !observedCorridorPendingCarrySupport &&
      !lateObservedCorridorPendingCarrySupport &&
      !noHistorySingleCandidatePendingCarrySupport &&
      !noHistoryHighFuelSingleCandidatePendingCarrySupport
    ) {
      return { allow: false, reason: 'low_specificity_snapshot', candidate };
    }
    if (
      (Number(candidate.observedSkipScore) || 0) > opts.smallCandidateObservedRoutineMaxObservedSkip &&
      !stableLearnedCorridorPendingCarrySupport &&
      !lateObservedCorridorPendingCarrySupport
    ) {
      return { allow: false, reason: 'observed_skip_too_high', candidate };
    }
    if (
      !currentCandidate &&
      carryPatternEligible &&
      !noHistorySingleCandidatePendingCarrySupport &&
      !noHistoryHighFuelSingleCandidatePendingCarrySupport &&
      !observedCorridorPendingCarrySupport &&
      !lateObservedCorridorPendingCarrySupport &&
      !stableLearnedCorridorPendingCarrySupport
    ) {
      return { allow: false, reason: 'candidate_missing', candidate: null };
    }
    return { allow: true, reason: 'supported', candidate };
  }

  function pushLocation(sample, extraContext = {}) {
    window.push(sample);
    const windowCap = opts.windowCap || 20;
    if (window.length > windowCap) window = window.slice(window.length - windowCap);
    updateFuelState(sample);

    const nowMs = sample.timestamp || Date.now();
    const traceEvaluationFields = {
      routeId: extraContext.routeId || null,
      routeSampleIndex: Number.isInteger(extraContext.routeSampleIndex) ? extraContext.routeSampleIndex : null,
      routeSampleCount: Number.isInteger(extraContext.routeSampleCount) ? extraContext.routeSampleCount : null,
      routeProgress: Number.isFinite(Number(extraContext.routeProgress)) ? Number(extraContext.routeProgress) : null,
    };
    latestSuppression = null;
    const releasePendingRecommendation = () => {
      if (!enforcePresentationTiming || !pendingRecommendation) {
        return null;
      }
      const pendingAgeMs = Math.max(0, nowMs - (pendingRecommendation.pendingSince || nowMs));
      if (pendingAgeMs > opts.pendingRecommendationMaxAgeMs) {
        pendingRecommendation = null;
        return null;
      }
      const tripDistanceDeltaMeters = Math.max(
        0,
        tripDistanceMeters - (pendingRecommendation.pendingTripDistanceMeters || tripDistanceMeters)
      );
      const pendingSelectedCandidate = Array.isArray(pendingRecommendation?.decisionSnapshot?.candidates)
        ? pendingRecommendation.decisionSnapshot.candidates.find(candidate => candidate?.selected)
        : null;
      const strongObservedPendingPattern = Boolean(
        pendingRecommendation?.type === 'predicted_stop' &&
        pendingSelectedCandidate &&
        (pendingSelectedCandidate.visitShare || 0) >= opts.strongObservedRoutineMinVisitShare &&
        (pendingSelectedCandidate.observedSkipScore || 0) <= opts.strongObservedRoutineMaxObservedSkip &&
        (
          (pendingSelectedCandidate.contextualObservedConversionRate || 0) >= opts.strongObservedRoutineMinContextualObservedConversionRate ||
          (pendingSelectedCandidate.observedConversionRate || 0) >= opts.strongObservedRoutineMinObservedConversionRate
        )
      );
      const observedPendingCarryPattern = Boolean(
        pendingRecommendation?.type === 'predicted_stop' &&
        typeof pendingRecommendation?.reason === 'string' &&
        pendingRecommendation.reason.startsWith('Observed routine stop ahead') &&
        pendingSelectedCandidate &&
        (pendingSelectedCandidate.visitShare || 0) >= opts.observedPendingCarryMinVisitShare &&
        (pendingSelectedCandidate.routeHabitShare || 0) <= opts.observedPendingCarryMaxRouteHabitShare &&
        (
          (pendingSelectedCandidate.contextualObservedConversionRate || 0) >= opts.observedPendingCarryMinContextualObservedConversionRate ||
          (pendingSelectedCandidate.observedConversionRate || 0) >= opts.observedPendingCarryMinObservedConversionRate
        ) &&
        (pendingSelectedCandidate.observedSkipScore || 0) <= opts.observedPendingCarryMaxObservedSkip &&
        (pendingSelectedCandidate.alongTrack || 0) <= opts.observedPendingCarryMaxDistanceMeters
      );
      const stableLearnedCorridorPendingCarryPattern = Boolean(
        pendingRecommendation?.type === 'predicted_stop' &&
        pendingRecommendation?.reason === 'Predicted stop (stable corridor match)' &&
        pendingSelectedCandidate &&
        (Number(pendingSelectedCandidate.visitShare) || 0) >= opts.stableLearnedCorridorMinVisitShare &&
        (Number(pendingSelectedCandidate.routeHabitShare) || 0) >= opts.stableLearnedCorridorMinRouteHabitShare &&
        (Number(pendingSelectedCandidate.observedBehaviorStrength) || 0) >= opts.stableLearnedCorridorMinObservedBehaviorStrength &&
        (
          (Number(pendingSelectedCandidate.contextualObservedConversionRate) || 0) >= opts.stableLearnedCorridorMinContextualObservedConversionRate ||
          (Number(pendingSelectedCandidate.observedConversionRate) || 0) >= opts.stableLearnedCorridorMinObservedConversionRate
        ) &&
        (Number(pendingSelectedCandidate.alongTrack) || 0) <= opts.stableLearnedCorridorMaxDistanceMeters
      );
      const highFuelObservedPendingCarryPattern = Boolean(
        pendingRecommendation?.type === 'predicted_stop' &&
        pendingSelectedCandidate &&
        (Number(pendingRecommendation?.decisionSnapshot?.candidateCount) || 0) <= opts.highFuelObservedLowSpecificityMaxCandidateCount &&
        (Number(pendingRecommendation?.fuelNeedScore) || 0) >= opts.highFuelObservedLowSpecificityMinFuelNeed &&
        (Number(pendingSelectedCandidate.visitShare) || 0) >= opts.highFuelObservedLowSpecificityMinVisitShare &&
        (
          (Number(pendingSelectedCandidate.contextualObservedConversionRate) || 0) >= opts.highFuelObservedLowSpecificityMinContextualObservedConversionRate ||
          (Number(pendingSelectedCandidate.observedConversionRate) || 0) >= opts.highFuelObservedLowSpecificityMinObservedConversionRate
        ) &&
        (Number(pendingSelectedCandidate.intentEvidence) || 0) >= opts.highFuelObservedLowSpecificityMinIntentEvidence &&
        (Number(pendingSelectedCandidate.effectiveDestinationProbability) || 0) >= opts.highFuelObservedLowSpecificityMinEffectiveProbability &&
        (Number(pendingSelectedCandidate.observedSkipScore) || 0) <= opts.highFuelObservedLowSpecificityMaxObservedSkip &&
        (Number(pendingSelectedCandidate.alongTrack) || 0) <= opts.highFuelObservedLowSpecificityMaxDistanceMeters
      );
      const observedCorridorPendingCarryPattern = Boolean(
        pendingRecommendation?.type === 'predicted_stop' &&
        pendingRecommendation?.reason === 'Predicted stop (observed corridor capture)' &&
        pendingSelectedCandidate &&
        (Number(pendingRecommendation?.decisionSnapshot?.candidateCount) || 0) <= opts.observedCorridorCaptureMaxCandidateCount &&
        (Number(pendingSelectedCandidate.visitShare) || 0) >= opts.observedCorridorCaptureMinVisitShare &&
        (
          (Number(pendingSelectedCandidate.contextualObservedConversionRate) || 0) >= opts.observedCorridorCaptureMinContextualObservedConversionRate ||
          (Number(pendingSelectedCandidate.observedConversionRate) || 0) >= opts.observedCorridorCaptureMinObservedConversionRate
        ) &&
        (Number(pendingSelectedCandidate.intentEvidence) || 0) >= opts.observedCorridorCaptureMinIntentEvidence &&
        (Number(pendingSelectedCandidate.effectiveDestinationProbability) || 0) >= opts.observedCorridorCaptureMinEffectiveProbability &&
        (Number(pendingSelectedCandidate.observedSkipScore) || 0) <= opts.smallCandidateObservedRoutineMaxObservedSkip &&
        (Number(pendingSelectedCandidate.alongTrack) || 0) <= opts.observedCorridorCaptureMaxDistanceMeters
      );
      const lateObservedCorridorPendingCarryPattern = Boolean(
        pendingRecommendation?.type === 'predicted_stop' &&
        pendingRecommendation?.reason === 'Predicted stop (late observed corridor recovery)' &&
        pendingSelectedCandidate &&
        (Number(pendingRecommendation?.decisionSnapshot?.candidateCount) || 0) <= opts.lateObservedCorridorRecoveryMaxCandidateCount &&
        (Number(pendingRecommendation?.fuelNeedScore) || 0) >= opts.lateObservedCorridorRecoveryMinFuelNeed &&
        (Number(pendingSelectedCandidate.intentEvidence) || 0) >= opts.lateObservedCorridorRecoveryMinIntentEvidence &&
        (
          (Number(pendingSelectedCandidate.visitShare) || 0) >= opts.lateObservedCorridorRecoveryMinVisitShare ||
          (Number(pendingSelectedCandidate.routeHabitShare) || 0) >= opts.lateObservedCorridorRecoveryMinRouteHabitShare
        ) &&
        (
          (Number(pendingSelectedCandidate.contextualObservedConversionRate) || 0) >= opts.lateObservedCorridorRecoveryMinContextualObservedConversionRate ||
          (Number(pendingSelectedCandidate.observedConversionRate) || 0) >= opts.lateObservedCorridorRecoveryMinObservedConversionRate
        ) &&
        (Number(pendingSelectedCandidate.effectiveDestinationProbability) || 0) >= opts.lateObservedCorridorRecoveryMinEffectiveProbability &&
        (Number(pendingSelectedCandidate.observedSkipScore) || 0) <= opts.lateObservedCorridorRecoveryMaxObservedSkip &&
        (Number(pendingSelectedCandidate.alongTrack) || 0) <= opts.lateObservedCorridorRecoveryMaxDistanceMeters
      );
      const routeHabitLowNeedPendingCarryPattern = Boolean(
        pendingRecommendation?.type === 'predicted_stop' &&
        pendingSelectedCandidate &&
        Number(pendingRecommendation?.decisionSnapshot?.candidateCount) >= opts.routeHabitLowNeedRecoveryMinCandidateCount &&
        Number(pendingRecommendation?.decisionSnapshot?.candidateCount) <= opts.routeHabitLowNeedRecoveryMaxCandidateCount &&
        (Number(pendingSelectedCandidate.routeHabitShare) || 0) >= opts.routeHabitLowNeedRecoveryMinRouteHabitShare &&
        (Number(pendingSelectedCandidate.visitShare) || 0) >= opts.routeHabitLowNeedRecoveryMinVisitShare &&
        (Number(pendingSelectedCandidate.contextualObservedConversionRate) || 0) >= opts.routeHabitLowNeedRecoveryMinContextualObservedConversionRate &&
        (Number(pendingRecommendation?.decisionSnapshot?.tripFuelIntentScore) || 0) >= opts.routeHabitLowNeedRecoveryMinTripFuelIntentScore &&
        (Number(pendingRecommendation?.decisionSnapshot?.fuelNeedScore) || 0) <= opts.routeHabitLowNeedRecoveryMaxFuelNeed &&
        (Number(pendingSelectedCandidate.effectiveDestinationProbability) || 0) >= opts.routeHabitLowNeedRecoveryMinEffectiveProbability &&
        (Number(pendingSelectedCandidate.observedSkipScore) || 0) <= opts.routeHabitLowNeedRecoveryMaxObservedSkip
      );
      const noHistorySingleCandidatePendingCarryPattern = Boolean(
        getTotalHistoryVisits() === 0 &&
        pendingRecommendation?.type === 'cold_start_best_value' &&
        pendingSelectedCandidate &&
        (Number(pendingRecommendation?.decisionSnapshot?.candidateCount) || 0) === 1 &&
        (Number(pendingSelectedCandidate.alongTrack) || 0) <= opts.lowSavingsColdStartRecoveryMaxDistanceMeters &&
        (Number(pendingRecommendation?.decisionSnapshot?.fuelNeedScore) || 0) >= opts.lowSavingsColdStartRecoveryMinFuelNeed &&
        (Number(pendingRecommendation?.decisionSnapshot?.tripFuelIntentScore) || 0) >= opts.lowSavingsColdStartRecoveryMinTripFuelIntentScore &&
        Math.max(
          0,
          (Number(pendingRecommendation?.decisionSnapshot?.tripFuelIntentScore) || 0) -
          (Number(pendingRecommendation?.decisionSnapshot?.tripFuelIntentThreshold) || 0)
        ) >= opts.lowSavingsColdStartRecoveryMinTripFuelIntentSurplus &&
        (Number(pendingSelectedCandidate.intentEvidence) || 0) >= opts.lowSavingsColdStartRecoveryMinIntentEvidence &&
        (Number(pendingSelectedCandidate.effectiveDestinationProbability) || 0) >= opts.lowSavingsColdStartRecoveryMinEffectiveProbability &&
        (Number(pendingSelectedCandidate.observedSkipScore) || 0) <= opts.zeroSavingsColdStartRecoveryMaxObservedSkip
      );
      const noHistoryHighFuelSingleCandidatePendingCarryPattern = Boolean(
        getTotalHistoryVisits() === 0 &&
        pendingRecommendation?.type === 'cold_start_best_value' &&
        pendingSelectedCandidate &&
        (Number(pendingRecommendation?.decisionSnapshot?.candidateCount) || 0) === 1 &&
        (Number(pendingSelectedCandidate.alongTrack) || 0) <= opts.highFuelSingleCandidateLowSavingsRecoveryMaxDistanceMeters &&
        (Number(pendingRecommendation?.decisionSnapshot?.fuelNeedScore) || 0) >= opts.highFuelSingleCandidateLowSavingsRecoveryMinFuelNeed &&
        (Number(pendingRecommendation?.decisionSnapshot?.tripFuelIntentScore) || 0) >= opts.highFuelSingleCandidateLowSavingsRecoveryMinTripFuelIntentScore &&
        Math.max(
          0,
          (Number(pendingRecommendation?.decisionSnapshot?.tripFuelIntentScore) || 0) -
          (Number(pendingRecommendation?.decisionSnapshot?.tripFuelIntentThreshold) || 0)
        ) >= opts.highFuelSingleCandidateLowSavingsRecoveryMinTripFuelIntentSurplus &&
        (Number(pendingSelectedCandidate.intentEvidence) || 0) >= opts.highFuelSingleCandidateLowSavingsRecoveryMinIntentEvidence &&
        (Number(pendingSelectedCandidate.effectiveDestinationProbability) || 0) >= opts.highFuelSingleCandidateLowSavingsRecoveryMinEffectiveProbability
      );
      const minPendingReleaseDistanceMeters = strongObservedPendingPattern
        ? 0
        : opts.pendingRecommendationMinReleaseDistanceMeters;
      if (
        !strongObservedPendingPattern &&
        !observedPendingCarryPattern &&
        !stableLearnedCorridorPendingCarryPattern &&
        !highFuelObservedPendingCarryPattern &&
        !observedCorridorPendingCarryPattern &&
        !lateObservedCorridorPendingCarryPattern &&
        !routeHabitLowNeedPendingCarryPattern &&
        !noHistorySingleCandidatePendingCarryPattern &&
        !noHistoryHighFuelSingleCandidatePendingCarryPattern
      ) {
        if (typeof opts.onRecommendationEvaluation === 'function') {
          opts.onRecommendationEvaluation({
            ...traceEvaluationFields,
            recommendation: pendingRecommendation,
            sample,
            nowMs,
            streak: pendingRecommendation.streak || 0,
            requiredConsistencyCount: pendingRecommendation.requiredConsistencyCount || 0,
            historyVisitCount: getTotalHistoryVisits(),
            milesSinceLastFill,
            tripDistanceMeters,
            pendingRecommendation,
            status: 'dropped_pending_mode',
          });
        }
        pendingRecommendation = null;
        return null;
      }
      const refreshedForwardDistance = Number.isFinite(Number(pendingRecommendation.forwardDistance))
        ? Math.max(0, Number(pendingRecommendation.forwardDistance) - tripDistanceDeltaMeters)
        : pendingRecommendation.forwardDistance;
      if (
        Number.isFinite(Number(refreshedForwardDistance)) &&
        refreshedForwardDistance < minPendingReleaseDistanceMeters
      ) {
        pendingRecommendation = null;
        return null;
      }
      const pendingSupportDecision = shouldAllowPendingRelease(
        latestDecisionSnapshot,
        {
          ...pendingRecommendation,
          forwardDistance: refreshedForwardDistance,
        },
        minPendingReleaseDistanceMeters,
      );
      const allowVanishingNoHistoryPendingRelease = Boolean(
        !pendingSupportDecision.allow &&
        pendingSupportDecision.reason === 'candidate_missing' &&
        (noHistorySingleCandidatePendingCarryPattern || noHistoryHighFuelSingleCandidatePendingCarryPattern) &&
        Number.isFinite(Number(refreshedForwardDistance)) &&
        Number(refreshedForwardDistance) <= opts.noHistoryStrongSingleCandidateRecoveryMaxDistanceMeters &&
        (
          Number(pendingRecommendation?.decisionSnapshot?.tripFuelIntentScore) || 0
        ) >= opts.noHistoryStrongSingleCandidateRecoveryMinTripFuelIntentScore &&
        (
          Number(pendingRecommendation?.decisionSnapshot?.fuelNeedScore) || 0
        ) >= opts.noHistoryStrongSingleCandidateRecoveryMinFuelNeed
      );
      if (!pendingSupportDecision.allow) {
        if (allowVanishingNoHistoryPendingRelease) {
          // Fall through and release from the last strong pending snapshot before the corridor disappears.
        } else {
        if (typeof opts.onRecommendationEvaluation === 'function') {
          opts.onRecommendationEvaluation({
            ...traceEvaluationFields,
            recommendation: pendingRecommendation,
            sample,
            nowMs,
            streak: pendingRecommendation.streak || 0,
            requiredConsistencyCount: pendingRecommendation.requiredConsistencyCount || 0,
            historyVisitCount: getTotalHistoryVisits(),
            milesSinceLastFill,
            tripDistanceMeters,
            pendingRecommendation,
            status: 'dropped_pending_support',
            pendingSupportReason: pendingSupportDecision.reason,
            decisionSnapshot: latestDecisionSnapshot,
          });
        }
        pendingRecommendation = null;
        return null;
        }
      }
      const refreshedRecommendation = {
        ...pendingRecommendation,
        forwardDistance: refreshedForwardDistance,
        decisionSnapshot: latestDecisionSnapshot || pendingRecommendation.decisionSnapshot,
      };
      const pendingRecommendationGuardSuppressionReason = getRecommendationGuardSuppressionReason(refreshedRecommendation);
      if (pendingRecommendationGuardSuppressionReason) {
        if (typeof opts.onRecommendationEvaluation === 'function') {
          opts.onRecommendationEvaluation({
            ...traceEvaluationFields,
            recommendation: refreshedRecommendation,
            sample,
            nowMs,
            streak: pendingRecommendation.streak || 0,
            requiredConsistencyCount: pendingRecommendation.requiredConsistencyCount || 0,
            historyVisitCount: getTotalHistoryVisits(),
            milesSinceLastFill,
            tripDistanceMeters,
            pendingRecommendation,
            status: pendingRecommendationGuardSuppressionReason,
            decisionSnapshot: refreshedRecommendation.decisionSnapshot,
          });
        }
        pendingRecommendation = null;
        return null;
      }
      const allowNoHistoryPendingColdStartRelease = Boolean(
        refreshedRecommendation.type === 'cold_start_best_value' &&
        (
          noHistorySingleCandidatePendingCarryPattern ||
          noHistoryHighFuelSingleCandidatePendingCarryPattern
        )
      );
      const allowLateNoHistoryPendingForceRelease = Boolean(
        opts.enableNoHistoryLatePendingForceRelease &&
        allowNoHistoryPendingColdStartRelease &&
        pendingSelectedCandidate &&
        Number.isFinite(Number(refreshedForwardDistance)) &&
        Number(refreshedForwardDistance) <= opts.noHistoryLatePendingForceReleaseMaxDistanceMeters &&
        (Number(pendingRecommendation?.decisionSnapshot?.fuelNeedScore) || 0) >= opts.noHistoryLatePendingForceReleaseMinFuelNeed &&
        (Number(pendingRecommendation?.decisionSnapshot?.tripFuelIntentScore) || 0) >= opts.noHistoryLatePendingForceReleaseMinTripFuelIntentScore &&
        Math.max(
          0,
          (Number(pendingRecommendation?.decisionSnapshot?.tripFuelIntentScore) || 0) -
          (Number(pendingRecommendation?.decisionSnapshot?.tripFuelIntentThreshold) || 0)
        ) >= opts.noHistoryLatePendingForceReleaseMinTripFuelIntentSurplus &&
        (Number(pendingSelectedCandidate.intentEvidence) || 0) >= opts.noHistoryLatePendingForceReleaseMinIntentEvidence &&
        (Number(pendingSelectedCandidate.effectiveDestinationProbability) || 0) >= opts.noHistoryLatePendingForceReleaseMinEffectiveProbability
      );
      const allowLateLearnedPendingForceRelease = Boolean(
        opts.enableLearnedLatePendingForceRelease &&
        refreshedRecommendation.type === 'predicted_stop' &&
        pendingSelectedCandidate &&
        (Number(pendingRecommendation?.decisionSnapshot?.candidateCount) || 0) <= opts.learnedLatePendingForceReleaseMaxCandidateCount &&
        Number.isFinite(Number(refreshedForwardDistance)) &&
        Number(refreshedForwardDistance) <= opts.learnedLatePendingForceReleaseMaxDistanceMeters &&
        (Number(pendingRecommendation?.decisionSnapshot?.tripFuelIntentScore) || 0) >= opts.learnedLatePendingForceReleaseMinTripFuelIntentScore &&
        (Number(pendingSelectedCandidate.intentEvidence) || 0) >= opts.learnedLatePendingForceReleaseMinIntentEvidence &&
        (Number(pendingSelectedCandidate.effectiveDestinationProbability) || 0) >= opts.learnedLatePendingForceReleaseMinEffectiveProbability &&
        (Number(pendingSelectedCandidate.visitShare) || 0) >= opts.learnedLatePendingForceReleaseMinVisitShare &&
        (
          (Number(pendingSelectedCandidate.contextualObservedConversionRate) || 0) >= opts.learnedLatePendingForceReleaseMinContextualObservedConversionRate ||
          (Number(pendingSelectedCandidate.observedConversionRate) || 0) >= opts.learnedLatePendingForceReleaseMinObservedConversionRate
        ) &&
        (Number(pendingSelectedCandidate.observedSkipScore) || 0) <= opts.learnedLatePendingForceReleaseMaxObservedSkip
      );
      if (
        refreshedRecommendation.type !== 'predicted_stop' &&
        refreshedRecommendation.type !== 'history_recovery_stop' &&
        refreshedRecommendation.type !== 'cheaper_alternative' &&
        !allowNoHistoryPendingColdStartRelease
      ) {
        return null;
      }
      refreshedRecommendation.presentation = buildPresentationPlan(
        window,
        refreshedRecommendation,
        null,
        opts
      );
      const attentionState = String(refreshedRecommendation.presentation?.attentionState || '');
      const pauseWindowReady = (
        refreshedRecommendation.presentation?.surfaceNow &&
        (
          attentionState === 'traffic_light_pause' ||
          attentionState === 'stop_sign_pause'
        )
      );
      if (
        !pauseWindowReady &&
        !allowVanishingNoHistoryPendingRelease &&
        !allowLateNoHistoryPendingForceRelease &&
        !allowLateLearnedPendingForceRelease
      ) {
        return null;
      }
      const expiry = cooldowns.get(refreshedRecommendation.stationId) || 0;
      if (nowMs < expiry) {
        if (typeof opts.onRecommendationEvaluation === 'function') {
          opts.onRecommendationEvaluation({
            ...traceEvaluationFields,
            recommendation: refreshedRecommendation,
            sample,
            nowMs,
            streak: pendingRecommendation.streak || 0,
            requiredConsistencyCount: pendingRecommendation.requiredConsistencyCount || 0,
            historyVisitCount: getTotalHistoryVisits(),
            milesSinceLastFill,
            tripDistanceMeters,
            pendingRecommendation,
            status: 'blocked_cooldown',
            cooldownExpiryMs: expiry,
          });
        }
        return null;
      }
      const triggerDistance = refreshedRecommendation.forwardDistance;
      const event = {
        ...refreshedRecommendation,
        triggeredAt: nowMs,
        triggerDistance,
        location: sample,
        historyVisitCount: getTotalHistoryVisits(),
        milesSinceLastFill,
        tripDistanceMeters,
        tripDurationSeconds: Math.round(computeTripDurationMs(window) / 1000),
        meanSpeedMps: computeMeanSpeed(window),
        recommendationStreak: pendingRecommendation.streak || 0,
      };
      const pendingTriggerRoutineGuardSuppressionReason = getRoutineGuardSuppressionReason(event);
      if (pendingTriggerRoutineGuardSuppressionReason) {
        if (typeof opts.onRecommendationEvaluation === 'function') {
          opts.onRecommendationEvaluation({
            ...traceEvaluationFields,
            recommendation: refreshedRecommendation,
            sample,
            nowMs,
            streak: pendingRecommendation.streak || 0,
            requiredConsistencyCount: pendingRecommendation.requiredConsistencyCount || 0,
            historyVisitCount: getTotalHistoryVisits(),
            milesSinceLastFill,
            tripDistanceMeters,
            pendingRecommendation,
            status: pendingTriggerRoutineGuardSuppressionReason,
            event,
          });
        }
        pendingRecommendation = null;
        return null;
      }
      if (opts.mlGate && typeof opts.mlGate.evaluate === 'function') {
        const gateDecision = opts.mlGate.evaluate({
          event,
          recommendation: refreshedRecommendation,
          sample,
          window: window.slice(),
          profile,
          stations,
          milesSinceLastFill,
          tripDistanceMeters,
          historyVisitCount: event.historyVisitCount,
        }) || null;
        if (gateDecision?.allow === false) {
          if (typeof opts.onRecommendationEvaluation === 'function') {
          opts.onRecommendationEvaluation({
            ...traceEvaluationFields,
            recommendation: refreshedRecommendation,
            sample,
            nowMs,
              streak: pendingRecommendation.streak || 0,
              requiredConsistencyCount: pendingRecommendation.requiredConsistencyCount || 0,
              historyVisitCount: getTotalHistoryVisits(),
              milesSinceLastFill,
              tripDistanceMeters,
              pendingRecommendation,
              status: 'blocked_ml_gate',
              mlGateDecision: gateDecision,
            });
          }
          return null;
        }
        if (Number.isFinite(Number(gateDecision?.score))) {
          event.mlGateScore = Number(gateDecision.score);
        }
        if (typeof gateDecision?.model === 'string' && gateDecision.model) {
          event.mlGateModel = gateDecision.model;
        }
      }
      cooldowns.set(refreshedRecommendation.stationId, nowMs + opts.cooldownMs);
      firedEvents.push(event);
      if (typeof opts.onRecommendationEvaluation === 'function') {
          opts.onRecommendationEvaluation({
            ...traceEvaluationFields,
            recommendation: refreshedRecommendation,
            sample,
            nowMs,
          streak: pendingRecommendation.streak || 0,
          requiredConsistencyCount: pendingRecommendation.requiredConsistencyCount || 0,
          historyVisitCount: getTotalHistoryVisits(),
          milesSinceLastFill,
          tripDistanceMeters,
          pendingRecommendation,
          status: 'triggered_pending_release',
          event,
        });
      }
      pendingRecommendation = null;
      recommendationCandidate = null;
      if (typeof opts.onTrigger === 'function') {
        opts.onTrigger(event);
      }
      return event;
    };
    const recommendation = recommend(window, profile, stations, {
      ...opts,
      onDecisionSnapshot: snapshot => {
        latestDecisionSnapshot = snapshot;
        if (typeof opts.onDecisionSnapshot === 'function') {
          opts.onDecisionSnapshot(snapshot);
        }
      },
      onRecommendationSuppressed: suppression => {
        latestSuppression = suppression || null;
        updateLearnedSuppressionAccumulator(latestSuppression);
        if (typeof opts.onRecommendationSuppressed === 'function') {
          opts.onRecommendationSuppressed(suppression);
        }
      },
      milesSinceLastFill,
      tripDistanceMeters,
      ...extraContext,
    });
    updateLearnedCommitmentAccumulator(latestDecisionSnapshot, nowMs);
    const accumulatedRecommendation = recommendation ||
      buildSuppressionAccumulatedRecommendation() ||
      buildAccumulatedLearnedRecommendation(latestDecisionSnapshot);
    const effectiveRecommendation = accumulatedRecommendation;
    if (!effectiveRecommendation) {
      const candidateAgeMs = recommendationCandidate
        ? Math.max(0, nowMs - (recommendationCandidate.lastSeenAt || nowMs))
        : Number.POSITIVE_INFINITY;
      const allowConsistencyGap = Boolean(
        recommendationCandidate &&
        recommendationCandidate.recommendation?.type === 'predicted_stop' &&
        candidateAgeMs <= opts.consistencyGapToleranceMs
      );
      if (!allowConsistencyGap) {
        recommendationCandidate = null;
      }
      return releasePendingRecommendation();
    }

    const recommendationGuardSuppressionReason =
      getRecommendationGuardSuppressionReason(effectiveRecommendation);
    if (recommendationGuardSuppressionReason) {
      if (typeof opts.onRecommendationEvaluation === 'function') {
        opts.onRecommendationEvaluation({
          recommendation: effectiveRecommendation,
          sample,
          nowMs,
          ...traceEvaluationFields,
          historyVisitCount: getTotalHistoryVisits(),
          milesSinceLastFill,
          tripDistanceMeters,
          pendingRecommendation,
          status: recommendationGuardSuppressionReason,
        });
      }
      recommendationCandidate = null;
      return releasePendingRecommendation();
    }

    const consistencyKey = `${effectiveRecommendation.stationId}:${effectiveRecommendation.type}`;
    if (recommendationCandidate?.key === consistencyKey) {
      recommendationCandidate = {
        ...recommendationCandidate,
        streak: recommendationCandidate.streak + 1,
        lastSeenAt: nowMs,
        recommendation: effectiveRecommendation,
      };
    } else {
      recommendationCandidate = {
        key: consistencyKey,
        streak: 1,
        firstSeenAt: nowMs,
        lastSeenAt: nowMs,
        recommendation: effectiveRecommendation,
      };
    }
    const commitmentBoost = getLearnedCommitmentBoost(latestDecisionSnapshot, effectiveRecommendation);
    const requiredConsistencyCount = getRequiredConsistencyCount(effectiveRecommendation);
    const effectiveRequiredConsistencyCount = commitmentBoost &&
      commitmentBoost.score >= opts.learnedCommitmentAccumulatorReduceConsistencyMinScore &&
      commitmentBoost.margin >= opts.learnedCommitmentAccumulatorReduceConsistencyMinMargin &&
      commitmentBoost.visibleSamples >= opts.learnedCommitmentAccumulatorMinVisibleSamples &&
      commitmentBoost.persistenceSamples >= opts.learnedCommitmentAccumulatorMinPersistenceSamples
      ? Math.max(1, requiredConsistencyCount - opts.learnedCommitmentAccumulatorReduceConsistencyBy)
      : requiredConsistencyCount;
    const baseEvaluation = {
      recommendation: effectiveRecommendation,
      sample,
      nowMs,
      ...traceEvaluationFields,
      streak: recommendationCandidate.streak,
      requiredConsistencyCount: effectiveRequiredConsistencyCount,
      historyVisitCount: getTotalHistoryVisits(),
      milesSinceLastFill,
      tripDistanceMeters,
      pendingRecommendation,
      commitmentAccumulator: commitmentBoost,
    };

    if (recommendationCandidate.streak < effectiveRequiredConsistencyCount) {
      if (typeof opts.onRecommendationEvaluation === 'function') {
        opts.onRecommendationEvaluation({
          ...baseEvaluation,
          status: 'blocked_consistency',
        });
      }
      return null;
    }

    const allowRouteHabitLowNeedImmediateRelease = isRouteHabitLowNeedRecoveryRecommendation(effectiveRecommendation);
    if (
      enforcePresentationTiming &&
      !effectiveRecommendation.presentation?.surfaceNow &&
      !allowRouteHabitLowNeedImmediateRelease
    ) {
      const preserveExistingPendingRecommendation = Boolean(
        pendingRecommendation?.stationId === effectiveRecommendation.stationId &&
        pendingRecommendation?.type &&
        pendingRecommendation.type !== 'cold_start_best_value' &&
        effectiveRecommendation.type === 'cold_start_best_value'
      );
      const pendingPayload = preserveExistingPendingRecommendation
        ? {
          ...effectiveRecommendation,
          type: pendingRecommendation.type,
          reason: pendingRecommendation.reason,
          confidence: Math.max(
            Number(pendingRecommendation.confidence) || 0,
            Number(effectiveRecommendation.confidence) || 0
          ),
        }
        : effectiveRecommendation;
      pendingRecommendation = {
        ...pendingPayload,
        pendingSince: pendingRecommendation?.stationId === effectiveRecommendation.stationId
          ? pendingRecommendation.pendingSince
          : nowMs,
        pendingTripDistanceMeters: tripDistanceMeters,
        streak: preserveExistingPendingRecommendation
          ? Math.max(
            pendingRecommendation?.streak || 0,
            recommendationCandidate.streak
          )
          : recommendationCandidate.streak,
        requiredConsistencyCount: preserveExistingPendingRecommendation
          ? Math.min(
            pendingRecommendation?.requiredConsistencyCount || effectiveRequiredConsistencyCount,
            effectiveRequiredConsistencyCount
          )
          : effectiveRequiredConsistencyCount,
      };
      if (typeof opts.onRecommendationEvaluation === 'function') {
        opts.onRecommendationEvaluation({
          ...baseEvaluation,
          pendingRecommendation,
          status: 'deferred_presentation',
        });
      }
      return null;
    }

    const expiry = cooldowns.get(effectiveRecommendation.stationId) || 0;
    if (nowMs < expiry) {
      if (typeof opts.onRecommendationEvaluation === 'function') {
        opts.onRecommendationEvaluation({
          ...baseEvaluation,
          status: 'blocked_cooldown',
          cooldownExpiryMs: expiry,
        });
      }
      return null;
    }
    const triggerDistance = effectiveRecommendation.forwardDistance;
    const event = {
      ...effectiveRecommendation,
      triggeredAt: nowMs,
      triggerDistance,
      location: sample,
      historyVisitCount: getTotalHistoryVisits(),
      milesSinceLastFill,
      tripDistanceMeters,
      tripDurationSeconds: Math.round(computeTripDurationMs(window) / 1000),
      meanSpeedMps: computeMeanSpeed(window),
      recommendationStreak: recommendationCandidate.streak,
    };
    const triggerRecommendationGuardSuppressionReason =
      getRecommendationGuardSuppressionReason(event);
    if (triggerRecommendationGuardSuppressionReason) {
      if (typeof opts.onRecommendationEvaluation === 'function') {
        opts.onRecommendationEvaluation({
          ...baseEvaluation,
          status: triggerRecommendationGuardSuppressionReason,
          event,
        });
      }
      return null;
    }
    if (opts.mlGate && typeof opts.mlGate.evaluate === 'function') {
      const gateDecision = opts.mlGate.evaluate({
        event,
        recommendation: effectiveRecommendation,
        sample,
        window: window.slice(),
        profile,
        stations,
        milesSinceLastFill,
        tripDistanceMeters,
        historyVisitCount: event.historyVisitCount,
      }) || null;
      if (gateDecision?.allow === false) {
        if (typeof opts.onRecommendationEvaluation === 'function') {
          opts.onRecommendationEvaluation({
            ...baseEvaluation,
            status: 'blocked_ml_gate',
            mlGateDecision: gateDecision,
          });
        }
        return null;
      }
      if (Number.isFinite(Number(gateDecision?.score))) {
        event.mlGateScore = Number(gateDecision.score);
      }
      if (typeof gateDecision?.model === 'string' && gateDecision.model) {
        event.mlGateModel = gateDecision.model;
      }
    }
    cooldowns.set(effectiveRecommendation.stationId, nowMs + opts.cooldownMs);
    firedEvents.push(event);
    pendingRecommendation = null;
    recommendationCandidate = null;
    if (typeof opts.onRecommendationEvaluation === 'function') {
      opts.onRecommendationEvaluation({
        ...baseEvaluation,
        status: 'triggered',
        event,
      });
    }
    if (typeof opts.onTrigger === 'function') {
      opts.onTrigger(event);
    }
    return event;
  }

  return {
    setStations(s) {
      stations = s || [];
      latestDecisionSnapshot = null;
    },
    setProfile(p) {
      profile = p;
      milesSinceLastFill = initializeFuelStateFromProfile(profile);
      tripDistanceMeters = 0;
      latestSuppression = null;
      learnedCommitmentStates.clear();
      noOfferCommitment = 0;
      resetLearnedSuppressionAccumulator();
    },
    pushLocation,
    reset() {
      window = [];
      lastSample = null;
      milesSinceLastFill = initializeFuelStateFromProfile(profile);
      tripDistanceMeters = 0;
      cooldowns.clear();
      firedEvents.length = 0;
      pendingRecommendation = null;
      recommendationCandidate = null;
      latestDecisionSnapshot = null;
      latestSuppression = null;
      learnedCommitmentStates.clear();
      noOfferCommitment = 0;
      resetLearnedSuppressionAccumulator();
    },
    getEvents() { return firedEvents.slice(); },
    getWindow() { return window.slice(); },
    getPendingRecommendation() { return pendingRecommendation ? { ...pendingRecommendation } : null; },
    getLearnedCommitmentStates() {
      return Array.from(learnedCommitmentStates.entries()).map(([stationId, state]) => ({
        stationId,
        ...state,
      }));
    },
    getDebugState() {
      return {
        latestDecisionSnapshot,
        latestSuppression,
        learnedSuppressionAccumulator: learnedSuppressionAccumulator
          ? { ...learnedSuppressionAccumulator }
          : null,
      };
    },
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
