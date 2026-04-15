/**
 * Range estimator based on fill-up history.
 *
 * fillUpHistory entries: { timestamp: ms, odometer: miles, gallons: number, pricePerGallon: number }
 * If odometer not available, we infer from timestamps + typical interval.
 */

function estimateRange(fillUpHistory, currentOdometer, options = {}) {
  const {
    typicalIntervalMiles = 280,
    lowFuelThresholdMiles = 50,
    urgentFuelThresholdMiles = 25,
  } = options;

  // Sort history oldest-first
  const sorted = [...(fillUpHistory || [])].sort((a, b) => a.timestamp - b.timestamp);

  let avgIntervalMiles = typicalIntervalMiles;
  let milesSinceLastFill = null;

  if (sorted.length >= 2) {
    // Compute average interval from odometer readings
    const intervals = [];
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].odometer && sorted[i - 1].odometer) {
        intervals.push(sorted[i].odometer - sorted[i - 1].odometer);
      }
    }
    if (intervals.length > 0) {
      avgIntervalMiles = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    }
  }

  if (sorted.length >= 1) {
    const lastFill = sorted[sorted.length - 1];
    if (currentOdometer && lastFill.odometer) {
      milesSinceLastFill = currentOdometer - lastFill.odometer;
    } else {
      // Infer from time elapsed
      const elapsed = Date.now() - lastFill.timestamp;
      const daysElapsed = elapsed / (1000 * 86400);
      // Assume ~30 miles/day average driving
      milesSinceLastFill = daysElapsed * 30;
    }
  }

  const estimatedRemainingMiles = milesSinceLastFill !== null
    ? Math.max(0, avgIntervalMiles - milesSinceLastFill)
    : avgIntervalMiles * 0.5; // unknown → assume half tank

  // Urgency: 0 = plenty of fuel, 1 = need fuel NOW
  let urgency = 0;
  if (estimatedRemainingMiles <= urgentFuelThresholdMiles) {
    urgency = 1.0;
  } else if (estimatedRemainingMiles <= lowFuelThresholdMiles) {
    urgency = 0.5 + 0.5 * (1 - (estimatedRemainingMiles - urgentFuelThresholdMiles) / (lowFuelThresholdMiles - urgentFuelThresholdMiles));
  } else {
    urgency = Math.max(0, 1 - estimatedRemainingMiles / avgIntervalMiles);
    urgency = urgency * urgency; // quadratic: urgency rises steeply as tank empties
  }

  return {
    estimatedRemainingMiles: Math.round(estimatedRemainingMiles),
    avgIntervalMiles: Math.round(avgIntervalMiles),
    milesSinceLastFill: milesSinceLastFill !== null ? Math.round(milesSinceLastFill) : null,
    urgency: Math.round(urgency * 100) / 100,
    lowFuel: estimatedRemainingMiles <= lowFuelThresholdMiles,
    urgent: estimatedRemainingMiles <= urgentFuelThresholdMiles,
  };
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

module.exports = { estimateRange, formatUrgencyMessage, SYNTHETIC_FILL_UP_HISTORIES };
