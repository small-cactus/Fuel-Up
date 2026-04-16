const test = require('node:test');
const assert = require('node:assert/strict');

const {
  recommend,
  createPredictiveRecommender,
  projectStation,
  computeAccessPenaltyPrice,
  isPeakTrafficTime,
} = require('../src/lib/predictiveRecommender.js');

function makeSample(latitude, longitude, speed = 14, timestamp = Date.now()) {
  return { latitude, longitude, speed, timestamp };
}

function buildEastboundWindow(timestampMs) {
  return [
    makeSample(39.74, -105.02, 14, timestampMs - 20000),
    makeSample(39.74, -105.018, 14, timestampMs - 15000),
    makeSample(39.74, -105.016, 14, timestampMs - 10000),
    makeSample(39.74, -105.014, 14, timestampMs - 5000),
    makeSample(39.74, -105.012, 14, timestampMs),
  ];
}

function buildLongStraightWindow(timestampMs, speed = 14) {
  const samples = [];
  const startLongitude = -105.05;
  for (let index = 0; index < 8; index += 1) {
    samples.push(
      makeSample(39.74, startLongitude + (index * 0.01), speed, timestampMs - ((7 - index) * 30_000))
    );
  }
  return samples;
}

function buildShortCityWindow(timestampMs, speed = 14) {
  return [
    makeSample(39.74, -105.02, speed, timestampMs - 90_000),
    makeSample(39.74, -105.01, speed, timestampMs - 72_000),
    makeSample(39.74, -105.00, speed, timestampMs - 54_000),
    makeSample(39.74, -104.99, speed, timestampMs - 36_000),
    makeSample(39.74, -104.98, speed, timestampMs - 18_000),
    makeSample(39.74, -104.97, speed, timestampMs),
  ];
}

function buildStoplightWindow(timestampMs) {
  return [
    makeSample(39.74, -105.05, 14, timestampMs - 230_000),
    makeSample(39.74, -105.04, 14, timestampMs - 200_000),
    makeSample(39.74, -105.03, 14, timestampMs - 170_000),
    makeSample(39.74, -105.02, 14, timestampMs - 140_000),
    makeSample(39.74, -105.01, 14, timestampMs - 110_000),
    makeSample(39.74, -105.00, 14, timestampMs - 80_000),
    makeSample(39.74, -104.99, 14, timestampMs - 50_000),
    makeSample(39.74, -104.981, 0.6, timestampMs - 8_000),
    { ...makeSample(39.74, -104.9808, 0.2, timestampMs - 4_000), eventType: 'traffic_light' },
    { ...makeSample(39.74, -104.9808, 0.1, timestampMs), eventType: 'traffic_light' },
  ];
}

function buildGridlockWindow(timestampMs) {
  return [
    makeSample(39.74, -105.02, 6, timestampMs - 60_000),
    makeSample(39.74, -105.018, 0.4, timestampMs - 50_000),
    makeSample(39.7402, -105.016, 5.5, timestampMs - 40_000),
    makeSample(39.7403, -105.0145, 0.5, timestampMs - 30_000),
    makeSample(39.7405, -105.0125, 5.8, timestampMs - 20_000),
    makeSample(39.7406, -105.011, 0.6, timestampMs - 10_000),
    makeSample(39.7408, -105.009, 4.8, timestampMs),
  ];
}

function station(stationId, latitude, longitude, price, brand = 'Test') {
  return { stationId, latitude, longitude, price, brand, distanceMiles: 0 };
}

function habitVisit(stationId, timestampMs, visitCount = 4) {
  return {
    stationId,
    visitCount,
    lastVisitMs: timestampMs - 86_400_000,
    visitTimestamps: [
      timestampMs - 86_400_000,
      timestampMs - (3 * 86_400_000),
      timestampMs - (8 * 86_400_000),
    ],
    contextCounts: {
      total: visitCount,
      highway: 0,
      suburban: 0,
      city: visitCount,
      city_grid: 0,
      weekday: visitCount,
      weekend: 0,
      morning: visitCount,
      midday: 0,
      evening: 0,
      night: 0,
    },
  };
}

