const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizePredictiveFuelingProfile,
  recordStationVisit,
  updateProfileMileage,
} = require('../src/lib/predictiveFuelingProfileStore.js');

test('recordStationVisit builds visit history and infers preferred brand', () => {
  let profile = normalizePredictiveFuelingProfile({
    estimatedMilesSinceLastFill: 140,
    odometerMiles: 40_120,
  });

  profile = recordStationVisit(profile, {
    stationId: 'shell-1',
    stationName: 'Shell Downtown',
    brand: 'Shell',
    price: 3.45,
  }, {
    timestampMs: 1_700_000_000_000,
  });
  profile = recordStationVisit(profile, {
    stationId: 'shell-1',
    stationName: 'Shell Downtown',
    brand: 'Shell',
    price: 3.39,
  }, {
    timestampMs: 1_700_000_100_000,
  });

  assert.equal(profile.visitHistory.length, 1);
  assert.equal(profile.visitHistory[0].visitCount, 2);
  assert.deepEqual(profile.preferredBrands, ['Shell']);
  assert.ok(profile.brandLoyalty >= 0.2);
});

test('recordStationVisit with didFuel appends fill-up history and resets estimated range state', () => {
  let profile = normalizePredictiveFuelingProfile({
    estimatedMilesSinceLastFill: 212,
    odometerMiles: 40_212,
  });

  profile = recordStationVisit(profile, {
    stationId: 'wawa-1',
    stationName: 'Wawa Route 73',
    brand: 'Wawa',
    price: 3.19,
  }, {
    timestampMs: 1_700_000_200_000,
    didFuel: true,
    odometerMiles: 40_245,
    gallonsEstimate: 12.1,
  });

  assert.equal(profile.fillUpHistory.length, 1);
  assert.equal(profile.fillUpHistory[0].stationId, 'wawa-1');
  assert.equal(profile.fillUpHistory[0].odometer, 40_245);
  assert.equal(profile.estimatedMilesSinceLastFill, 0);
  assert.equal(profile.odometerMiles, 40_245);
});

test('updateProfileMileage increments odometer and tracked miles since last fill', () => {
  const updated = updateProfileMileage(normalizePredictiveFuelingProfile({
    estimatedMilesSinceLastFill: 88,
    odometerMiles: 40_500,
  }), 14.6);

  assert.equal(updated.odometerMiles, 40_514.6);
  assert.equal(updated.estimatedMilesSinceLastFill, 102.6);
});

test('updateProfileMileage does not invent an odometer baseline when none exists', () => {
  const updated = updateProfileMileage(normalizePredictiveFuelingProfile({
    estimatedMilesSinceLastFill: null,
    odometerMiles: null,
  }), 14.6);

  assert.equal(updated.odometerMiles, null);
  assert.equal(updated.estimatedMilesSinceLastFill, 14.6);
});
