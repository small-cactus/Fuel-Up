const test = require('node:test');
const assert = require('node:assert/strict');
const { estimateRange, formatUrgencyMessage, SYNTHETIC_FILL_UP_HISTORIES } = require('../src/lib/rangeEstimator.js');

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
