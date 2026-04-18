const { createPredictiveRecommender, DEFAULT_OPTIONS: RECOMMENDER_DEFAULT_OPTIONS } = require('./predictiveRecommender.js');
const { simulateRealisticCohortBatch } = require('./fuelerSimulation.js');
const { normalizePredictiveFuelingProfile } = require('./predictiveFuelingProfileStore.js');

const DEFAULT_HISTORY_LEVELS = ['none', 'light', 'rich'];
const DEFAULT_CALIBRATION_BINS = [
  { label: '0.0-0.2', min: 0.0, max: 0.2 },
  { label: '0.2-0.4', min: 0.2, max: 0.4 },
  { label: '0.4-0.6', min: 0.4, max: 0.6 },
  { label: '0.6-0.8', min: 0.6, max: 0.8 },
  { label: '0.8-1.0', min: 0.8, max: 1.01 },
];

const DEFAULT_PRODUCTION_THRESHOLDS = Object.freeze({
  broadSweep: {
    wrongStationRateP90Max: 1,
    wrongStationRateMeanMax: 0.5,
    falsePositiveRateP90Max: 5,
    falsePositiveRateMeanMax: 3,
  },
  recallByHistory: {
    none: { p10Min: 20, medianMin: 35 },
    light: { p10Min: 35, medianMin: 50 },
    rich: { p10Min: 50, medianMin: 65 },
  },
  precisionByHistory: {
    none: { meanMin: 35, p10Min: 20 },
    light: { meanMin: 45, p10Min: 30 },
    rich: { meanMin: 60, p10Min: 45 },
  },
  calibration: {
    expectedCalibrationErrorMeanMax: 8,
    expectedCalibrationErrorP90Max: 12,
    topConfidenceBinActualCorrectnessMin: 90,
  },
  promptDisciplineByHistory: {
    none: { min: 4, max: 10 },
    light: { min: 5, max: 12 },
    rich: { min: 6, max: 14 },
  },
  promptDiscipline: {
    promptsPerUserWeekMedianMax: 3,
    promptsPerUserWeekP90Max: 6,
    backToBackPromptRateMaxExclusive: 1,
    repeatPromptAfterIgnoreShortHorizonRateMax: 5,
  },
  savingsQuality: {
    visibleOracleRegretMeanMax: 10,
    visibleOracleRegretP90Max: 20,
    meaningfulSavingsPromptShareMin: 70,
    missedHighValueOpportunityRate: {
      light: 20,
      rich: 10,
    },
  },
  adversarial: {
    stale_prices: { wrongStationRateP90Max: 3, falsePositiveRateP90Max: 6, recallP10Min: 15 },
    missing_cheapest_station: { wrongStationRateP90Max: 5, falsePositiveRateP90Max: 6, recallP10Min: 15 },
    route_snap_noise: { wrongStationRateP90Max: 3, falsePositiveRateP90Max: 6, recallP10Min: 15 },
    market_churn: { wrongStationRateP90Max: 5, falsePositiveRateP90Max: 6, recallP10Min: 15 },
  },
  persistenceSafety: {
    corruptProfileNormalizationCrashRateMax: 0,
    postNormalizationOutOfBoundsFieldRateMax: 0,
    postNormalizationWrongStationRateIncreaseMax: 1,
    resetRelearnRecallRecoveryLightMin: 90,
    resetRelearnRecallRecoveryRichMin: 90,
  },
  stability: {
    cleanSweepUnitWrongStationRateMax: 3,
    cleanSweepUnitFalsePositiveRateMax: 8,
    recallP10VsMedianRatioMin: 0.5,
  },
});

const SHORT_HORIZON_REPEAT_PROMPT_MS = 60 * 1000;
const MEANINGFUL_SAVINGS_PER_GAL = Number(RECOMMENDER_DEFAULT_OPTIONS.minPriceSavingsPerGal) || 0.08;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 2) {
  if (!Number.isFinite(Number(value))) return null;
  const scale = 10 ** digits;
  return Math.round(Number(value) * scale) / scale;
}

function average(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sum(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  return values.reduce((accumulator, value) => accumulator + (Number(value) || 0), 0);
}

function percentile(values, percentileRank) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 1) return sorted[0];
  const clampedRank = clamp(percentileRank, 0, 1);
  const index = (sorted.length - 1) * clampedRank;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const weight = index - lower;
  return sorted[lower] + ((sorted[upper] - sorted[lower]) * weight);
}

function summarizeSeries(values) {
  const finiteValues = (Array.isArray(values) ? values : [])
    .map(value => Number(value))
    .filter(value => Number.isFinite(value));
  if (!finiteValues.length) {
    return {
      count: 0,
      min: null,
      max: null,
      mean: null,
      median: null,
      p10: null,
      p90: null,
    };
  }
  return {
    count: finiteValues.length,
    min: round(Math.min(...finiteValues)),
    max: round(Math.max(...finiteValues)),
    mean: round(average(finiteValues)),
    median: round(percentile(finiteValues, 0.5)),
    p10: round(percentile(finiteValues, 0.10)),
    p90: round(percentile(finiteValues, 0.90)),
  };
}

