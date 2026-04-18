/**
 * Range estimator based on fill-up history.
 *
 * fillUpHistory entries: { timestamp: ms, odometer: miles, gallons: number, pricePerGallon: number }
 * If odometer not available, we infer from timestamps + typical interval.
 *
 * The tricky case is opportunistic topping off: drivers may add fuel after
 * short intervals even though their true tank range is much larger. If we
 * simply average odometer deltas, the inferred interval collapses and the app
 * starts believing the driver is near empty all the time. We therefore blend:
 *   - a prior interval estimate
 *   - a robust upper-half interval summary
 *   - a gallons-based capacity proxy
 * and reduce confidence when those sources disagree sharply.
 */

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function mean(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function quantile(values, q) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const clampedQ = clamp(q, 0, 1);
  const index = (sorted.length - 1) * clampedQ;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  if (lowerIndex === upperIndex) {
    return sorted[lowerIndex];
  }
  const weight = index - lowerIndex;
  return sorted[lowerIndex] + ((sorted[upperIndex] - sorted[lowerIndex]) * weight);
}

function buildIntervalInference(fillUpHistory, options = {}) {
  const {
    typicalIntervalMiles = 280,
    defaultMpg = 25,
    defaultTankGallons = 12.5,
  } = options;

  const priorIntervalMiles = Math.max(160, typicalIntervalMiles || (defaultTankGallons * defaultMpg));
  const sorted = [...(fillUpHistory || [])].sort((a, b) => a.timestamp - b.timestamp);

  const intervalMiles = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const previousEntry = sorted[index - 1];
    const entry = sorted[index];
    const delta = Number(entry?.odometer) - Number(previousEntry?.odometer);
    if (Number.isFinite(delta) && delta > 40 && delta < 700) {
      intervalMiles.push(delta);
    }
  }

  const gallonSamples = sorted
    .map(entry => Number(entry?.gallons))
    .filter(value => Number.isFinite(value) && value > 4);

  const medianIntervalMiles = intervalMiles.length ? quantile(intervalMiles, 0.5) : 0;
  const upperHalfIntervals = intervalMiles.length
    ? intervalMiles.filter(value => value >= medianIntervalMiles)
    : [];
  const robustObservedIntervalMiles = upperHalfIntervals.length
    ? mean(upperHalfIntervals)
    : 0;
  const upperQuartileGallons = gallonSamples.length
    ? quantile(gallonSamples, 0.75)
    : 0;
  const gallonsInferredIntervalMiles = upperQuartileGallons > 0
    ? Math.max(160, upperQuartileGallons * defaultMpg)
    : 0;

  let intervalEvidenceWeight = 0;
  if (robustObservedIntervalMiles > 0) {
    intervalEvidenceWeight += Math.min(0.45, intervalMiles.length * 0.10);
  }
  if (gallonsInferredIntervalMiles > 0) {
    intervalEvidenceWeight += Math.min(0.25, 0.12 + (gallonSamples.length * 0.03));
  }
  intervalEvidenceWeight = clamp(intervalEvidenceWeight, 0.12, 0.72);

  const supportIntervalMiles = Math.max(
    gallonsInferredIntervalMiles * 0.92,
    priorIntervalMiles * 0.70,
    160
  );
  const observedAgreement = robustObservedIntervalMiles > 0
    ? clamp(
      1 - (Math.abs(robustObservedIntervalMiles - supportIntervalMiles) / Math.max(supportIntervalMiles, 1)),
      0,
      1
    )
    : 0.55;
  const shortIntervalCompression = (
    robustObservedIntervalMiles > 0 &&
    robustObservedIntervalMiles < (supportIntervalMiles * 0.58) &&
    gallonsInferredIntervalMiles >= (priorIntervalMiles * 0.65)
  );
  if (shortIntervalCompression) {
    intervalEvidenceWeight *= 0.35;
  }

  let blendedObservedIntervalMiles = robustObservedIntervalMiles;
  if (gallonsInferredIntervalMiles > 0) {
    blendedObservedIntervalMiles = robustObservedIntervalMiles > 0
      ? ((robustObservedIntervalMiles * 0.45) + (gallonsInferredIntervalMiles * 0.55))
      : gallonsInferredIntervalMiles;
  }
  if (!Number.isFinite(blendedObservedIntervalMiles) || blendedObservedIntervalMiles <= 0) {
    blendedObservedIntervalMiles = supportIntervalMiles;
  }

  const inferredIntervalMiles = clamp(
    (priorIntervalMiles * (1 - intervalEvidenceWeight)) +
    (blendedObservedIntervalMiles * intervalEvidenceWeight),
    Math.max(160, priorIntervalMiles * 0.62),
    Math.max(priorIntervalMiles * 1.35, supportIntervalMiles * 1.15, 450)
  );

  const countBasedConfidence = intervalMiles.length >= 3
    ? 1
    : intervalMiles.length === 2
      ? 0.88
      : intervalMiles.length === 1
        ? 0.74
        : gallonSamples.length >= 2
          ? 0.64
          : sorted.length >= 1
            ? 0.56
            : 0.50;
  const intervalConfidence = clamp(
    countBasedConfidence * (0.45 + (Math.max(observedAgreement, shortIntervalCompression ? 0.22 : 0.38) * 0.55)),
    0.35,
    1
  );

  return {
    inferredIntervalMiles,
    intervalConfidence,
    intervalMiles,
    gallonSamples,
    priorIntervalMiles,
    robustObservedIntervalMiles,
    gallonsInferredIntervalMiles,
    shortIntervalCompression,
  };
}

