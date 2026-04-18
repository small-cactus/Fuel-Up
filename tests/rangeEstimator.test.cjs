const test = require('node:test');
const assert = require('node:assert/strict');
const {
  estimateRange,
  estimateFuelState,
  inferTypicalIntervalMiles,
  formatUrgencyMessage,
  SYNTHETIC_FILL_UP_HISTORIES,
} = require('../src/lib/rangeEstimator.js');

test('estimates remaining range from odometer history', () => {
  const history = SYNTHETIC_FILL_UP_HISTORIES.frequent_filler;
  const lastOdometer = history[history.length - 1].odometer;
  const result = estimateRange(history, lastOdometer + 50); // 50 miles since last fill
  assert.ok(result.estimatedRemainingMiles > 0);
  assert.ok(result.milesSinceLastFill === 50);
});

test('low fuel urgency is high when near interval limit', () => {
  const history = SYNTHETIC_FILL_UP_HISTORIES.low_fuel_now;
  // 10 days ago fill-up, now 300 miles used at ~30 miles/day
  const result = estimateRange(history, null, { typicalFillUpIntervalMiles: 280 });
  assert.ok(result.urgency > 0.5, `urgency should be high, got ${result.urgency}`);
});

test('urgency is near 0 with fresh fill-up', () => {
  const freshHistory = [{ timestamp: Date.now() - 1 * 86400 * 1000, odometer: 10000, gallons: 12, pricePerGallon: 3.29 }];
  const result = estimateRange(freshHistory, 10030); // 30 miles since fill
  assert.ok(result.urgency < 0.3, `urgency should be low, got ${result.urgency}`);
});

test('formatUrgencyMessage includes range and station count', () => {
  const result = estimateRange(SYNTHETIC_FILL_UP_HISTORIES.frequent_filler, null);
  const msg = formatUrgencyMessage(result, 3);
  assert.ok(typeof msg === 'string' && msg.length > 0);
});

test('inferTypicalIntervalMiles falls back to gallons when only one fill exists', () => {
  const history = [
    { timestamp: Date.now() - 2 * 86400 * 1000, odometer: 20000, gallons: 12.4, pricePerGallon: 3.39 },
  ];
  const interval = inferTypicalIntervalMiles(history, { defaultMpg: 25 });
  assert.ok(interval >= 250 && interval <= 330, `unexpected inferred interval: ${interval}`);
});

test('estimateFuelState respects an explicit milesSinceLastFill input', () => {
  const history = [
    { timestamp: Date.now() - 4 * 86400 * 1000, odometer: 15000, gallons: 11.5, pricePerGallon: 3.29 },
  ];
  const result = estimateFuelState(history, {
    milesSinceLastFill: 220,
    typicalIntervalMiles: 280,
  });
  assert.equal(result.milesSinceLastFill, 220);
  assert.ok(result.estimatedRemainingMiles <= 80, `remaining miles should be low, got ${result.estimatedRemainingMiles}`);
  assert.ok(result.fuelNeedScore >= result.urgency, `fuelNeedScore should dominate urgency when near empty: ${JSON.stringify(result)}`);
});

test('inferTypicalIntervalMiles does not collapse from opportunistic short-interval fills', () => {
  const now = Date.now();
  const history = [
    { timestamp: now - 20 * 86400 * 1000, odometer: 40000, gallons: 9.2, pricePerGallon: 3.39 },
    { timestamp: now - 15 * 86400 * 1000, odometer: 40062, gallons: 9.6, pricePerGallon: 3.35 },
    { timestamp: now - 10 * 86400 * 1000, odometer: 40118, gallons: 9.4, pricePerGallon: 3.33 },
    { timestamp: now - 5 * 86400 * 1000, odometer: 40179, gallons: 9.5, pricePerGallon: 3.31 },
  ];
  const interval = inferTypicalIntervalMiles(history, {
    typicalIntervalMiles: 290,
    defaultMpg: 25,
    defaultTankGallons: 12.5,
  });
  assert.ok(interval >= 180, `expected a robust interval floor, got ${interval}`);
});

test('estimateFuelState lowers confidence when fill intervals disagree with gallons-based capacity', () => {
  const now = Date.now();
  const history = [
    { timestamp: now - 20 * 86400 * 1000, odometer: 40000, gallons: 9.2, pricePerGallon: 3.39 },
    { timestamp: now - 15 * 86400 * 1000, odometer: 40062, gallons: 9.6, pricePerGallon: 3.35 },
    { timestamp: now - 10 * 86400 * 1000, odometer: 40118, gallons: 9.4, pricePerGallon: 3.33 },
    { timestamp: now - 5 * 86400 * 1000, odometer: 40179, gallons: 9.5, pricePerGallon: 3.31 },
  ];
  const result = estimateFuelState(history, {
    milesSinceLastFill: 58,
    typicalIntervalMiles: 290,
    defaultMpg: 25,
    defaultTankGallons: 12.5,
  });
  assert.ok(result.avgIntervalMiles >= 180, `expected interval estimate to remain realistic, got ${result.avgIntervalMiles}`);
  assert.ok(result.intervalConfidence < 0.9, `expected disagreement to reduce confidence, got ${result.intervalConfidence}`);
  assert.ok(result.fuelNeedScore < 0.5, `expected low fuel need after a short interval top-off, got ${result.fuelNeedScore}`);
});