function hashString(value) {
  const text = String(value || '');
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function cloneStation(station) {
  return station ? { ...station } : station;
}

function findConfidenceBin(confidence, bins) {
  const numericConfidence = clamp(Number(confidence) || 0, 0, 1);
  return bins.find(bin => numericConfidence >= bin.min && numericConfidence < bin.max) || bins[bins.length - 1];
}

function createCalibrationBins(routes, bins = DEFAULT_CALIBRATION_BINS) {
  const binMap = Object.fromEntries(
    bins.map(bin => [bin.label, {
      label: bin.label,
      min: bin.min,
      max: bin.max,
      count: 0,
      avgConfidence: 0,
      correctnessRate: 0,
      gap: 0,
    }])
  );
  let surfacedCount = 0;
  let totalWeightedGap = 0;

  for (const route of routes || []) {
    if (!route?.triggered || !Array.isArray(route.routeEvents) || route.routeEvents.length === 0) continue;
    const firstEvent = route.routeEvents[0];
    const bin = findConfidenceBin(firstEvent.confidence, bins);
    const entry = binMap[bin.label];
    entry.count += 1;
    entry.avgConfidence += clamp(Number(firstEvent.confidence) || 0, 0, 1);
    entry.correctnessRate += route.firstTriggerCorrect ? 1 : 0;
    surfacedCount += 1;
  }

  const normalizedBins = bins.map(bin => {
    const entry = binMap[bin.label];
    if (entry.count > 0) {
      entry.avgConfidence = round((entry.avgConfidence / entry.count) * 100);
      entry.correctnessRate = round((entry.correctnessRate / entry.count) * 100);
      entry.gap = round(Math.abs(entry.correctnessRate - entry.avgConfidence));
      totalWeightedGap += (entry.count / Math.max(1, surfacedCount)) * entry.gap;
    } else {
      entry.avgConfidence = null;
      entry.correctnessRate = null;
      entry.gap = null;
    }
    return entry;
  });

  return {
    surfacedCount,
    expectedCalibrationError: surfacedCount > 0
      ? round(totalWeightedGap)
      : null,
    topConfidenceBinActualCorrectness: (() => {
      const topBin = [...normalizedBins]
        .reverse()
        .find(entry => Number(entry?.count) > 0);
      return topBin ? topBin.correctnessRate : null;
    })(),
    bins: normalizedBins,
  };
}

function computePromptMetrics(run) {
  const routes = Array.isArray(run?.routes) ? run.routes : [];
  const triggeredRoutes = routes.filter(route => route.triggered);
  const hiddenIntentRoutes = routes.filter(route => route.expectsTrigger);
  const noFuelRoutes = routes.filter(route => !route.expectsTrigger);
  const weeksPerDriver = Math.max(1 / 7, Number(run?.routesPerDriver || 0) / 7);
  const activeUserWeeks = Math.max(1e-6, Number(run?.driverCount || 0) * weeksPerDriver);
  const correctTriggered = hiddenIntentRoutes.filter(route => route.firstTriggerCorrect).length;
  const nuisancePrompts = noFuelRoutes.filter(route => route.triggered).length;
  const promptsPerUserWeekValues = Object.values(
    routes.reduce((accumulator, route) => {
      const driverId = String(route?.driverId || '');
      if (!driverId) return accumulator;
      if (!accumulator[driverId]) {
        accumulator[driverId] = { promptCount: 0 };
      }
      accumulator[driverId].promptCount += route.triggered ? 1 : 0;
      return accumulator;
    }, {})
  ).map(entry => entry.promptCount / weeksPerDriver);
  const backToBackPromptTrips = routes.filter(route => (Array.isArray(route.routeEvents) ? route.routeEvents.length : 0) > 1).length;

  let repeatPromptAfterIgnoreShortHorizonCount = 0;
  let totalPromptEvents = 0;
  for (const route of routes) {
    const routeEvents = Array.isArray(route?.routeEvents) ? route.routeEvents : [];
    totalPromptEvents += routeEvents.length;
    for (let index = 0; index < routeEvents.length - 1; index += 1) {
      const currentEvent = routeEvents[index];
      const nextEvent = routeEvents[index + 1];
      if (!currentEvent || !nextEvent) continue;
      const sameOpportunityClass = String(currentEvent.type || '') === String(nextEvent.type || '');
      const deltaMs = Math.max(0, Number(nextEvent.triggeredAt) - Number(currentEvent.triggeredAt));
      if (sameOpportunityClass && deltaMs <= SHORT_HORIZON_REPEAT_PROMPT_MS) {
        repeatPromptAfterIgnoreShortHorizonCount += 1;
      }
    }
  }

  return {
    totalTrips: routes.length,
    noFuelTripCount: noFuelRoutes.length,
    promptCount: triggeredRoutes.length,
    promptsPer100Trips: round((triggeredRoutes.length / Math.max(1, routes.length)) * 100),
    promptsPerUserWeek: round(triggeredRoutes.length / activeUserWeeks),
    correctPromptsPerUserWeek: round(correctTriggered / activeUserWeeks),
    nuisancePromptsPer100NoFuelTrips: round((nuisancePrompts / Math.max(1, noFuelRoutes.length)) * 100),
    actionableTripsPer100Trips: round((hiddenIntentRoutes.length / Math.max(1, routes.length)) * 100),
    promptsPerUserWeekValues,
    promptsPerUserWeekSummary: summarizeSeries(promptsPerUserWeekValues),
    backToBackPromptTripCount: backToBackPromptTrips,
    backToBackPromptRate: round((backToBackPromptTrips / Math.max(1, routes.length)) * 100),
    repeatPromptAfterIgnoreShortHorizonCount,
    totalPromptEvents,
    repeatPromptAfterIgnoreShortHorizonRate: round((repeatPromptAfterIgnoreShortHorizonCount / Math.max(1, totalPromptEvents)) * 100),
  };
}

function collectOracleVisiblePriceStats(run) {
  const candidateStationsByDecisionId = new Map();
  for (const candidate of run?.candidate_stations || []) {
    if (!candidateStationsByDecisionId.has(candidate.decision_id)) {
      candidateStationsByDecisionId.set(candidate.decision_id, []);
    }
    candidateStationsByDecisionId.get(candidate.decision_id).push(candidate);
  }

  const surfacedPromptOracleGapCpg = [];
  const visibleOracleRegretPct = [];
  const missedOracleRegretCpg = [];
  const correctPromptSavingsVsActualCpg = [];
  let meaningfulSavingsPromptCount = 0;
  let surfacedPromptCount = 0;
  let highValueOpportunityCount = 0;
  let missedHighValueOpportunityCount = 0;

  for (const route of run?.routes || []) {
    const decisionCandidates = candidateStationsByDecisionId.get(route.decisionId) || [];
    if (!decisionCandidates.length) continue;
    const oracleMinPrice = Math.min(...decisionCandidates.map(candidate => Number(candidate.effective_price) || Number.POSITIVE_INFINITY));
    if (!Number.isFinite(oracleMinPrice)) continue;

    const triggeredCandidate = route.triggeredStationId
      ? decisionCandidates.find(candidate => candidate.station_id === route.triggeredStationId)
      : null;
    const actualFuelCandidate = decisionCandidates.find(candidate => Number(candidate.chosen_label) === 1) || null;
    const firstRouteEvent = Array.isArray(route.routeEvents) ? route.routeEvents[0] : null;
    const actualFuelPrice = Number(actualFuelCandidate?.effective_price);
    const oraclePotentialSavings = Number.isFinite(actualFuelPrice)
      ? Math.max(0, actualFuelPrice - oracleMinPrice)
      : 0;
    const surfacedPotentialSavings = (triggeredCandidate && Number.isFinite(actualFuelPrice))
      ? Math.max(0, actualFuelPrice - (Number(triggeredCandidate.effective_price) || actualFuelPrice))
      : 0;

    if (route.expectsTrigger && oraclePotentialSavings >= MEANINGFUL_SAVINGS_PER_GAL) {
      highValueOpportunityCount += 1;
      if (!route.firstTriggerCorrect) {
        missedHighValueOpportunityCount += 1;
      }
    }

    if (triggeredCandidate) {
      surfacedPromptCount += 1;
      surfacedPromptOracleGapCpg.push(Math.max(0, ((Number(triggeredCandidate.effective_price) || oracleMinPrice) - oracleMinPrice) * 100));
      const estimatedSavings = Math.max(
        0,
        Number(firstRouteEvent?.savings) || 0,
        surfacedPotentialSavings,
      );
      if (estimatedSavings >= MEANINGFUL_SAVINGS_PER_GAL) {
        meaningfulSavingsPromptCount += 1;
      }
      if (oraclePotentialSavings > 0) {
        visibleOracleRegretPct.push(
          Math.max(0, ((oraclePotentialSavings - surfacedPotentialSavings) / oraclePotentialSavings) * 100)
        );
      } else {
        visibleOracleRegretPct.push(0);
      }
    }
    if (route.expectsTrigger && !route.firstTriggerCorrect && actualFuelCandidate) {
      missedOracleRegretCpg.push(Math.max(0, ((Number(actualFuelCandidate.effective_price) || oracleMinPrice) - oracleMinPrice) * 100));
    }
    if (route.firstTriggerCorrect && triggeredCandidate && actualFuelCandidate) {
      correctPromptSavingsVsActualCpg.push(
        Math.max(0, ((Number(actualFuelCandidate.effective_price) || 0) - (Number(triggeredCandidate.effective_price) || 0)) * 100)
      );
    }
  }

  return {
    surfacedPromptOracleGapCpg,
    visibleOracleRegretPct,
    missedOracleRegretCpg,
    correctPromptSavingsVsActualCpg,
    meaningfulSavingsPromptCount,
    surfacedPromptCount,
    highValueOpportunityCount,
    missedHighValueOpportunityCount,
  };
}

function computeOracleVisiblePriceMetrics(run) {
  const stats = collectOracleVisiblePriceStats(run);
  return {
    avgSurfacedPromptOracleGapCpg: round(average(stats.surfacedPromptOracleGapCpg)),
    p90SurfacedPromptOracleGapCpg: round(percentile(stats.surfacedPromptOracleGapCpg, 0.9)),
    avgMissedOracleRegretCpg: round(average(stats.missedOracleRegretCpg)),
    p90MissedOracleRegretCpg: round(percentile(stats.missedOracleRegretCpg, 0.9)),
    avgCorrectPromptSavingsVsActualCpg: round(average(stats.correctPromptSavingsVsActualCpg)),
    visibleOracleRegretMean: round(average(stats.visibleOracleRegretPct)),
    visibleOracleRegretP90: round(percentile(stats.visibleOracleRegretPct, 0.9)),
    meaningfulSavingsPromptShare: stats.surfacedPromptCount > 0
      ? round((stats.meaningfulSavingsPromptCount / stats.surfacedPromptCount) * 100)
      : 0,
    surfacedPromptCount: stats.surfacedPromptCount,
    meaningfulSavingsPromptCount: stats.meaningfulSavingsPromptCount,
    highValueOpportunityCount: stats.highValueOpportunityCount,
    missedHighValueOpportunityCount: stats.missedHighValueOpportunityCount,
    missedHighValueOpportunityRate: stats.highValueOpportunityCount > 0
      ? round((stats.missedHighValueOpportunityCount / stats.highValueOpportunityCount) * 100)
      : 0,
  };
}

function countTopReasons(routes) {
  const triggerReasons = {};
  const failureStages = {};
  for (const route of routes || []) {
    const firstEvent = Array.isArray(route.routeEvents) ? route.routeEvents[0] : null;
    if (firstEvent?.reason) {
      triggerReasons[firstEvent.reason] = (triggerReasons[firstEvent.reason] || 0) + 1;
    }
    const failureStage = route.statefulTraceSummary?.failureStage;
    if (failureStage) {
      failureStages[failureStage] = (failureStages[failureStage] || 0) + 1;
    }
  }
  return {
    topTriggerReasons: Object.entries(triggerReasons)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([reason, count]) => ({ reason, count })),
    topFailureStages: Object.entries(failureStages)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 8)
      .map(([reason, count]) => ({ reason, count })),
  };
}

