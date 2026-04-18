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

function exposureHistoryEntry(stationId, exposureCount, contextCounts = {}) {
  return {
    stationId,
    exposureCount,
    lastExposureMs: Date.now() - 3_600_000,
    contextCounts: {
      total: exposureCount,
      highway: 0,
      suburban: 0,
      city: exposureCount,
      city_grid: 0,
      weekday: exposureCount,
      weekend: 0,
      morning: exposureCount,
      midday: 0,
      evening: 0,
      night: 0,
      ...contextCounts,
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

test('recommender can surface a single visible routine stop when history is diffuse but corridor conversion is strong', () => {
  const timestampMs = new Date('2026-04-14T08:30:00-04:00').getTime();
  const window = buildLongStraightWindow(timestampMs, 16);
  const stations = [
    station('routine-stop', 39.74, -104.955, 3.39, 'Circle K'),
  ];
  const profile = {
    preferredBrands: ['Circle K'],
    brandLoyalty: 0.4,
    visitHistory: [
      {
        stationId: 'routine-stop',
        visitCount: 2,
        lastVisitMs: timestampMs - 86_400_000,
        visitTimestamps: [
          timestampMs - 86_400_000,
          timestampMs - (3 * 86_400_000),
        ],
        contextCounts: {
          total: 2,
          highway: 0,
          suburban: 0,
          city: 2,
          city_grid: 0,
          weekday: 2,
          weekend: 0,
          morning: 2,
          midday: 0,
          evening: 0,
          night: 0,
        },
      },
      habitVisit('other-a', timestampMs, 2),
      habitVisit('other-b', timestampMs, 2),
      habitVisit('other-c', timestampMs, 2),
    ],
    exposureHistory: [
      exposureHistoryEntry('routine-stop', 10, { city: 10, morning: 8, midday: 2 }),
      exposureHistoryEntry('other-a', 10, { city: 6, suburban: 4, morning: 4, midday: 5, evening: 1, weekday: 7, weekend: 3 }),
    ],
    fillUpHistory: [
      { timestamp: timestampMs - (3 * 86_400_000), odometer: 15000, gallons: 8.5, pricePerGallon: 3.25 },
    ],
    estimatedMilesSinceLastFill: 165,
    typicalFillUpIntervalMiles: 310,
  };

  const result = recommend(window, profile, stations, {
    triggerThreshold: 0.5,
    minTripFuelIntentColdStart: 0.18,
    minTripFuelIntentWithHistory: 0.18,
    milesSinceLastFill: 165,
  });

  assert.ok(result, 'expected a recommendation');
  assert.equal(result.stationId, 'routine-stop');
  assert.equal(result.type, 'predicted_stop');
  assert.match(result.reason, /Observed routine stop ahead|Routine stop ahead/);
});

test('recommender can use route habit support for a single visible routine stop when timing history is weak', () => {
  const timestampMs = new Date('2026-04-14T08:30:00-04:00').getTime();
  const window = buildLongStraightWindow(timestampMs, 16);
  const stations = [
    {
      ...station('route-stop', 39.74, -104.955, 3.41, 'Circle K'),
      simulationRouteContext: {
        routeHabitKeys: ['template:weekday-commute'],
      },
    },
  ];
  const profile = {
    preferredBrands: ['Circle K'],
    brandLoyalty: 0.2,
    visitHistory: [
      {
        stationId: 'route-stop',
        visitCount: 2,
        lastVisitMs: timestampMs - (3 * 86_400_000),
        visitTimestamps: [
          new Date('2026-04-12T19:10:00-04:00').getTime(),
          new Date('2026-04-05T18:40:00-04:00').getTime(),
        ],
        contextCounts: {
          total: 2,
          highway: 0,
          suburban: 2,
          city: 0,
          city_grid: 0,
          weekday: 0,
          weekend: 2,
          morning: 0,
          midday: 0,
          evening: 2,
          night: 0,
        },
      },
      habitVisit('other-a', timestampMs, 8),
      habitVisit('other-b', timestampMs, 8),
    ],
    exposureHistory: [
      exposureHistoryEntry('route-stop', 6, {
        city: 3,
        suburban: 3,
        weekday: 2,
        weekend: 4,
        morning: 1,
        midday: 0,
        evening: 4,
        night: 1,
      }),
      exposureHistoryEntry('other-a', 14, {
        city: 6,
        suburban: 8,
        weekday: 10,
        weekend: 4,
        morning: 5,
        midday: 2,
        evening: 7,
      }),
    ],
    routeStationHabits: {
      'template:weekday-commute': {
        'route-stop': {
          count: 9,
          lastVisitMs: timestampMs - 86_400_000,
        },
        'other-station': {
          count: 2,
          lastVisitMs: timestampMs - (5 * 86_400_000),
        },
      },
    },
    fillUpHistory: [
      { timestamp: timestampMs - (3 * 86_400_000), odometer: 15000, gallons: 8.5, pricePerGallon: 3.25 },
    ],
    estimatedMilesSinceLastFill: 175,
    typicalFillUpIntervalMiles: 310,
  };

  const result = recommend(window, profile, stations, {
    triggerThreshold: 0.5,
    minTripFuelIntentColdStart: 0.18,
    minTripFuelIntentWithHistory: 0.18,
    milesSinceLastFill: 175,
  });

  assert.ok(result, 'expected a recommendation');
  assert.equal(result.stationId, 'route-stop');
  assert.equal(result.type, 'predicted_stop');
  assert.match(result.reason, /Routine stop ahead|Anchored routine stop ahead/);
  assert.ok(
    (result.decisionSnapshot.candidates[0]?.routeHabitShare || 0) >= 0.34,
    `expected route habit support to be present, got ${result.decisionSnapshot.candidates[0]?.routeHabitShare}`,
  );
});

test('stateful recommender blocks a one-station routine leak when route-family skip evidence is overwhelmingly negative', () => {
  const timestampMs = new Date('2026-04-14T08:30:00-04:00').getTime();
  const window = buildLongStraightWindow(timestampMs, 16);
  const routeHabitKeys = [
    'template:weekday-commute',
    'purpose_scenario:commute:city',
    'purpose:commute',
  ];
  const stations = [
    {
      ...station('route-stop', 39.74, -104.955, 3.41, 'Circle K'),
      simulationRouteContext: {
        routeHabitKeys,
      },
    },
  ];
  const profile = {
    preferredBrands: ['Circle K'],
    brandLoyalty: 0.2,
    visitHistory: [
      {
        stationId: 'route-stop',
        visitCount: 3,
        lastVisitMs: timestampMs - 86_400_000,
        visitTimestamps: [
          timestampMs - 86_400_000,
          timestampMs - (2 * 86_400_000),
          timestampMs - (3 * 86_400_000),
        ],
        contextCounts: {
          total: 3,
          highway: 0,
          suburban: 0,
          city: 3,
          city_grid: 0,
          weekday: 3,
          weekend: 0,
          morning: 3,
          midday: 0,
          evening: 0,
          night: 0,
        },
      },
      habitVisit('other-a', timestampMs, 2),
      habitVisit('other-b', timestampMs, 2),
    ],
    exposureHistory: [
      exposureHistoryEntry('route-stop', 14, {
        city: 14,
        weekday: 14,
        morning: 14,
      }),
    ],
    routeStationHabits: Object.fromEntries(
      routeHabitKeys.map(key => [key, {
        'route-stop': {
          count: 3,
          lastVisitMs: timestampMs - 86_400_000,
        },
      }])
    ),
    routeStationExposures: Object.fromEntries(
      routeHabitKeys.map(key => [key, {
        'route-stop': {
          count: 14,
          lastExposureMs: timestampMs - 86_400_000,
        },
      }])
    ),
    fillUpHistory: [
      { timestamp: timestampMs - (3 * 86_400_000), odometer: 15000, gallons: 8.5, pricePerGallon: 3.25 },
    ],
    estimatedMilesSinceLastFill: 175,
    typicalFillUpIntervalMiles: 310,
  };
  const evaluations = [];
  const rec = createPredictiveRecommender({
    cooldownMs: 60_000,
    triggerThreshold: 0.5,
    minTripFuelIntentColdStart: 0.18,
    minTripFuelIntentWithHistory: 0.18,
    onRecommendationEvaluation: evaluation => evaluations.push(evaluation),
  });
  rec.setStations(stations);
  rec.setProfile(profile);

  let emitted = null;
  for (const sample of window) {
    emitted = rec.pushLocation(sample) || emitted;
  }

  assert.equal(emitted, null);
  assert.ok(
    evaluations.some(evaluation => evaluation.status === 'blocked_route_observed_routine_leak'),
    `expected route-observed routine leak block, got ${evaluations.map(evaluation => evaluation.status).join(', ')}`,
  );
});

test('recommender keeps a route-habit fallback routine stop silent when probability stays weak', () => {
  const timestampMs = new Date('2026-04-14T08:30:00-04:00').getTime();
  const window = buildLongStraightWindow(timestampMs, 14);
  const stations = [
    {
      ...station('route-stop', 39.74, -104.955, 3.39, 'Circle K'),
      simulationRouteContext: {
        routeHabitKeys: [
          'template:weekday-commute',
          'purpose_scenario:commute:city',
          'purpose:commute',
        ],
      },
    },
  ];
  const profile = {
    preferredBrands: [],
    brandLoyalty: 0.1,
    visitHistory: [
      habitVisit('route-stop', timestampMs, 4),
      habitVisit('other-a', timestampMs, 12),
      habitVisit('other-b', timestampMs, 10),
    ],
    exposureHistory: [
      exposureHistoryEntry('route-stop', 30, {
        city: 30,
        weekday: 30,
        morning: 30,
      }),
      exposureHistoryEntry('other-a', 14, {
        city: 14,
        weekday: 14,
        morning: 14,
      }),
      exposureHistoryEntry('other-b', 12, {
        city: 12,
        weekday: 12,
        morning: 12,
      }),
    ],
    routeStationHabits: {
      'template:weekday-commute': {
        'route-stop': {
          count: 9,
          lastVisitMs: timestampMs - 86_400_000,
        },
        'other-station': {
          count: 2,
          lastVisitMs: timestampMs - (5 * 86_400_000),
        },
      },
    },
    fillUpHistory: [
      { timestamp: timestampMs - (3 * 86_400_000), odometer: 15000, gallons: 8.5, pricePerGallon: 3.25 },
    ],
    estimatedMilesSinceLastFill: 110,
    typicalFillUpIntervalMiles: 310,
  };

  const result = recommend(window, profile, stations, {
    triggerThreshold: 0.5,
    minTripFuelIntentColdStart: 0.18,
    minTripFuelIntentWithHistory: 0.18,
    milesSinceLastFill: 110,
  });

  assert.equal(result, null);
});

test('recommender can recover a multi-candidate routine stop from observed conversion behavior', () => {
  const timestampMs = new Date('2026-04-14T08:30:00-04:00').getTime();
  const window = buildLongStraightWindow(timestampMs, 16);
  const stations = [
    station('routine-stop', 39.74, -104.955, 3.39, 'Circle K'),
    station('cheap-passby', 39.7395, -104.958, 3.29, 'Budget'),
    station('other-stop', 39.7397, -104.952, 3.42, 'Shell'),
  ];
  const profile = {
    preferredBrands: ['Circle K'],
    brandLoyalty: 0.2,
    visitHistory: [
      {
        stationId: 'routine-stop',
        visitCount: 6,
        lastVisitMs: timestampMs - 86_400_000,
        visitTimestamps: [
          timestampMs - 86_400_000,
          timestampMs - (2 * 86_400_000),
          timestampMs - (3 * 86_400_000),
        ],
        contextCounts: {
          total: 6,
          highway: 0,
          suburban: 0,
          city: 6,
          city_grid: 0,
          weekday: 6,
          weekend: 0,
          morning: 5,
          midday: 1,
          evening: 0,
          night: 0,
        },
      },
      habitVisit('other-a', timestampMs, 4),
      habitVisit('other-b', timestampMs, 4),
    ],
    exposureHistory: [
      exposureHistoryEntry('routine-stop', 16, { city: 16, morning: 12, midday: 4 }),
      exposureHistoryEntry('cheap-passby', 18, { city: 18, morning: 14, midday: 4 }),
      exposureHistoryEntry('other-stop', 12, { city: 12, morning: 8, midday: 4 }),
      exposureHistoryEntry('other-a', 10, { city: 6, suburban: 4, morning: 4, midday: 5, evening: 1, weekday: 7, weekend: 3 }),
    ],
    fillUpHistory: [
      { timestamp: timestampMs - (3 * 86_400_000), odometer: 15000, gallons: 8.5, pricePerGallon: 3.25 },
    ],
    estimatedMilesSinceLastFill: 180,
    typicalFillUpIntervalMiles: 310,
  };

  const result = recommend(window, profile, stations, {
    triggerThreshold: 0.5,
    minTripFuelIntentColdStart: 0.18,
    minTripFuelIntentWithHistory: 0.18,
    milesSinceLastFill: 180,
  });

  assert.ok(result, 'expected a recommendation');
  assert.equal(result.decisionSnapshot.predictedDefaultStationId, 'routine-stop');
  assert.ok(
    result.stationId === 'routine-stop' || result.stationId === 'cheap-passby',
    `expected recovered routine default or cheaper alternative, got ${result.stationId}`,
  );
  if (result.stationId === 'routine-stop') {
    assert.equal(result.type, 'predicted_stop');
    assert.match(result.reason, /Observed routine stop ahead|Predicted stop/);
  } else {
    assert.equal(result.type, 'cheaper_alternative');
    assert.equal(result.predictedDefault, 'routine-stop');
  }
});

test('recommender can rescue an anchored single-candidate corridor stop with strong learned timing support', () => {
  const timestampMs = new Date('2026-04-14T13:30:00-04:00').getTime();
  const window = buildShortCityWindow(timestampMs, 14);
  const stations = [
    station('anchored-stop', 39.74, -104.945, 3.35, 'Circle K'),
  ];
  const profile = {
    preferredBrands: ['Circle K'],
    brandLoyalty: 0.2,
    visitHistory: [
      {
        stationId: 'anchored-stop',
        visitCount: 6,
        lastVisitMs: timestampMs - 86_400_000,
        visitTimestamps: [
          timestampMs - 86_400_000,
          timestampMs - (2 * 86_400_000),
          timestampMs - (7 * 86_400_000),
        ],
        contextCounts: {
          total: 6,
          highway: 0,
          suburban: 0,
          city: 6,
          city_grid: 0,
          weekday: 5,
          weekend: 1,
          morning: 0,
          midday: 5,
          evening: 1,
          night: 0,
        },
      },
      {
        stationId: 'other-routine',
        visitCount: 6,
        lastVisitMs: timestampMs - (2 * 86_400_000),
        visitTimestamps: [
          timestampMs - (2 * 86_400_000),
          timestampMs - (5 * 86_400_000),
          timestampMs - (9 * 86_400_000),
        ],
        contextCounts: {
          total: 6,
          highway: 0,
          suburban: 2,
          city: 4,
          city_grid: 0,
          weekday: 4,
          weekend: 2,
          morning: 3,
          midday: 1,
          evening: 2,
          night: 0,
        },
      },
    ],
    exposureHistory: [
      exposureHistoryEntry('anchored-stop', 8, { city: 8, weekday: 7, weekend: 1, midday: 6, evening: 2 }),
      exposureHistoryEntry('other-routine', 14, { city: 8, suburban: 6, weekday: 10, weekend: 4, morning: 7, midday: 3, evening: 4 }),
    ],
    fillUpHistory: [
      { timestamp: timestampMs - (3 * 86_400_000), odometer: 15000, gallons: 8.6, pricePerGallon: 3.25 },
    ],
    estimatedMilesSinceLastFill: 145,
    typicalFillUpIntervalMiles: 300,
  };

  const result = recommend(window, profile, stations, {
    triggerThreshold: 0.5,
    minTripFuelIntentColdStart: 0.18,
    minTripFuelIntentWithHistory: 0.18,
    milesSinceLastFill: 145,
  });

  assert.ok(result, 'expected an anchored learned-corridor recommendation');
  assert.equal(result.stationId, 'anchored-stop');
  assert.equal(result.type, 'predicted_stop');
  assert.match(result.reason, /Anchored routine stop ahead|Routine stop ahead/);
});

test('recommender does not rely on anchored single-candidate recovery without strong timing support', () => {
  const timestampMs = new Date('2026-04-14T13:30:00-04:00').getTime();
  const window = buildShortCityWindow(timestampMs, 14);
  const stations = [
    station('anchored-stop', 39.74, -104.945, 3.35, 'Circle K'),
  ];
  const profile = {
    preferredBrands: ['Circle K'],
    brandLoyalty: 0.2,
    visitHistory: [
      {
        stationId: 'anchored-stop',
        visitCount: 4,
        lastVisitMs: timestampMs - 86_400_000,
        visitTimestamps: [
          timestampMs - 86_400_000,
          timestampMs - (2 * 86_400_000),
          timestampMs - (7 * 86_400_000),
        ],
        contextCounts: {
          total: 4,
          highway: 0,
          suburban: 2,
          city: 2,
          city_grid: 0,
          weekday: 2,
          weekend: 2,
          morning: 2,
          midday: 0,
          evening: 2,
          night: 0,
        },
      },
      {
        stationId: 'other-routine',
        visitCount: 8,
        lastVisitMs: timestampMs - (2 * 86_400_000),
        visitTimestamps: [
          timestampMs - (2 * 86_400_000),
          timestampMs - (5 * 86_400_000),
          timestampMs - (9 * 86_400_000),
        ],
        contextCounts: {
          total: 8,
          highway: 0,
          suburban: 2,
          city: 6,
          city_grid: 0,
          weekday: 6,
          weekend: 2,
          morning: 3,
          midday: 2,
          evening: 2,
          night: 0,
        },
      },
    ],
    exposureHistory: [
      exposureHistoryEntry('anchored-stop', 12, { city: 12, weekday: 9, weekend: 3, midday: 5, evening: 3, morning: 4 }),
      exposureHistoryEntry('other-routine', 14, { city: 8, suburban: 6, weekday: 10, weekend: 4, morning: 7, midday: 3, evening: 4 }),
    ],
    fillUpHistory: [
      { timestamp: timestampMs - (3 * 86_400_000), odometer: 15000, gallons: 8.6, pricePerGallon: 3.25 },
    ],
    estimatedMilesSinceLastFill: 145,
    typicalFillUpIntervalMiles: 300,
  };

  const result = recommend(window, profile, stations, {
    triggerThreshold: 0.5,
    minTripFuelIntentColdStart: 0.18,
    minTripFuelIntentWithHistory: 0.18,
    milesSinceLastFill: 145,
  });

  assert.ok(result, 'expected fallback recommendation path to remain available');
  assert.doesNotMatch(result.reason, /Anchored routine stop ahead/);
});

test('recommender keeps an observed routine stop silent when fuel need is still low', () => {
  const timestampMs = new Date('2026-04-14T08:30:00-04:00').getTime();
  const window = buildLongStraightWindow(timestampMs, 16);
  const stations = [
    station('routine-stop', 39.74, -104.955, 3.39, 'Circle K'),
    station('cheap-passby', 39.7395, -104.958, 3.29, 'Budget'),
  ];
  const profile = {
    preferredBrands: ['Circle K'],
    brandLoyalty: 0.2,
    visitHistory: [
      {
        stationId: 'routine-stop',
        visitCount: 6,
        lastVisitMs: timestampMs - 86_400_000,
        visitTimestamps: [
          timestampMs - 86_400_000,
          timestampMs - (2 * 86_400_000),
          timestampMs - (3 * 86_400_000),
        ],
        contextCounts: {
          total: 6,
          highway: 0,
          suburban: 0,
          city: 6,
          city_grid: 0,
          weekday: 6,
          weekend: 0,
          morning: 5,
          midday: 1,
          evening: 0,
          night: 0,
        },
      },
      habitVisit('other-a', timestampMs, 4),
      habitVisit('other-b', timestampMs, 4),
    ],
    exposureHistory: [
      exposureHistoryEntry('routine-stop', 16, { city: 16, morning: 12, midday: 4 }),
      exposureHistoryEntry('cheap-passby', 18, { city: 18, morning: 14, midday: 4 }),
      exposureHistoryEntry('other-a', 10, { city: 6, suburban: 4, morning: 4, midday: 5, evening: 1, weekday: 7, weekend: 3 }),
    ],
    fillUpHistory: [
      { timestamp: timestampMs - (2 * 86_400_000), odometer: 15000, gallons: 9.1, pricePerGallon: 3.35 },
    ],
    estimatedMilesSinceLastFill: 70,
    typicalFillUpIntervalMiles: 310,
  };

  const result = recommend(window, profile, stations, {
    triggerThreshold: 0.5,
    minTripFuelIntentColdStart: 0.18,
    minTripFuelIntentWithHistory: 0.18,
    milesSinceLastFill: 70,
  });

  assert.equal(result, null);
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
    pendingRecommendationMinReleaseDistanceMeters: 0,
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

test('stateful recommender drops a pending recommendation when the current snapshot no longer supports that station', () => {
  const timestampMs = new Date('2026-04-14T08:35:00-04:00').getTime();
  const evaluations = [];
  const rec = createPredictiveRecommender({
    cooldownMs: 60_000,
    triggerThreshold: 0.45,
    enforcePresentationTiming: true,
    minTripFuelIntentColdStart: 0.18,
    minTripFuelIntentWithHistory: 0.18,
    pendingRecommendationMinReleaseDistanceMeters: 0,
    pendingRecommendationMaxAgeMs: 120_000,
    onRecommendationEvaluation: evaluation => evaluations.push(evaluation),
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

  rec.setStations([]);
  const stopWindowTail = [
    { ...makeSample(39.74, -104.9898, 0.2, timestampMs - 2_000), eventType: 'traffic_light' },
    { ...makeSample(39.74, -104.9898, 0.1, timestampMs), eventType: 'traffic_light' },
  ];
  for (const sample of stopWindowTail) {
    emitted = rec.pushLocation(sample) || emitted;
  }

  assert.equal(emitted, null);
  assert.equal(rec.getPendingRecommendation(), null);
  assert.ok(
    evaluations.some(evaluation => String(evaluation.status || '').startsWith('dropped_pending')),
    'expected the stale pending recommendation to be dropped instead of triggered',
  );
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
  assert.equal(typeof selectedCandidate.routeObservedSupport, 'number');
  assert.equal(typeof selectedCandidate.observedBehaviorStrength, 'number');
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

test('stateful recommender emits evaluation statuses for consistency and presentation gating', () => {
  const timestampMs = new Date('2026-04-14T08:35:00-04:00').getTime();
  const evaluations = [];
  const rec = createPredictiveRecommender({
    cooldownMs: 60_000,
    triggerThreshold: 0.45,
    enforcePresentationTiming: true,
    minTripFuelIntentColdStart: 0.18,
    minTripFuelIntentWithHistory: 0.18,
    onRecommendationEvaluation: evaluation => evaluations.push(evaluation),
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

  assert.ok(
    evaluations.some(evaluation => evaluation.status === 'deferred_presentation'),
    'expected at least one presentation-deferred evaluation',
  );
  assert.ok(
    evaluations.some(evaluation =>
      evaluation.status === 'blocked_consistency' ||
      evaluation.status === 'deferred_presentation'
    ),
    'expected at least one gated evaluation status',
  );
});

test('recommend emits suppression diagnostics when a viable-looking cold-start stop is still rejected', () => {
  const timestampMs = new Date('2026-04-14T18:00:00-04:00').getTime();
  const window = buildLongStraightWindow(timestampMs, 16);
  const stations = [
    station('need-stop', 39.74, -104.955, 3.39, 'Circle K'),
  ];
  const profile = {
    preferredBrands: [],
    brandLoyalty: 0,
    visitHistory: [],
    fillUpHistory: [
      { timestamp: timestampMs - (3 * 86_400_000), odometer: 15000, gallons: 10.5, pricePerGallon: 3.25 },
      { timestamp: timestampMs - (10 * 86_400_000), odometer: 14710, gallons: 10.2, pricePerGallon: 3.19 },
    ],
    estimatedMilesSinceLastFill: 255,
    typicalFillUpIntervalMiles: 280,
  };
  const suppressions = [];

  const result = recommend(window, profile, stations, {
    triggerThreshold: 0.5,
    minTripFuelIntentColdStart: 0.18,
    minTripFuelIntentWithHistory: 0.18,
    milesSinceLastFill: 255,
    onRecommendationSuppressed: suppression => suppressions.push(suppression),
  });

  assert.equal(result, null);
  assert.ok(suppressions.length >= 1, 'expected at least one suppression diagnostic');
  assert.equal(suppressions.at(-1).reason, 'predicted_stop_below_probability_or_confidence');
  assert.equal(suppressions.at(-1).predictedDefaultStationId, 'need-stop');
});
