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
  return ({ profile, onTrigger }) => {
    const recommender = createPredictiveRecommender({
      onTrigger,
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
        });
      }
    }
  }

  return { routeReplays, examples };
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
  const inputSize = Array.isArray(trainExamples?.[0]?.features) ? trainExamples[0].features.length : GATE_FEATURE_SIZE;
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
  for (const historyLevel of DEFAULT_HISTORY_LEVELS) {
    const bucketExamples = trainExamples.filter(example => example.historyLevel === historyLevel);
    models[historyLevel] = trainDenseModel(bucketExamples, hiddenSizes, {
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
  });
  const proposalValidation = collectRouteReplays({
    seeds: validationSeeds,
    routeCount: routesPerDriver,
    historyLevels,
    engineOptions: REALISTIC_PROPOSAL_ENGINE_OPTIONS,
    simulationFn: simulateRealisticCohortBatch,
    simulationOptions,
  });
  const proposalTest = collectRouteReplays({
    seeds: testSeeds,
    routeCount: routesPerDriver,
    historyLevels,
    engineOptions: REALISTIC_PROPOSAL_ENGINE_OPTIONS,
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
    statefulHistoryModelDesign,
    aggressiveStatefulHistoryModelDesign,
    selectiveHistoryLiftStatefulDesign,
    statefulHistoryModelConfidenceBlendDesign,
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
      },
      validation: {
        seedCount: validationSeeds.length,
        replayCount: proposalValidation.routeReplays.length,
        exampleCount: proposalValidation.examples.length,
      },
      test: {
        seedCount: testSeeds.length,
        replayCount: proposalTest.routeReplays.length,
        exampleCount: proposalTest.examples.length,
      },
    },
    designs,
    bestDesign,
  };
}

function runPrimaryMlOptimizationExperiment(options = {}) {
  return runRealisticMlCohortExperiment(options);
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
};