function inferTypicalIntervalMiles(fillUpHistory, options = {}) {
  return buildIntervalInference(fillUpHistory, options).inferredIntervalMiles;
}

function estimateFuelState(fillUpHistory, context = {}) {
  const {
    currentOdometer,
    milesSinceLastFill,
    typicalIntervalMiles = 280,
    lowFuelThresholdMiles = 50,
    urgentFuelThresholdMiles = 25,
    defaultMpg = 25,
    defaultTankGallons = 12.5,
  } = context;

  const intervalInference = buildIntervalInference(fillUpHistory, {
    typicalIntervalMiles,
    defaultMpg,
    defaultTankGallons,
  });
  const avgIntervalMiles = intervalInference.inferredIntervalMiles;
  const sorted = [...(fillUpHistory || [])].sort((a, b) => a.timestamp - b.timestamp);
  const intervalConfidence = intervalInference.intervalConfidence;

  let resolvedMilesSinceLastFill = Number.isFinite(Number(milesSinceLastFill))
    ? Number(milesSinceLastFill)
    : null;

  if (resolvedMilesSinceLastFill == null && sorted.length >= 1) {
    const lastFill = sorted[sorted.length - 1];
    if (currentOdometer && lastFill.odometer) {
      resolvedMilesSinceLastFill = currentOdometer - lastFill.odometer;
    } else {
      const elapsed = Date.now() - lastFill.timestamp;
      const daysElapsed = elapsed / (1000 * 86400);
      resolvedMilesSinceLastFill = daysElapsed * 30;
    }
  }

  if (resolvedMilesSinceLastFill == null) {
    resolvedMilesSinceLastFill = avgIntervalMiles * 0.5;
  }

  const estimatedRemainingMiles = Math.max(0, avgIntervalMiles - resolvedMilesSinceLastFill);

  let urgency = 0;
  if (estimatedRemainingMiles <= urgentFuelThresholdMiles) {
    urgency = 1.0;
  } else if (estimatedRemainingMiles <= lowFuelThresholdMiles) {
    urgency = 0.5 + 0.5 * (1 - (estimatedRemainingMiles - urgentFuelThresholdMiles) / (lowFuelThresholdMiles - urgentFuelThresholdMiles));
  } else {
    urgency = Math.max(0, 1 - estimatedRemainingMiles / avgIntervalMiles);
    urgency = urgency * urgency;
  }
  const baseFuelNeed = Math.max(urgency, 1 - (estimatedRemainingMiles / Math.max(avgIntervalMiles, 1)));
  const confidenceAdjustedFuelNeed = Math.max(
    urgency,
    baseFuelNeed * (
      urgency >= 0.5
        ? (0.85 + (intervalConfidence * 0.15))
        : intervalConfidence
    )
  );

  return {
    estimatedRemainingMiles: Math.round(estimatedRemainingMiles),
    avgIntervalMiles: Math.round(avgIntervalMiles),
    milesSinceLastFill: Math.round(resolvedMilesSinceLastFill),
    urgency: Math.round(urgency * 100) / 100,
    intervalConfidence: Math.round(intervalConfidence * 100) / 100,
    lowFuel: estimatedRemainingMiles <= lowFuelThresholdMiles,
    urgent: estimatedRemainingMiles <= urgentFuelThresholdMiles,
    fuelNeedScore: Math.round(confidenceAdjustedFuelNeed * 100) / 100,
  };
}

function estimateRange(fillUpHistory, currentOdometer, options = {}) {
  return estimateFuelState(fillUpHistory, {
    currentOdometer,
    ...options,
  });
}

/**
 * Generate a plain-English urgency message like Apple Maps.
 * "~40 mi range · 3 stations within 5 mi"
 */
function formatUrgencyMessage(rangeResult, nearbyStationCount) {
  const { estimatedRemainingMiles, urgent, lowFuel } = rangeResult;
  const rangeStr = `~${estimatedRemainingMiles} mi range`;
  const stationStr = nearbyStationCount > 0
    ? `${nearbyStationCount} station${nearbyStationCount > 1 ? 's' : ''} nearby`
    : 'no stations nearby';
  if (urgent) return `\u26A0\uFE0F Low fuel \u00B7 ${stationStr}`;
  if (lowFuel) return `${rangeStr} \u00B7 ${stationStr}`;
  return `${rangeStr} \u00B7 ${stationStr}`;
}

// Synthetic fill-up histories for test profiles
const SYNTHETIC_FILL_UP_HISTORIES = {
  frequent_filler: Array.from({ length: 8 }, (_, i) => ({
    timestamp: Date.now() - (i + 1) * 5 * 86400 * 1000, // every 5 days
    odometer: 45000 - i * 110,
    gallons: 9.5,
    pricePerGallon: 3.29 + Math.random() * 0.3,
  })).reverse(),

  long_range: Array.from({ length: 5 }, (_, i) => ({
    timestamp: Date.now() - (i + 1) * 12 * 86400 * 1000, // every 12 days
    odometer: 62000 - i * 340,
    gallons: 14.2,
    pricePerGallon: 3.49 + Math.random() * 0.4,
  })).reverse(),

  low_fuel_now: [
    {
      timestamp: Date.now() - 10 * 86400 * 1000, // 10 days ago
      odometer: 38000,
      gallons: 11.0,
      pricePerGallon: 3.39,
    },
  ], // current odometer would be ~38300 → 300 miles since fill, interval ~280 → overdue
};

module.exports = {
  estimateRange,
  estimateFuelState,
  inferTypicalIntervalMiles,
  formatUrgencyMessage,
  SYNTHETIC_FILL_UP_HISTORIES,
};