test('projectStation exposes signed cross-track so right-side stations are distinguishable from left-side stations', () => {
  const origin = { latitude: 39.74, longitude: -105.012 };
  const rightStation = projectStation(origin, 90, station('right', 39.739, -104.99, 3.20));
  const leftStation = projectStation(origin, 90, station('left', 39.741, -104.99, 3.20));

  assert.ok(rightStation.signedCrossTrack < 0, `expected right-side station to have negative signedCrossTrack, got ${rightStation.signedCrossTrack}`);
  assert.ok(leftStation.signedCrossTrack > 0, `expected left-side station to have positive signedCrossTrack, got ${leftStation.signedCrossTrack}`);
});

test('peak traffic applies a much heavier penalty to left-side hard moves', () => {
  const weekdayRush = new Date('2026-04-14T08:30:00-04:00').getTime();
  const rightCandidate = { alongTrack: 3200, crossTrack: 120, signedCrossTrack: -120 };
  const leftCandidate = { alongTrack: 1800, crossTrack: 180, signedCrossTrack: 180 };
  const opts = {
    leftTurnPenaltyOffPeak: 0.06,
    leftTurnPenaltyPeak: 0.15,
    nearLeftTurnPenaltyPeak: 0.06,
    medianCrossPenaltyPeak: 0.10,
    highwayExitPenalty: 0.04,
    uTurnLikePenaltyPeak: 0.22,
    accessBonusRightSide: 0.02,
  };

  const rightPenalty = computeAccessPenaltyPrice(rightCandidate, opts, weekdayRush, false);
  const leftPenalty = computeAccessPenaltyPrice(leftCandidate, opts, weekdayRush, false);

  assert.equal(isPeakTrafficTime(weekdayRush), true);
  assert.ok(leftPenalty >= 0.30, `expected left-side rush-hour penalty to be high, got ${leftPenalty}`);
  assert.ok(rightPenalty < leftPenalty, `expected right-side access to be easier than left-side access: right=${rightPenalty}, left=${leftPenalty}`);
});

test('MapKit route maneuver penalty overrides geometry-only access scoring when present', () => {
  const weekdayRush = new Date('2026-04-14T08:30:00-04:00').getTime();
  const candidate = {
    station: {
      routeApproach: {
        maneuverPenaltyPrice: 0.18,
      },
    },
    alongTrack: 3200,
    crossTrack: 120,
    signedCrossTrack: -120,
  };

  const penalty = computeAccessPenaltyPrice(candidate, {
    leftTurnPenaltyOffPeak: 0.06,
    leftTurnPenaltyPeak: 0.15,
    nearLeftTurnPenaltyPeak: 0.06,
    medianCrossPenaltyPeak: 0.10,
    highwayExitPenalty: 0.04,
    uTurnLikePenaltyPeak: 0.22,
    accessBonusRightSide: 0.02,
  }, weekdayRush, false);

  assert.equal(penalty, 0.18);
});

test('recommender prefers an easier right-side station over a slightly cheaper left-side station during peak traffic', () => {
  const timestampMs = new Date('2026-04-14T08:30:00-04:00').getTime();
  const window = buildEastboundWindow(timestampMs);
  const stations = [
    station('default-shell', 39.74, -104.965, 3.59, 'Shell'),
    station('hard-left-cheap', 39.7414, -104.990, 3.19, 'Budget'),
    station('easy-right-near-cheap', 39.7392, -104.989, 3.22, 'King Soopers'),
  ];
  const profile = {
    preferredBrands: ['Shell'],
    brandLoyalty: 0.6,
    visitHistory: [habitVisit('default-shell', timestampMs)],
    fillUpHistory: [],
  };

  const result = recommend(window, profile, stations, {
    triggerThreshold: 0.5,
    urgency: 0.9,
    minTripFuelIntentColdStart: 0.2,
    minTripFuelIntentWithHistory: 0.2,
  });
  assert.ok(result, 'expected a recommendation');
  assert.equal(result.stationId, 'easy-right-near-cheap');
  assert.equal(result.type, 'cheaper_alternative');
  assert.equal(result.stationSide, 'right');
});