function summarizeRun(run) {
  return {
    historyLevel: run.historyLevel,
    noiseSeed: run.noiseSeed,
    scorecard: { ...run.summary.scorecard },
    promptMetrics: computePromptMetrics(run),
    calibration: createCalibrationBins(run.routes),
    oraclePriceMetrics: computeOracleVisiblePriceMetrics(run),
    reasonCoverage: countTopReasons(run.routes),
    actionableOpportunityRateAmongFuelStops: run.summary.actionableOpportunityRateAmongFuelStops,
  };
}

function createPriceDistortion(station, seed, maxMagnitudeDollars) {
  const stationHash = hashString(`${station?.stationId || ''}:${seed}`);
  const polarity = stationHash % 2 === 0 ? 1 : -1;
  const fraction = ((stationHash % 1000) / 1000);
  return round(polarity * fraction * maxMagnitudeDollars, 3);
}

function createAdversary(name, scenarioSeed = 0) {
  switch (name) {
    case 'stale_prices':
      return {
        name,
        mutateStations(stations) {
          return (stations || []).map(station => {
            const drift = createPriceDistortion(station, scenarioSeed, 0.18);
            return {
              ...cloneStation(station),
              price: round(Math.max(2.0, (Number(station?.price) || 0) + drift), 3),
            };
          });
        },
      };
    case 'missing_cheapest_station':
      return {
        name,
        mutateStations(stations) {
          const nextStations = (stations || []).map(cloneStation);
          if (nextStations.length <= 2) return nextStations;
          const sortedByPrice = [...nextStations].sort((left, right) =>
            (Number(left?.price) || Number.POSITIVE_INFINITY) - (Number(right?.price) || Number.POSITIVE_INFINITY)
          );
          const cheapestStationId = sortedByPrice[0]?.stationId;
          const secondCheapestPrice = Number(sortedByPrice[1]?.price) || Number.POSITIVE_INFINITY;
          const cheapestPrice = Number(sortedByPrice[0]?.price) || Number.POSITIVE_INFINITY;
          if (!cheapestStationId || !Number.isFinite(cheapestPrice) || (secondCheapestPrice - cheapestPrice) < 0.01) {
            return nextStations;
          }
          return nextStations.filter(station => station.stationId !== cheapestStationId);
        },
      };
    case 'market_churn':
      return {
        name,
        mutateStations(stations, context = {}) {
          const nextStations = (stations || []).map(cloneStation);
          if (nextStations.length <= 1) return nextStations;
          const phase = Number(context.stationSetCallCount) || 0;
          if (phase < 4) return nextStations;
          return nextStations.filter((station, index) => ((hashString(station.stationId) + phase + scenarioSeed + index) % 3) !== 0);
        },
      };
    case 'route_snap_noise':
      return {
        name,
        mutateSample(sample, context = {}) {
          const sampleIndex = Number(context.routeSampleIndex) || 0;
          const amplitudeMeters = 18;
          const latScale = 1 / 111111;
          const lonScale = 1 / (111111 * Math.max(0.2, Math.cos((Number(sample?.latitude) || 0) * Math.PI / 180)));
          const latOffsetMeters = Math.sin((sampleIndex + 1 + scenarioSeed) * 0.63) * amplitudeMeters;
          const lonOffsetMeters = Math.cos((sampleIndex + 1 + scenarioSeed) * 0.77) * amplitudeMeters;
          return {
            ...sample,
            latitude: Number(sample?.latitude) + (latOffsetMeters * latScale),
            longitude: Number(sample?.longitude) + (lonOffsetMeters * lonScale),
          };
        },
      };
    default:
      return { name: 'baseline' };
  }
}

function buildProductionRecommenderOptions(historyLevel = 'none') {
  void historyLevel;
  // The robustness harness should evaluate the actual shipped policy, not a
  // stale shadow fork with dozens of harness-only overrides.
  return {};
}

function calibrateProductionConfidence(event, historyLevel = 'none') {
  void historyLevel;
  return round(clamp(Number(event?.confidence) || 0, 0, 1), 4);
}

function createRealisticRobustnessEngineFactory({
  adversaryName = 'baseline',
  adversarySeed = 0,
  historyLevel = 'none',
} = {}) {
  const adversary = createAdversary(adversaryName, adversarySeed);
  const recommenderOptions = buildProductionRecommenderOptions(historyLevel);
  return function makeEngine({
    profile,
    onTrigger,
    onDecisionSnapshot,
    onRecommendationEvaluation,
    onRecommendationSuppressed,
    onRecommendationSkipped,
  }) {
    let surfacedRoutePromptCount = 0;
    const recommender = createPredictiveRecommender({
      onTrigger: event => {
        if (surfacedRoutePromptCount > 0) {
          return;
        }
        surfacedRoutePromptCount += 1;
        if (!event) {
          onTrigger?.(event);
          return;
        }
        onTrigger?.({
          ...event,
          confidence: calibrateProductionConfidence(event, historyLevel),
        });
      },
      onDecisionSnapshot,
      onRecommendationEvaluation,
      onRecommendationSuppressed,
      onRecommendationSkipped,
      ...recommenderOptions,
    });
    recommender.setProfile(normalizePredictiveFuelingProfile(profile || {}));
    let routeSampleIndex = 0;
    let stationSetCallCount = 0;
    return {
      setStations(nextStations) {
        stationSetCallCount += 1;
        const mutatedStations = typeof adversary.mutateStations === 'function'
          ? adversary.mutateStations(nextStations, { routeSampleIndex, stationSetCallCount })
          : nextStations;
        recommender.setStations(mutatedStations);
      },
      setProfile(nextProfile) {
        recommender.setProfile(normalizePredictiveFuelingProfile(nextProfile || profile));
      },
      pushLocation(sample, extraContext = {}) {
        const mutatedSample = typeof adversary.mutateSample === 'function'
          ? adversary.mutateSample(sample, { routeSampleIndex, extraContext, stationSetCallCount })
          : sample;
        routeSampleIndex += 1;
        return recommender.pushLocation(mutatedSample, extraContext);
      },
      reset() {
        routeSampleIndex = 0;
        stationSetCallCount = 0;
        surfacedRoutePromptCount = 0;
        recommender.reset();
      },
      getEvents() { return recommender.getEvents(); },
      getPendingRecommendation() { return recommender.getPendingRecommendation(); },
      getDebugState() { return recommender.getDebugState(); },
    };
  };
}

function groupRunsByHistoryLevel(runs) {
  return DEFAULT_HISTORY_LEVELS.reduce((accumulator, historyLevel) => {
    accumulator[historyLevel] = runs.filter(run => run.historyLevel === historyLevel);
    return accumulator;
  }, {});
}

