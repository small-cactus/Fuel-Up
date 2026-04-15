/**
 * Range estimator based on fill-up history.
 *
 * fillUpHistory entries: { timestamp: ms, odometer: miles, gallons: number, pricePerGallon: number }
 * If odometer not available, we infer from timestamps + typical interval.
 */

function inferTypicalIntervalMiles(fillUpHistory, options = {}) {
  const {
    typicalIntervalMiles = 280,
    defaultMpg = 25,
    defaultTankGallons = 12.5,
  } = options;

  const sorted = [...(fillUpHistory || [])].sort((a, b) => a.timestamp - b.timestamp);
  if (sorted.length >= 2) {
    const intervals = [];
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].odometer && sorted[i - 1].odometer) {
        const delta = sorted[i].odometer - sorted[i - 1].odometer;
        if (Number.isFinite(delta) && delta > 40 && delta < 700) {
          intervals.push(delta);
        }
      }
    }
    if (intervals.length > 0) {
      return intervals.reduce((a, b) => a + b, 0) / intervals.length;
    }
  }

  const gallons = sorted
    .map(entry => Number(entry?.gallons))
    .filter(value => Number.isFinite(value) && value > 4);
  if (gallons.length > 0) {
    const avgGallons = gallons.reduce((a, b) => a + b, 0) / gallons.length;
    return Math.max(160, avgGallons * defaultMpg);
  }

  return Math.max(160, typicalIntervalMiles || (defaultTankGallons * defaultMpg));
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

  const avgIntervalMiles = inferTypicalIntervalMiles(fillUpHistory, {
    typicalIntervalMiles,
    defaultMpg,
    defaultTankGallons,
  });

  let resolvedMilesSinceLastFill = Number.isFinite(Number(milesSinceLastFill))
    ? Number(milesSinceLastFill)
    : null;

  const sorted = [...(fillUpHistory || [])].sort((a, b) => a.timestamp - b.timestamp);
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

  return {
    estimatedRemainingMiles: Math.round(estimatedRemainingMiles),
    avgIntervalMiles: Math.round(avgIntervalMiles),
    milesSinceLastFill: Math.round(resolvedMilesSinceLastFill),
    urgency: Math.round(urgency * 100) / 100,
    lowFuel: estimatedRemainingMiles <= lowFuelThresholdMiles,
    urgent: estimatedRemainingMiles <= urgentFuelThresholdMiles,
    fuelNeedScore: Math.round((Math.max(urgency, 1 - (estimatedRemainingMiles / Math.max(avgIntervalMiles, 1)))) * 100) / 100,
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