test('recommender still allows the hard move when left-side savings are overwhelming off-peak', () => {
  const timestampMs = new Date('2026-04-14T13:30:00-04:00').getTime();
  const window = buildEastboundWindow(timestampMs);
  const stations = [
    station('default-shell', 39.74, -104.965, 3.59, 'Shell'),
    station('hard-left-very-cheap', 39.7414, -104.990, 2.99, 'Budget'),
    station('easy-right-less-cheap', 39.7392, -104.989, 3.18, 'King Soopers'),
  ];
  const profile = {
    preferredBrands: ['Shell'],
    brandLoyalty: 0.6,
    visitHistory: [habitVisit('default-shell', timestampMs)],
    fillUpHistory: [],
  };

  const result = recommend(window, profile, stations, {
    triggerThreshold: 0.5,
    urgency: 0.95,
    minTripFuelIntentColdStart: 0.2,
    minTripFuelIntentWithHistory: 0.2,
  });
  assert.ok(result, 'expected a recommendation');
  assert.equal(result.stationId, 'hard-left-very-cheap');
  assert.equal(result.type, 'cheaper_alternative');
});

test('recommendation stays latent during active city driving and waits for a better glance window', () => {
  const timestampMs = new Date('2026-04-14T08:30:00-04:00').getTime();
  const window = buildStoplightWindow(timestampMs).slice(0, 7);
  const stations = [
    station('default-shell', 39.74, -104.975, 3.59, 'Shell'),
    station('easy-right-near-cheap', 39.7392, -104.972, 3.22, 'King Soopers'),
  ];
  const profile = {
    preferredBrands: ['Shell'],
    brandLoyalty: 0.6,
    visitHistory: [habitVisit('default-shell', timestampMs)],
    fillUpHistory: [
      { timestamp: timestampMs - 4 * 86400000, odometer: 15000, gallons: 11.5, pricePerGallon: 3.29 },
    ],
    estimatedMilesSinceLastFill: 250,
    typicalFillUpIntervalMiles: 280,
  };

  const result = recommend(window, profile, stations, {
    triggerThreshold: 0.45,
    minTripFuelIntentColdStart: 0.18,
    minTripFuelIntentWithHistory: 0.18,
    milesSinceLastFill: 250,
  });
  assert.ok(result, 'expected a recommendation candidate');
  assert.equal(result.stationId, 'easy-right-near-cheap');
  assert.equal(result.presentation.surfaceNow, false);
  assert.equal(result.presentation.preferredSurface, 'defer');
});

test('recommendation surfaces during a likely traffic-light pause after enough trip time', () => {
  const timestampMs = new Date('2026-04-14T08:35:00-04:00').getTime();
  const window = buildStoplightWindow(timestampMs);
  const stations = [
    station('default-shell', 39.74, -104.975, 3.59, 'Shell'),
    station('easy-right-near-cheap', 39.7392, -104.972, 3.22, 'King Soopers'),
  ];
  const profile = {
    preferredBrands: ['Shell'],
    brandLoyalty: 0.6,
    visitHistory: [habitVisit('default-shell', timestampMs)],
    fillUpHistory: [
      { timestamp: timestampMs - 4 * 86400000, odometer: 15000, gallons: 11.5, pricePerGallon: 3.29 },
    ],
    estimatedMilesSinceLastFill: 250,
    typicalFillUpIntervalMiles: 280,
  };

  const result = recommend(window, profile, stations, {
    triggerThreshold: 0.45,
    minTripFuelIntentColdStart: 0.18,
    minTripFuelIntentWithHistory: 0.18,
    milesSinceLastFill: 250,
  });
  assert.ok(result, 'expected a recommendation candidate');
  assert.equal(result.presentation.surfaceNow, true);
  assert.equal(result.presentation.preferredSurface, 'live_activity');
  assert.equal(result.presentation.attentionState, 'traffic_light_pause');
});