function aggregateHistoryRuns(runs) {
  const summaries = runs.map(summarizeRun);
  const scorecards = summaries.map(summary => summary.scorecard);
  const promptMetrics = summaries.map(summary => summary.promptMetrics);
  const calibration = summaries.map(summary => summary.calibration);
  const oraclePriceMetrics = summaries.map(summary => summary.oraclePriceMetrics);
  const combinedCalibration = createCalibrationBins(runs.flatMap(run => run.routes || []));
  const oracleCollectors = runs.map(run => collectOracleVisiblePriceStats(run));

  const totalTrips = sum(promptMetrics.map(metrics => metrics.totalTrips));
  const totalPromptCount = sum(promptMetrics.map(metrics => metrics.promptCount));
  const totalNoFuelTrips = sum(promptMetrics.map(metrics => metrics.noFuelTripCount));
  const totalBackToBackPromptTrips = sum(promptMetrics.map(metrics => metrics.backToBackPromptTripCount));
  const totalRepeatPromptAfterIgnoreShortHorizonCount = sum(promptMetrics.map(metrics => metrics.repeatPromptAfterIgnoreShortHorizonCount));
  const totalPromptEvents = sum(promptMetrics.map(metrics => metrics.totalPromptEvents));

  const combinedOracleVisibleRegret = oracleCollectors.flatMap(entry => entry.visibleOracleRegretPct);
  const totalMeaningfulSavingsPromptCount = sum(oraclePriceMetrics.map(metrics => metrics.meaningfulSavingsPromptCount));
  const totalSurfacedPromptCount = sum(oraclePriceMetrics.map(metrics => metrics.surfacedPromptCount));
  const totalHighValueOpportunityCount = sum(oraclePriceMetrics.map(metrics => metrics.highValueOpportunityCount));
  const totalMissedHighValueOpportunityCount = sum(oraclePriceMetrics.map(metrics => metrics.missedHighValueOpportunityCount));

  return {
    runCount: runs.length,
    scorecards: {
      accuracy: summarizeSeries(scorecards.map(scorecard => scorecard.accuracy)),
      precision: summarizeSeries(scorecards.map(scorecard => scorecard.precision)),
      recall: summarizeSeries(scorecards.map(scorecard => scorecard.recall)),
      falsePositiveRate: summarizeSeries(scorecards.map(scorecard => scorecard.falsePositiveRate)),
      wrongStationRate: summarizeSeries(scorecards.map(scorecard => scorecard.wrongStationRate)),
      precisionFirstScore: summarizeSeries(scorecards.map(scorecard => scorecard.precisionFirstScore)),
    },
    promptMetrics: {
      promptsPer100Trips: summarizeSeries(promptMetrics.map(metrics => metrics.promptsPer100Trips)),
      promptsPer100TripsOverall: round((totalPromptCount / Math.max(1, totalTrips)) * 100),
      promptsPerUserWeek: summarizeSeries(promptMetrics.map(metrics => metrics.promptsPerUserWeek)),
      correctPromptsPerUserWeek: summarizeSeries(promptMetrics.map(metrics => metrics.correctPromptsPerUserWeek)),
      nuisancePromptsPer100NoFuelTrips: summarizeSeries(promptMetrics.map(metrics => metrics.nuisancePromptsPer100NoFuelTrips)),
      promptsPerUserWeekDistribution: summarizeSeries(promptMetrics.flatMap(metrics => metrics.promptsPerUserWeekValues || [])),
      backToBackPromptRate: summarizeSeries(promptMetrics.map(metrics => metrics.backToBackPromptRate)),
      backToBackPromptRateOverall: round((totalBackToBackPromptTrips / Math.max(1, totalTrips)) * 100),
      repeatPromptAfterIgnoreShortHorizonRate: summarizeSeries(promptMetrics.map(metrics => metrics.repeatPromptAfterIgnoreShortHorizonRate)),
      repeatPromptAfterIgnoreShortHorizonRateOverall: round((totalRepeatPromptAfterIgnoreShortHorizonCount / Math.max(1, totalPromptEvents)) * 100),
    },
    calibration: {
      expectedCalibrationError: summarizeSeries(calibration.map(entry => entry.expectedCalibrationError)),
      expectedCalibrationErrorOverall: combinedCalibration.expectedCalibrationError,
      surfacedCount: summarizeSeries(calibration.map(entry => entry.surfacedCount)),
      topConfidenceBinActualCorrectness: summarizeSeries(calibration.map(entry => entry.topConfidenceBinActualCorrectness)),
      topConfidenceBinActualCorrectnessOverall: combinedCalibration.topConfidenceBinActualCorrectness,
      bins: combinedCalibration.bins,
    },
    oraclePriceMetrics: {
      avgSurfacedPromptOracleGapCpg: summarizeSeries(oraclePriceMetrics.map(metrics => metrics.avgSurfacedPromptOracleGapCpg)),
      avgMissedOracleRegretCpg: summarizeSeries(oraclePriceMetrics.map(metrics => metrics.avgMissedOracleRegretCpg)),
      avgCorrectPromptSavingsVsActualCpg: summarizeSeries(oraclePriceMetrics.map(metrics => metrics.avgCorrectPromptSavingsVsActualCpg)),
      visibleOracleRegret: summarizeSeries(oraclePriceMetrics.map(metrics => metrics.visibleOracleRegretMean)),
      visibleOracleRegretP90ByRun: summarizeSeries(oraclePriceMetrics.map(metrics => metrics.visibleOracleRegretP90)),
      visibleOracleRegretOverallMean: round(average(combinedOracleVisibleRegret)),
      visibleOracleRegretOverallP90: round(percentile(combinedOracleVisibleRegret, 0.9)),
      meaningfulSavingsPromptShare: summarizeSeries(oraclePriceMetrics.map(metrics => metrics.meaningfulSavingsPromptShare)),
      meaningfulSavingsPromptShareOverall: totalSurfacedPromptCount > 0
        ? round((totalMeaningfulSavingsPromptCount / totalSurfacedPromptCount) * 100)
        : 0,
      missedHighValueOpportunityRate: summarizeSeries(oraclePriceMetrics.map(metrics => metrics.missedHighValueOpportunityRate)),
      missedHighValueOpportunityRateOverall: totalHighValueOpportunityCount > 0
        ? round((totalMissedHighValueOpportunityCount / totalHighValueOpportunityCount) * 100)
        : 0,
      highValueOpportunityCountTotal: totalHighValueOpportunityCount,
      surfacedPromptCountTotal: totalSurfacedPromptCount,
    },
    actionableOpportunityRateAmongFuelStops: summarizeSeries(summaries.map(summary => summary.actionableOpportunityRateAmongFuelStops)),
    runs: summaries,
  };
}

function buildCheck({ id, pass, actual, threshold, scope, description }) {
  return {
    id,
    scope,
    description,
    pass: Boolean(pass),
    actual: actual == null ? null : round(actual),
    threshold,
  };
}

function compactAggregateForComparison(aggregate) {
  if (!aggregate) return null;
  return {
    scorecards: aggregate.scorecards,
    promptMetrics: {
      promptsPer100Trips: aggregate.promptMetrics?.promptsPer100Trips,
      promptsPer100TripsOverall: aggregate.promptMetrics?.promptsPer100TripsOverall,
      promptsPerUserWeekDistribution: aggregate.promptMetrics?.promptsPerUserWeekDistribution,
      backToBackPromptRateOverall: aggregate.promptMetrics?.backToBackPromptRateOverall,
      repeatPromptAfterIgnoreShortHorizonRateOverall: aggregate.promptMetrics?.repeatPromptAfterIgnoreShortHorizonRateOverall,
    },
    calibration: {
      expectedCalibrationError: aggregate.calibration?.expectedCalibrationError,
      expectedCalibrationErrorOverall: aggregate.calibration?.expectedCalibrationErrorOverall,
      topConfidenceBinActualCorrectnessOverall: aggregate.calibration?.topConfidenceBinActualCorrectnessOverall,
    },
    oraclePriceMetrics: {
      visibleOracleRegretOverallMean: aggregate.oraclePriceMetrics?.visibleOracleRegretOverallMean,
      visibleOracleRegretOverallP90: aggregate.oraclePriceMetrics?.visibleOracleRegretOverallP90,
      meaningfulSavingsPromptShareOverall: aggregate.oraclePriceMetrics?.meaningfulSavingsPromptShareOverall,
      missedHighValueOpportunityRateOverall: aggregate.oraclePriceMetrics?.missedHighValueOpportunityRateOverall,
    },
  };
}

function compareAggregates(baselineAggregate, scenarioAggregate) {
  const delta = (scenarioValue, baselineValue) => {
    if (scenarioValue == null || baselineValue == null) return null;
    return round(Number(scenarioValue) - Number(baselineValue));
  };
  return {
    baseline: compactAggregateForComparison(baselineAggregate),
    scenario: compactAggregateForComparison(scenarioAggregate),
    delta: {
      recall: {
        mean: delta(scenarioAggregate?.scorecards?.recall?.mean, baselineAggregate?.scorecards?.recall?.mean),
        p10: delta(scenarioAggregate?.scorecards?.recall?.p10, baselineAggregate?.scorecards?.recall?.p10),
      },
      falsePositiveRate: {
        mean: delta(scenarioAggregate?.scorecards?.falsePositiveRate?.mean, baselineAggregate?.scorecards?.falsePositiveRate?.mean),
        p90: delta(scenarioAggregate?.scorecards?.falsePositiveRate?.p90, baselineAggregate?.scorecards?.falsePositiveRate?.p90),
      },
      wrongStationRate: {
        mean: delta(scenarioAggregate?.scorecards?.wrongStationRate?.mean, baselineAggregate?.scorecards?.wrongStationRate?.mean),
        p90: delta(scenarioAggregate?.scorecards?.wrongStationRate?.p90, baselineAggregate?.scorecards?.wrongStationRate?.p90),
      },
      promptsPer100Trips: {
        mean: delta(scenarioAggregate?.promptMetrics?.promptsPer100Trips?.mean, baselineAggregate?.promptMetrics?.promptsPer100Trips?.mean),
      },
      calibrationError: {
        mean: delta(
          scenarioAggregate?.calibration?.expectedCalibrationErrorOverall ?? scenarioAggregate?.calibration?.expectedCalibrationError?.mean,
          baselineAggregate?.calibration?.expectedCalibrationErrorOverall ?? baselineAggregate?.calibration?.expectedCalibrationError?.mean,
        ),
      },
    },
  };
}

function runRealisticRobustnessSweep({
  seeds = [],
  historyLevels = DEFAULT_HISTORY_LEVELS,
  driverCount = 8,
  routesPerDriver = 24,
  adversaryName = 'baseline',
  createEngineFnForSeed = null,
  actionableLabelMode = 'observable',
  latentPlanHistoryLevel = 'match',
  freezeVisitHistory = true,
  continueOnError = false,
} = {}) {
  const runs = [];
  const errors = [];
  for (const noiseSeed of seeds) {
    for (const historyLevel of historyLevels) {
      try {
        const run = simulateRealisticCohortBatch({
          createEngineFn: typeof createEngineFnForSeed === 'function'
            ? createEngineFnForSeed({ noiseSeed, historyLevel, adversaryName })
            : createRealisticRobustnessEngineFactory({
              adversaryName,
              adversarySeed: noiseSeed,
              historyLevel,
            }),
          applyNoise: true,
          noiseSeed,
          driverCount,
          routesPerDriver,
          historyLevel,
          actionableLabelMode,
          latentPlanHistoryLevel,
          freezeVisitHistory,
          collectRouteEvents: true,
          collectStatefulTrace: true,
        });
        run.noiseSeed = noiseSeed;
        runs.push(run);
      } catch (error) {
        if (!continueOnError) {
          throw error;
        }
        errors.push({
          noiseSeed,
          historyLevel,
          message: error?.message || String(error),
        });
      }
    }
  }

  const grouped = groupRunsByHistoryLevel(runs);
  const histories = Object.fromEntries(
    Object.entries(grouped).map(([historyLevel, historyRuns]) => [
      historyLevel,
      aggregateHistoryRuns(historyRuns),
    ])
  );

  return {
    adversaryName,
    seeds: [...seeds],
    driverCount,
    routesPerDriver,
    histories,
    overall: aggregateHistoryRuns(runs),
    runs: runs.map(summarizeRun),
    errors,
  };
}

function corruptProfileForRobustness(profile, seed = 0) {
  const primaryVisit = Array.isArray(profile?.visitHistory) && profile.visitHistory.length > 0
    ? profile.visitHistory[0]
    : null;
  const primaryStationId = String(primaryVisit?.stationId || `corrupt-station-${seed}`).trim();
  return {
    ...profile,
    preferredBrands: [...(Array.isArray(profile?.preferredBrands) ? profile.preferredBrands : []), null, '', 'Shell'],
    brandLoyalty: seed % 2 === 0 ? 4.2 : -3.5,
    distanceWeight: '-12',
    priceWeight: '8.7',
    preferredGrade: null,
    typicalFillUpIntervalMiles: -250,
    estimatedMilesSinceLastFill: '-40',
    odometerMiles: '-1000',
    rushHourPatterns: {
      morningPeak: 'yes',
      eveningPeak: null,
    },
    visitHistory: [
      ...(Array.isArray(profile?.visitHistory) ? profile.visitHistory.slice(0, 3) : []),
      {
        stationId: primaryStationId,
        stationName: null,
        brand: 'Shell',
        visitCount: -7,
        lastVisitMs: '1700000000000',
        visitTimestamps: ['1700000000000', 'bad', -1],
        contextCounts: {
          total: '3',
          city: -2,
        },
      },
      {
        stationId: '',
        visitCount: 1,
      },
    ],
    exposureHistory: [
      ...(Array.isArray(profile?.exposureHistory) ? profile.exposureHistory.slice(0, 4) : []),
      {
        stationId: primaryStationId,
        exposureCount: '12',
        lastExposureMs: '1700000001000',
        contextCounts: {
          total: '12',
          weekday: '9',
          evening: -3,
        },
      },
    ],
    routeStationHabits: {
      ...(profile?.routeStationHabits || {}),
      [`template:corrupt-${seed}`]: {
        [primaryStationId]: {
          count: '-5',
          lastVisitMs: 'bad',
        },
        'valid-station': {
          count: '8',
          lastVisitMs: '1700000002000',
        },
        '': {
          count: 10,
          lastVisitMs: 123,
        },
      },
    },
    routeStationExposures: {
      ...(profile?.routeStationExposures || {}),
      [`template:corrupt-${seed}`]: {
        [primaryStationId]: {
          count: '-4',
          lastExposureMs: 'bad',
        },
        'valid-station': {
          count: '17',
          lastExposureMs: '1700000003000',
        },
      },
    },
    fillUpHistory: [
      ...(Array.isArray(profile?.fillUpHistory) ? profile.fillUpHistory.slice(-2) : []),
      {
        timestamp: '1700000004000',
        odometer: '40211',
        gallons: '12.5',
        pricePerGallon: '3.39',
        stationId: primaryStationId,
      },
      {
        timestamp: 'bad',
      },
    ],
  };
}

function countNormalizedProfileOutOfBoundsFields(profile) {
  let invalid = 0;
  const checkFinite = (value, min = null, max = null) => {
    if (value == null) return true;
    if (!Number.isFinite(Number(value))) return false;
    if (min != null && Number(value) < min) return false;
    if (max != null && Number(value) > max) return false;
    return true;
  };

  if (!checkFinite(profile?.brandLoyalty, 0, 1)) invalid += 1;
  if (!checkFinite(profile?.distanceWeight, 0, 1)) invalid += 1;
  if (!checkFinite(profile?.priceWeight, 0, 1)) invalid += 1;
  if (!checkFinite(profile?.typicalFillUpIntervalMiles, 120, null)) invalid += 1;
  if (!checkFinite(profile?.estimatedMilesSinceLastFill, 0, null)) invalid += 1;
  if (!checkFinite(profile?.odometerMiles, 0, null)) invalid += 1;

  for (const brand of Array.isArray(profile?.preferredBrands) ? profile.preferredBrands : []) {
    if (!String(brand || '').trim()) invalid += 1;
  }

  for (const entry of Array.isArray(profile?.visitHistory) ? profile.visitHistory : []) {
    if (!String(entry?.stationId || '').trim()) invalid += 1;
    if (!checkFinite(entry?.visitCount, 1, null)) invalid += 1;
    if (!checkFinite(entry?.lastVisitMs, 1, null)) invalid += 1;
    for (const timestamp of Array.isArray(entry?.visitTimestamps) ? entry.visitTimestamps : []) {
      if (!checkFinite(timestamp, 1, null)) invalid += 1;
    }
    for (const value of Object.values(entry?.contextCounts || {})) {
      if (!checkFinite(value, 0, null)) invalid += 1;
    }
  }

  for (const entry of Array.isArray(profile?.exposureHistory) ? profile.exposureHistory : []) {
    if (!String(entry?.stationId || '').trim()) invalid += 1;
    if (!checkFinite(entry?.exposureCount, 1, null)) invalid += 1;
    if (!checkFinite(entry?.lastExposureMs, 1, null)) invalid += 1;
    for (const value of Object.values(entry?.contextCounts || {})) {
      if (!checkFinite(value, 0, null)) invalid += 1;
    }
  }

  for (const habitMap of Object.values(profile?.routeStationHabits || {})) {
    for (const [stationId, value] of Object.entries(habitMap || {})) {
      if (!String(stationId || '').trim()) invalid += 1;
      if (!checkFinite(value?.count, 1, null)) invalid += 1;
      if (!checkFinite(value?.lastVisitMs, 1, null)) invalid += 1;
    }
  }

  for (const exposureMap of Object.values(profile?.routeStationExposures || {})) {
    for (const [stationId, value] of Object.entries(exposureMap || {})) {
      if (!String(stationId || '').trim()) invalid += 1;
      if (!checkFinite(value?.count, 1, null)) invalid += 1;
      if (!checkFinite(value?.lastExposureMs, 1, null)) invalid += 1;
    }
  }

  for (const entry of Array.isArray(profile?.fillUpHistory) ? profile.fillUpHistory : []) {
    if (!checkFinite(entry?.timestamp, 1, null)) invalid += 1;
    if (!checkFinite(entry?.odometer, 0, null)) invalid += 1;
    if (!checkFinite(entry?.gallons, 0, null)) invalid += 1;
    if (!checkFinite(entry?.pricePerGallon, 0, null)) invalid += 1;
  }

  return invalid;
}