test('gridlock keeps the recommendation deferred even if the station choice is correct', () => {
  const timestampMs = new Date('2026-04-14T17:45:00-04:00').getTime();
  const window = [
    ...buildLongStraightWindow(timestampMs - 90_000, 12),
    ...buildGridlockWindow(timestampMs),
  ];
  const stations = [
    station('default-shell', 39.74, -104.975, 3.59, 'Shell'),
    station('easy-right-near-cheap', 39.7392, -104.972, 3.19, 'King Soopers'),
  ];
  const profile = {
    preferredBrands: ['Shell'],
    brandLoyalty: 0.6,
    visitHistory: [habitVisit('default-shell', timestampMs)],
    fillUpHistory: [
      { timestamp: timestampMs - 4 * 86400000, odometer: 15000, gallons: 11.5, pricePerGallon: 3.29 },
    ],
    estimatedMilesSinceLastFill: 250,
    typicalFillUpIntervalMiles: 280,
  };

  const result = recommend(window, profile, stations, {
    triggerThreshold: 0.45,
    minTripFuelIntentColdStart: 0.18,
    minTripFuelIntentWithHistory: 0.18,
    milesSinceLastFill: 250,
  });
  if (result) {
    assert.equal(result.presentation.surfaceNow, false);
    assert.equal(result.presentation.attentionState, 'gridlock');
  } else {
    assert.equal(result, null);
  }
});

test('stateful recommender holds a pending recommendation until a traffic-light pause', () => {
  const timestampMs = new Date('2026-04-14T08:35:00-04:00').getTime();
  const rec = createPredictiveRecommender({
    cooldownMs: 60_000,
    triggerThreshold: 0.45,
    enforcePresentationTiming: true,
    minTripFuelIntentColdStart: 0.18,
    minTripFuelIntentWithHistory: 0.18,
  });
  const stations = [
    station('default-shell', 39.74, -104.975, 3.59, 'Shell'),
    station('easy-right-near-cheap', 39.7392, -104.972, 3.22, 'King Soopers'),
  ];
  const profile = {
    preferredBrands: ['Shell'],
    brandLoyalty: 0.6,
    visitHistory: [habitVisit('default-shell', timestampMs)],
    fillUpHistory: [
      { timestamp: timestampMs - 4 * 86400000, odometer: 15000, gallons: 11.5, pricePerGallon: 3.29 },
    ],
    estimatedMilesSinceLastFill: 250,
    typicalFillUpIntervalMiles: 280,
  };
  rec.setStations(stations);
  rec.setProfile(profile);

  const cruisingWindow = buildStoplightWindow(timestampMs - 10_000).slice(0, 7);
  let emitted = null;
  for (const sample of cruisingWindow) {
    emitted = rec.pushLocation(sample);
  }
  assert.equal(emitted, null);
  assert.ok(rec.getPendingRecommendation(), 'expected a pending recommendation while cruising');

  const stopWindowTail = [
    makeSample(39.74, -104.981, 0.6, timestampMs - 8_000),
    { ...makeSample(39.74, -104.9808, 0.2, timestampMs - 4_000), eventType: 'traffic_light' },
    { ...makeSample(39.74, -104.9808, 0.1, timestampMs), eventType: 'traffic_light' },
  ];
  for (const sample of stopWindowTail) {
    emitted = rec.pushLocation(sample) || emitted;
  }

  assert.ok(emitted, 'expected the pending recommendation to surface at the traffic light');
  assert.equal(emitted.stationId, 'easy-right-near-cheap');
  assert.equal(emitted.presentation.preferredSurface, 'live_activity');
});