function createCorruptedNormalizationEngineFactory({
  adversaryName = 'baseline',
  adversarySeed = 0,
  historyLevel = 'none',
  normalizedProfilesCollector = null,
} = {}) {
  const baseFactory = createRealisticRobustnessEngineFactory({
    adversaryName,
    adversarySeed,
    historyLevel,
  });

  return function makeEngine(args = {}) {
    let mutationIndex = 0;
    const normalizeCorrupted = profile => {
      const normalized = normalizePredictiveFuelingProfile(
        corruptProfileForRobustness(profile || {}, adversarySeed + mutationIndex)
      );
      mutationIndex += 1;
      if (Array.isArray(normalizedProfilesCollector)) {
        normalizedProfilesCollector.push(normalized);
      }
      return normalized;
    };

    const engine = baseFactory({
      ...args,
      profile: normalizeCorrupted(args.profile),
    });

    return {
      setStations(nextStations) {
        return engine.setStations(nextStations);
      },
      setProfile(nextProfile) {
        return engine.setProfile(normalizeCorrupted(nextProfile));
      },
      pushLocation(sample, extraContext) {
        return engine.pushLocation(sample, extraContext);
      },
      reset() {
        return engine.reset();
      },
      getEvents() {
        return engine.getEvents();
      },
      getPendingRecommendation() {
        return engine.getPendingRecommendation();
      },
      getDebugState() {
        return engine.getDebugState();
      },
    };
  };
}

function buildPersistenceSafetyReport({
  baseline,
  seeds,
  historyLevels,
  driverCount,
  routesPerDriver,
  actionableLabelMode = 'observable',
}) {
  const normalizedProfiles = [];
  const totalSweepUnits = Math.max(1, seeds.length * historyLevels.length);
  const corruptedSweep = runRealisticRobustnessSweep({
    seeds,
    historyLevels,
    driverCount,
    routesPerDriver,
    adversaryName: 'baseline',
    createEngineFnForSeed: ({ noiseSeed, historyLevel }) => {
      return createCorruptedNormalizationEngineFactory({
        adversaryName: 'baseline',
        adversarySeed: noiseSeed,
        historyLevel,
        normalizedProfilesCollector: normalizedProfiles,
      });
    },
    actionableLabelMode,
    continueOnError: true,
  });

  const outOfBoundsProfiles = normalizedProfiles.filter(profile => countNormalizedProfileOutOfBoundsFields(profile) > 0);
  const crashCount = Array.isArray(corruptedSweep.errors) ? corruptedSweep.errors.length : 0;
  const postNormalizationWrongStationRateIncrease = round(
    (corruptedSweep.overall?.scorecards?.wrongStationRate?.mean ?? 0) -
    (baseline.overall?.scorecards?.wrongStationRate?.mean ?? 0)
  );

  const recoveryRoutesPerDriver = 14;
  const buildRecovery = historyLevel => {
    const steadySweep = runRealisticRobustnessSweep({
      seeds,
      historyLevels: [historyLevel],
      driverCount,
      routesPerDriver: recoveryRoutesPerDriver,
      adversaryName: 'baseline',
      latentPlanHistoryLevel: 'match',
      freezeVisitHistory: true,
      actionableLabelMode,
    });
    const relearnSweep = runRealisticRobustnessSweep({
      seeds,
      historyLevels: ['none'],
      driverCount,
      routesPerDriver: recoveryRoutesPerDriver,
      adversaryName: 'baseline',
      latentPlanHistoryLevel: historyLevel,
      freezeVisitHistory: false,
      actionableLabelMode,
    });
    const steadyRecall = steadySweep.overall?.scorecards?.recall?.mean ?? 0;
    const relearnRecall = relearnSweep.overall?.scorecards?.recall?.mean ?? 0;
    return {
      steadyRecall: round(steadyRecall),
      relearnRecall: round(relearnRecall),
      recoveryPct: steadyRecall > 0
        ? round((relearnRecall / steadyRecall) * 100)
        : null,
    };
  };

  const lightRecovery = buildRecovery('light');
  const richRecovery = buildRecovery('rich');

  return {
    corruptProfileNormalizationCrashRate: round((crashCount / totalSweepUnits) * 100),
    postNormalizationOutOfBoundsFieldRate: normalizedProfiles.length > 0
      ? round((outOfBoundsProfiles.length / normalizedProfiles.length) * 100)
      : 0,
    postNormalizationWrongStationRateIncrease,
    stateResetRelearnRecallRecoveryLight: lightRecovery.recoveryPct,
    stateResetRelearnRecallRecoveryRich: richRecovery.recoveryPct,
    cleanBaseline: baseline.overall,
    corruptedBaseline: corruptedSweep.overall,
    crashes: corruptedSweep.errors,
    corruptProfileCaseCount: normalizedProfiles.length,
    outOfBoundsProfileCount: outOfBoundsProfiles.length,
    recovery: {
      light: lightRecovery,
      rich: richRecovery,
    },
  };
}

function buildBaselineChecks(baseline, thresholds = DEFAULT_PRODUCTION_THRESHOLDS) {
  const checks = [];

  checks.push(
    buildCheck({
      id: 'wrong_station_rate_p90',
      scope: 'broad_realistic_multi_seed',
      description: '90th percentile wrong-station rate across clean sweep units',
      pass: (baseline?.overall?.scorecards?.wrongStationRate?.p90 ?? Infinity) <= thresholds.broadSweep.wrongStationRateP90Max,
      actual: baseline?.overall?.scorecards?.wrongStationRate?.p90,
      threshold: `<= ${thresholds.broadSweep.wrongStationRateP90Max}%`,
    }),
    buildCheck({
      id: 'wrong_station_rate_mean',
      scope: 'broad_realistic_multi_seed',
      description: 'Mean wrong-station rate across clean sweep units',
      pass: (baseline?.overall?.scorecards?.wrongStationRate?.mean ?? Infinity) <= thresholds.broadSweep.wrongStationRateMeanMax,
      actual: baseline?.overall?.scorecards?.wrongStationRate?.mean,
      threshold: `<= ${thresholds.broadSweep.wrongStationRateMeanMax}%`,
    }),
    buildCheck({
      id: 'false_positive_rate_p90',
      scope: 'broad_realistic_multi_seed',
      description: '90th percentile false-positive rate across clean sweep units',
      pass: (baseline?.overall?.scorecards?.falsePositiveRate?.p90 ?? Infinity) <= thresholds.broadSweep.falsePositiveRateP90Max,
      actual: baseline?.overall?.scorecards?.falsePositiveRate?.p90,
      threshold: `<= ${thresholds.broadSweep.falsePositiveRateP90Max}%`,
    }),
    buildCheck({
      id: 'false_positive_rate_mean',
      scope: 'broad_realistic_multi_seed',
      description: 'Mean false-positive rate across clean sweep units',
      pass: (baseline?.overall?.scorecards?.falsePositiveRate?.mean ?? Infinity) <= thresholds.broadSweep.falsePositiveRateMeanMax,
      actual: baseline?.overall?.scorecards?.falsePositiveRate?.mean,
      threshold: `<= ${thresholds.broadSweep.falsePositiveRateMeanMax}%`,
    }),
    buildCheck({
      id: 'expected_calibration_error_mean',
      scope: 'broad_realistic_multi_seed',
      description: 'Mean expected calibration error across sweep units',
      pass: (baseline?.overall?.calibration?.expectedCalibrationError?.mean ?? Infinity) <= thresholds.calibration.expectedCalibrationErrorMeanMax,
      actual: baseline?.overall?.calibration?.expectedCalibrationError?.mean,
      threshold: `<= ${thresholds.calibration.expectedCalibrationErrorMeanMax}%`,
    }),
    buildCheck({
      id: 'expected_calibration_error_p90',
      scope: 'broad_realistic_multi_seed',
      description: '90th percentile expected calibration error across sweep units',
      pass: (baseline?.overall?.calibration?.expectedCalibrationError?.p90 ?? Infinity) <= thresholds.calibration.expectedCalibrationErrorP90Max,
      actual: baseline?.overall?.calibration?.expectedCalibrationError?.p90,
      threshold: `<= ${thresholds.calibration.expectedCalibrationErrorP90Max}%`,
    }),
    buildCheck({
      id: 'top_confidence_bin_actual_correctness',
      scope: 'broad_realistic_multi_seed',
      description: 'Actual correctness in the top populated confidence bin',
      pass: (baseline?.overall?.calibration?.topConfidenceBinActualCorrectnessOverall ?? -Infinity) >= thresholds.calibration.topConfidenceBinActualCorrectnessMin,
      actual: baseline?.overall?.calibration?.topConfidenceBinActualCorrectnessOverall,
      threshold: `>= ${thresholds.calibration.topConfidenceBinActualCorrectnessMin}%`,
    }),
    buildCheck({
      id: 'prompts_per_user_week_median',
      scope: 'broad_realistic_multi_seed',
      description: 'Median prompts per simulated user-week',
      pass: (baseline?.overall?.promptMetrics?.promptsPerUserWeekDistribution?.median ?? Infinity) <= thresholds.promptDiscipline.promptsPerUserWeekMedianMax,
      actual: baseline?.overall?.promptMetrics?.promptsPerUserWeekDistribution?.median,
      threshold: `<= ${thresholds.promptDiscipline.promptsPerUserWeekMedianMax}`,
    }),
    buildCheck({
      id: 'prompts_per_user_week_p90',
      scope: 'broad_realistic_multi_seed',
      description: '90th percentile prompts per simulated user-week',
      pass: (baseline?.overall?.promptMetrics?.promptsPerUserWeekDistribution?.p90 ?? Infinity) <= thresholds.promptDiscipline.promptsPerUserWeekP90Max,
      actual: baseline?.overall?.promptMetrics?.promptsPerUserWeekDistribution?.p90,
      threshold: `<= ${thresholds.promptDiscipline.promptsPerUserWeekP90Max}`,
    }),
    buildCheck({
      id: 'back_to_back_prompt_rate',
      scope: 'broad_realistic_multi_seed',
      description: 'Trips with immediate back-to-back prompts',
      pass: (baseline?.overall?.promptMetrics?.backToBackPromptRateOverall ?? Infinity) < thresholds.promptDiscipline.backToBackPromptRateMaxExclusive,
      actual: baseline?.overall?.promptMetrics?.backToBackPromptRateOverall,
      threshold: `< ${thresholds.promptDiscipline.backToBackPromptRateMaxExclusive}%`,
    }),
    buildCheck({
      id: 'repeat_prompt_after_ignore_short_horizon_rate',
      scope: 'broad_realistic_multi_seed',
      description: 'Ignored prompts followed by another prompt in the short horizon',
      pass: (baseline?.overall?.promptMetrics?.repeatPromptAfterIgnoreShortHorizonRateOverall ?? Infinity) <= thresholds.promptDiscipline.repeatPromptAfterIgnoreShortHorizonRateMax,
      actual: baseline?.overall?.promptMetrics?.repeatPromptAfterIgnoreShortHorizonRateOverall,
      threshold: `<= ${thresholds.promptDiscipline.repeatPromptAfterIgnoreShortHorizonRateMax}%`,
    }),
    buildCheck({
      id: 'visible_oracle_regret_mean',
      scope: 'broad_realistic_multi_seed',
      description: 'Mean regret versus the best visible feasible candidate',
      pass: (baseline?.overall?.oraclePriceMetrics?.visibleOracleRegretOverallMean ?? Infinity) <= thresholds.savingsQuality.visibleOracleRegretMeanMax,
      actual: baseline?.overall?.oraclePriceMetrics?.visibleOracleRegretOverallMean,
      threshold: `<= ${thresholds.savingsQuality.visibleOracleRegretMeanMax}%`,
    }),
    buildCheck({
      id: 'visible_oracle_regret_p90',
      scope: 'broad_realistic_multi_seed',
      description: '90th percentile regret versus the best visible feasible candidate',
      pass: (baseline?.overall?.oraclePriceMetrics?.visibleOracleRegretOverallP90 ?? Infinity) <= thresholds.savingsQuality.visibleOracleRegretP90Max,
      actual: baseline?.overall?.oraclePriceMetrics?.visibleOracleRegretOverallP90,
      threshold: `<= ${thresholds.savingsQuality.visibleOracleRegretP90Max}%`,
    }),
    buildCheck({
      id: 'meaningful_savings_prompt_share',
      scope: 'broad_realistic_multi_seed',
      description: 'Share of prompts that clear the meaningful-savings threshold',
      pass: (baseline?.overall?.oraclePriceMetrics?.meaningfulSavingsPromptShareOverall ?? -Infinity) >= thresholds.savingsQuality.meaningfulSavingsPromptShareMin,
      actual: baseline?.overall?.oraclePriceMetrics?.meaningfulSavingsPromptShareOverall,
      threshold: `>= ${thresholds.savingsQuality.meaningfulSavingsPromptShareMin}%`,
    }),
  );

  for (const historyLevel of DEFAULT_HISTORY_LEVELS) {
    const aggregate = baseline?.histories?.[historyLevel];
    const recallThresholds = thresholds.recallByHistory[historyLevel];
    const precisionThresholds = thresholds.precisionByHistory[historyLevel];
    const promptThresholds = thresholds.promptDisciplineByHistory[historyLevel];
    const recallMedian = aggregate?.scorecards?.recall?.median ?? 0;
    const recallP10 = aggregate?.scorecards?.recall?.p10 ?? 0;
    const recallRatio = recallMedian > 0 ? recallP10 / recallMedian : 0;

    checks.push(
      buildCheck({
        id: `recall_p10_${historyLevel}`,
        scope: `history_${historyLevel}`,
        description: `10th percentile recall for ${historyLevel} profiles`,
        pass: (aggregate?.scorecards?.recall?.p10 ?? -Infinity) >= recallThresholds.p10Min,
        actual: aggregate?.scorecards?.recall?.p10,
        threshold: `>= ${recallThresholds.p10Min}%`,
      }),
      buildCheck({
        id: `recall_median_${historyLevel}`,
        scope: `history_${historyLevel}`,
        description: `Median recall for ${historyLevel} profiles`,
        pass: (aggregate?.scorecards?.recall?.median ?? -Infinity) >= recallThresholds.medianMin,
        actual: aggregate?.scorecards?.recall?.median,
        threshold: `>= ${recallThresholds.medianMin}%`,
      }),
      buildCheck({
        id: `precision_mean_${historyLevel}`,
        scope: `history_${historyLevel}`,
        description: `Mean precision for ${historyLevel} profiles`,
        pass: (aggregate?.scorecards?.precision?.mean ?? -Infinity) >= precisionThresholds.meanMin,
        actual: aggregate?.scorecards?.precision?.mean,
        threshold: `>= ${precisionThresholds.meanMin}%`,
      }),
      buildCheck({
        id: `precision_p10_${historyLevel}`,
        scope: `history_${historyLevel}`,
        description: `10th percentile precision for ${historyLevel} profiles`,
        pass: (aggregate?.scorecards?.precision?.p10 ?? -Infinity) >= precisionThresholds.p10Min,
        actual: aggregate?.scorecards?.precision?.p10,
        threshold: `>= ${precisionThresholds.p10Min}%`,
      }),
      buildCheck({
        id: `prompts_per_100_trips_${historyLevel}`,
        scope: `history_${historyLevel}`,
        description: `Prompts per 100 trips for ${historyLevel} profiles`,
        pass: (aggregate?.promptMetrics?.promptsPer100TripsOverall ?? Infinity) >= promptThresholds.min &&
          (aggregate?.promptMetrics?.promptsPer100TripsOverall ?? -Infinity) <= promptThresholds.max,
        actual: aggregate?.promptMetrics?.promptsPer100TripsOverall,
        threshold: `between ${promptThresholds.min} and ${promptThresholds.max}`,
      }),
      buildCheck({
        id: `recall_p10_vs_median_ratio_${historyLevel}`,
        scope: `history_${historyLevel}`,
        description: `Tail recall must be at least half the median recall for ${historyLevel}`,
        pass: recallRatio >= thresholds.stability.recallP10VsMedianRatioMin,
        actual: recallRatio * 100,
        threshold: `>= ${thresholds.stability.recallP10VsMedianRatioMin * 100}% of median`,
      }),
    );
  }

  checks.push(
    buildCheck({
      id: 'missed_high_value_opportunity_rate_light',
      scope: 'history_light',
      description: 'Missed high-value opportunity rate for light-history users',
      pass: (baseline?.histories?.light?.oraclePriceMetrics?.missedHighValueOpportunityRateOverall ?? Infinity) <= thresholds.savingsQuality.missedHighValueOpportunityRate.light,
      actual: baseline?.histories?.light?.oraclePriceMetrics?.missedHighValueOpportunityRateOverall,
      threshold: `<= ${thresholds.savingsQuality.missedHighValueOpportunityRate.light}%`,
    }),
    buildCheck({
      id: 'missed_high_value_opportunity_rate_rich',
      scope: 'history_rich',
      description: 'Missed high-value opportunity rate for rich-history users',
      pass: (baseline?.histories?.rich?.oraclePriceMetrics?.missedHighValueOpportunityRateOverall ?? Infinity) <= thresholds.savingsQuality.missedHighValueOpportunityRate.rich,
      actual: baseline?.histories?.rich?.oraclePriceMetrics?.missedHighValueOpportunityRateOverall,
      threshold: `<= ${thresholds.savingsQuality.missedHighValueOpportunityRate.rich}%`,
    }),
    buildCheck({
      id: 'no_clean_realistic_sweep_unit_wrong_station_rate_gt_3',
      scope: 'broad_realistic_multi_seed',
      description: 'No clean sweep unit may exceed the wrong-station ceiling',
      pass: (baseline?.overall?.scorecards?.wrongStationRate?.max ?? Infinity) <= thresholds.stability.cleanSweepUnitWrongStationRateMax,
      actual: baseline?.overall?.scorecards?.wrongStationRate?.max,
      threshold: `<= ${thresholds.stability.cleanSweepUnitWrongStationRateMax}%`,
    }),
    buildCheck({
      id: 'no_clean_realistic_sweep_unit_false_positive_rate_gt_8',
      scope: 'broad_realistic_multi_seed',
      description: 'No clean sweep unit may exceed the false-positive ceiling',
      pass: (baseline?.overall?.scorecards?.falsePositiveRate?.max ?? Infinity) <= thresholds.stability.cleanSweepUnitFalsePositiveRateMax,
      actual: baseline?.overall?.scorecards?.falsePositiveRate?.max,
      threshold: `<= ${thresholds.stability.cleanSweepUnitFalsePositiveRateMax}%`,
    }),
  );

  return checks;
}