test('recommend exports a per-station decision snapshot with native comparison signals', () => {
  const timestampMs = new Date('2026-04-14T08:30:00-04:00').getTime();
  const window = buildEastboundWindow(timestampMs);
  const stations = [
    station('default-shell', 39.74, -104.965, 3.59, 'Shell'),
    station('hard-left-cheap', 39.7414, -104.990, 3.19, 'Budget'),
    station('easy-right-near-cheap', 39.7392, -104.989, 3.22, 'King Soopers'),
  ];
  const profile = {
    preferredBrands: ['Shell'],
    brandLoyalty: 0.6,
    visitHistory: [habitVisit('default-shell', timestampMs)],
    fillUpHistory: [],
  };

  const result = recommend(window, profile, stations, {
    triggerThreshold: 0.5,
    urgency: 0.9,
    minTripFuelIntentColdStart: 0.2,
    minTripFuelIntentWithHistory: 0.2,
  });

  assert.ok(result?.decisionSnapshot, 'expected recommendation to include decisionSnapshot');
  assert.equal(result.decisionSnapshot.predictedDefaultStationId, 'default-shell');
  assert.equal(result.decisionSnapshot.recommendation.stationId, result.stationId);
  assert.ok(result.decisionSnapshot.candidateCount >= 2);

  const selectedCandidate = result.decisionSnapshot.candidates.find(candidate => candidate.selected);
  assert.ok(selectedCandidate, 'expected selected candidate to be marked in decisionSnapshot');
  assert.equal(selectedCandidate.stationId, result.stationId);
  assert.equal(typeof selectedCandidate.destinationProbability, 'number');
  assert.equal(typeof selectedCandidate.intentEvidence, 'number');
  assert.equal(typeof selectedCandidate.valueScore, 'number');
  assert.equal(typeof selectedCandidate.observedSkipScore, 'number');
  assert.equal(typeof selectedCandidate.predictedDefaultAligned, 'boolean');
});

test('stateful recommender emits decision snapshots before trigger gating', () => {
  const timestampMs = new Date('2026-04-14T08:35:00-04:00').getTime();
  const snapshots = [];
  const rec = createPredictiveRecommender({
    cooldownMs: 60_000,
    triggerThreshold: 0.45,
    minTripFuelIntentColdStart: 0.18,
    minTripFuelIntentWithHistory: 0.18,
    onDecisionSnapshot: snapshot => snapshots.push(snapshot),
  });
  const stations = [
    station('default-shell', 39.74, -104.975, 3.59, 'Shell'),
    station('easy-right-near-cheap', 39.7392, -104.972, 3.22, 'King Soopers'),
  ];
  const profile = {
    preferredBrands: ['Shell'],
    brandLoyalty: 0.6,
    visitHistory: [habitVisit('default-shell', timestampMs)],
    fillUpHistory: [
      { timestamp: timestampMs - 4 * 86400000, odometer: 15000, gallons: 11.5, pricePerGallon: 3.29 },
    ],
    estimatedMilesSinceLastFill: 250,
    typicalFillUpIntervalMiles: 280,
  };
  rec.setStations(stations);
  rec.setProfile(profile);

  for (const sample of buildStoplightWindow(timestampMs).slice(0, 7)) {
    rec.pushLocation(sample);
  }

  assert.ok(snapshots.length > 0, 'expected decision snapshots to be emitted');
  const lastSnapshot = snapshots[snapshots.length - 1];
  assert.ok(lastSnapshot.candidates.length >= 1);
  assert.equal(typeof lastSnapshot.tripFuelIntentScore, 'number');
  assert.equal(typeof lastSnapshot.candidates[0].destinationRank, 'number');
});