function buildAdversarialChecks(adversarialMatrix, thresholds = DEFAULT_PRODUCTION_THRESHOLDS) {
  const checks = [];
  for (const [scenarioName, comparison] of Object.entries(adversarialMatrix || {})) {
    const scenarioThresholds = thresholds.adversarial[scenarioName];
    if (!scenarioThresholds) continue;
    checks.push(
      buildCheck({
        id: `${scenarioName}_wrong_station_rate_p90`,
        scope: `adversarial_${scenarioName}`,
        description: `${scenarioName} wrong-station rate p90`,
        pass: (comparison?.scenario?.scorecards?.wrongStationRate?.p90 ?? Infinity) <= scenarioThresholds.wrongStationRateP90Max,
        actual: comparison?.scenario?.scorecards?.wrongStationRate?.p90,
        threshold: `<= ${scenarioThresholds.wrongStationRateP90Max}%`,
      }),
      buildCheck({
        id: `${scenarioName}_false_positive_rate_p90`,
        scope: `adversarial_${scenarioName}`,
        description: `${scenarioName} false-positive rate p90`,
        pass: (comparison?.scenario?.scorecards?.falsePositiveRate?.p90 ?? Infinity) <= scenarioThresholds.falsePositiveRateP90Max,
        actual: comparison?.scenario?.scorecards?.falsePositiveRate?.p90,
        threshold: `<= ${scenarioThresholds.falsePositiveRateP90Max}%`,
      }),
      buildCheck({
        id: `${scenarioName}_recall_p10`,
        scope: `adversarial_${scenarioName}`,
        description: `${scenarioName} recall p10`,
        pass: (comparison?.scenario?.scorecards?.recall?.p10 ?? -Infinity) >= scenarioThresholds.recallP10Min,
        actual: comparison?.scenario?.scorecards?.recall?.p10,
        threshold: `>= ${scenarioThresholds.recallP10Min}%`,
      }),
    );
  }
  return checks;
}

function buildPersistenceChecks(persistence, thresholds = DEFAULT_PRODUCTION_THRESHOLDS) {
  return [
    buildCheck({
      id: 'corrupt_profile_normalization_crash_rate',
      scope: 'persistence_safety',
      description: 'Corrupt-profile normalization must not crash',
      pass: (persistence?.corruptProfileNormalizationCrashRate ?? Infinity) <= thresholds.persistenceSafety.corruptProfileNormalizationCrashRateMax,
      actual: persistence?.corruptProfileNormalizationCrashRate,
      threshold: `= ${thresholds.persistenceSafety.corruptProfileNormalizationCrashRateMax}`,
    }),
    buildCheck({
      id: 'post_normalization_out_of_bounds_field_rate',
      scope: 'persistence_safety',
      description: 'Normalized persisted fields must all fall within bounds',
      pass: (persistence?.postNormalizationOutOfBoundsFieldRate ?? Infinity) <= thresholds.persistenceSafety.postNormalizationOutOfBoundsFieldRateMax,
      actual: persistence?.postNormalizationOutOfBoundsFieldRate,
      threshold: `= ${thresholds.persistenceSafety.postNormalizationOutOfBoundsFieldRateMax}`,
    }),
    buildCheck({
      id: 'post_normalization_wrong_station_rate_increase',
      scope: 'persistence_safety',
      description: 'Corrupt-state normalization must not materially raise wrong-station rate',
      pass: (persistence?.postNormalizationWrongStationRateIncrease ?? Infinity) <= thresholds.persistenceSafety.postNormalizationWrongStationRateIncreaseMax,
      actual: persistence?.postNormalizationWrongStationRateIncrease,
      threshold: `<= ${thresholds.persistenceSafety.postNormalizationWrongStationRateIncreaseMax}% absolute`,
    }),
    buildCheck({
      id: 'state_reset_relearn_recall_recovery_light',
      scope: 'persistence_safety',
      description: 'Light-history recall recovery after reset within two simulated weeks',
      pass: (persistence?.stateResetRelearnRecallRecoveryLight ?? -Infinity) >= thresholds.persistenceSafety.resetRelearnRecallRecoveryLightMin,
      actual: persistence?.stateResetRelearnRecallRecoveryLight,
      threshold: `>= ${thresholds.persistenceSafety.resetRelearnRecallRecoveryLightMin}%`,
    }),
    buildCheck({
      id: 'state_reset_relearn_recall_recovery_rich',
      scope: 'persistence_safety',
      description: 'Rich-history recall recovery after reset within two simulated weeks',
      pass: (persistence?.stateResetRelearnRecallRecoveryRich ?? -Infinity) >= thresholds.persistenceSafety.resetRelearnRecallRecoveryRichMin,
      actual: persistence?.stateResetRelearnRecallRecoveryRich,
      threshold: `>= ${thresholds.persistenceSafety.resetRelearnRecallRecoveryRichMin}%`,
    }),
  ];
}

function runPredictiveRobustnessReport({
  baselineSeeds = [],
  adversarialSeeds = [],
  driverCount = 8,
  routesPerDriver = 24,
  adversarialScenarios = ['stale_prices', 'missing_cheapest_station', 'market_churn', 'route_snap_noise'],
  baselineHistoryLevels = DEFAULT_HISTORY_LEVELS,
  adversarialHistoryLevels = DEFAULT_HISTORY_LEVELS,
  actionableLabelMode = 'observable',
  thresholds = DEFAULT_PRODUCTION_THRESHOLDS,
} = {}) {
  const baseline = runRealisticRobustnessSweep({
    seeds: baselineSeeds,
    historyLevels: baselineHistoryLevels,
    driverCount,
    routesPerDriver,
    adversaryName: 'baseline',
    actionableLabelMode,
  });
  const adversarialMatrix = Object.fromEntries(
    adversarialScenarios.map(scenarioName => {
      const scenario = runRealisticRobustnessSweep({
        seeds: adversarialSeeds,
        historyLevels: adversarialHistoryLevels,
        driverCount,
        routesPerDriver,
        adversaryName: scenarioName,
        actionableLabelMode,
      });
      return [scenarioName, compareAggregates(baseline.overall, scenario.overall)];
    })
  );
  const persistence = buildPersistenceSafetyReport({
    baseline,
    seeds: baselineSeeds,
    historyLevels: baselineHistoryLevels,
    driverCount,
    routesPerDriver,
    actionableLabelMode,
  });
  const baselineChecks = buildBaselineChecks(baseline, thresholds);
  const adversarialChecks = buildAdversarialChecks(adversarialMatrix, thresholds);
  const persistenceChecks = buildPersistenceChecks(persistence, thresholds);
  const allChecks = [
    ...baselineChecks,
    ...adversarialChecks,
    ...persistenceChecks,
  ];
  const failedChecks = allChecks.filter(check => !check.pass);

  return {
    thresholds,
    baseline,
    adversarial: adversarialMatrix,
    persistence,
    verdict: {
      baseline: baselineChecks,
      adversarial: adversarialChecks,
      persistence: persistenceChecks,
      allChecks,
      overall: {
        ready: failedChecks.length === 0,
        failedGateCount: failedChecks.length,
        failedCheckIds: failedChecks.map(check => check.id),
      },
    },
  };
}

module.exports = {
  DEFAULT_PRODUCTION_THRESHOLDS,
  buildProductionRecommenderOptions,
  calibrateProductionConfidence,
  createRealisticRobustnessEngineFactory,
  createCalibrationBins,
  computePromptMetrics,
  computeOracleVisiblePriceMetrics,
  runRealisticRobustnessSweep,
  runPredictiveRobustnessReport,
};
