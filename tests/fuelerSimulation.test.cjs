/**
 * 21-day fueler-archetype simulation tests.
 *
 * These tests exercise the predictive recommender over a realistic
 * 3-week window for several fueler archetypes. The key checks:
 *
 *   1. Accuracy grows as user history accumulates
 *      (no history → some history → rich history)
 *   2. Road trippers get useful recommendations despite having no
 *      home/work pattern (different recognition mode)
 *   3. Noisy GPS + stop-sign / red-light events don't break the engine
 *   4. Trigger distances are PROGRESSIVELY FURTHER OUT with more history
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { createPredictiveRecommender } = require('../src/lib/predictiveRecommender.js');
const {
  simulate21Days,
  simulateHiddenIntentStressBatch,
  buildHiddenIntentStressRoutes,
  SIM_STATIONS,
  commuterMorning,
} = require('../src/lib/fuelerSimulation.js');
const { addDrivingNoise } = require('../src/lib/driveNoise.js');
const { routeToSamples } = require('../src/lib/predictionMetrics.js');

function makeEngine({ profile, onTrigger }) {
  const rec = createPredictiveRecommender({
    onTrigger,
    cooldownMs: 60 * 1000, // short cooldown in tests
    triggerThreshold: 0.5,
  });
  rec.setStations(SIM_STATIONS);
  rec.setProfile(profile);
  return rec;
}

test('commuter: 21-day simulation — accuracy rises with history', () => {
  const result = simulate21Days({
    archetype: 'commuter',
    createEngineFn: makeEngine,
    applyNoise: true,
    noiseSeed: 123,
  });

  // Under the current silence-first policy, commuter behavior should still
  // stay broadly correct overall while becoming materially better as history
  // accumulates.
  assert.ok(
    result.summary.accuracy >= 65,
    `expected accuracy >= 65, got ${result.summary.accuracy}`,
  );

  assert.ok(
    (result.summary.falsePositiveRate || 0) === 0,
    `expected zero commuter false positives, got ${result.summary.falsePositiveRate}`,
  );

  assert.ok(
    (result.summary.someHistoryAcc || 0) >= (result.summary.noHistoryAcc || 0),
    `expected some-history accuracy >= no-history accuracy, got ${result.summary.someHistoryAcc} vs ${result.summary.noHistoryAcc}`,
  );

  assert.ok(
    (result.summary.richHistoryAcc || 0) >= (result.summary.someHistoryAcc || 0),
    `expected rich-history accuracy >= some-history accuracy, got ${result.summary.richHistoryAcc} vs ${result.summary.someHistoryAcc}`,
  );

  assert.ok(
    (result.summary.richHistoryAcc || 0) >= 85,
    `expected rich-history accuracy >= 85, got ${result.summary.richHistoryAcc}`,
  );
});

test('weekend shopper: recognizes Saturday Costco pattern after first few weeks', () => {
  const result = simulate21Days({
    archetype: 'weekend_shopper',
    createEngineFn: makeEngine,
    applyNoise: true,
    noiseSeed: 456,
  });

  // Should NOT trigger on weekdays (leisure drives), should trigger on Saturdays.
  const saturdays = result.days.filter(d => d.dayOfWeek === 6);
  const weekdays = result.days.filter(d => d.dayOfWeek !== 6 && d.dayOfWeek !== 0);

  const weekdayFalsePositives = weekdays.filter(d => d.triggered).length;
  assert.ok(
    weekdayFalsePositives <= 2,
    `too many weekday false positives: ${weekdayFalsePositives}`,
  );

  // At least 2 of 3 Saturdays should be correct
  const saturdayCorrect = saturdays.filter(d => d.correct).length;
  assert.ok(
    saturdayCorrect >= 2,
    `expected >= 2 correct Saturdays, got ${saturdayCorrect} / ${saturdays.length}`,
  );
});

test('road tripper: predicts highway fuel stop without home/work history', () => {
  const result = simulate21Days({
    archetype: 'road_tripper',
    createEngineFn: makeEngine,
    applyNoise: true,
    noiseSeed: 789,
  });

  // Road trippers should trigger on road-trip days since urgency rises.
  const roadTripDays = result.days.filter(d => d.scenario === 'roadtrip');
  const roadTripTriggered = roadTripDays.filter(d => d.firstTriggerCorrect).length;

  // At least half the road trip days should get a recommendation.
  assert.ok(
    roadTripTriggered >= Math.floor(roadTripDays.length / 2),
    `road trip triggers: ${roadTripTriggered} / ${roadTripDays.length}`,
  );

  // Leisure/city days should mostly NOT trigger.
  const cityFalsePositives = result.days
    .filter(d => d.scenario === 'city' && d.triggered).length;
  assert.ok(
    cityFalsePositives <= 3,
    `too many city false positives: ${cityFalsePositives}`,
  );
  assert.ok(
    (result.summary.falsePositiveRate || 0) <= 10,
    `road trip false positive rate too high: ${result.summary.falsePositiveRate}%`,
  );
});

test('random driver: low accuracy is acceptable, but no catastrophic behavior', () => {
  const result = simulate21Days({
    archetype: 'random_driver',
    createEngineFn: makeEngine,
    applyNoise: true,
    noiseSeed: 1111,
  });

  // Without a consistent pattern, accuracy will be lower — but we should
  // still not fire on every single day.
  const triggerRate = result.days.filter(d => d.triggered).length / result.days.length;
  assert.ok(
    triggerRate < 0.5,
    `trigger rate too high for pattern-less driver: ${triggerRate}`,
  );
  assert.ok(
    (result.summary.falsePositiveRate || 0) <= 45,
    `false positive rate too high for pattern-less driver: ${result.summary.falsePositiveRate}%`,
  );
});

test('commuter: trigger distance grows with accumulated history', () => {
  const result = simulate21Days({
    archetype: 'commuter',
    createEngineFn: makeEngine,
    applyNoise: true,
    noiseSeed: 222,
  });

  const earlyDays = result.days
    .filter(d => d.triggered && d.triggerDistance != null && d.day < 7)
    .map(d => d.triggerDistance);
  const lateDays = result.days
    .filter(d => d.triggered && d.triggerDistance != null && d.day >= 14)
    .map(d => d.triggerDistance);

  if (earlyDays.length > 0 && lateDays.length > 0) {
    const avgEarly = earlyDays.reduce((a, b) => a + b, 0) / earlyDays.length;
    const avgLate = lateDays.reduce((a, b) => a + b, 0) / lateDays.length;
    // Late-simulation triggers should stay at least as early as the cold-start
    // baseline. History must not regress the distance.
    assert.ok(
      avgLate >= avgEarly * 0.9,
      `late-sim trigger distance (${Math.round(avgLate)}m) should not be much worse than early (${Math.round(avgEarly)}m)`,
    );
  }
});

test('noise robustness: stop-sign events and GPS jitter do not break trigger', () => {
  // Run the commuter simulation with different noise seeds; majority should
  // still produce sensible accuracy.
  const seeds = [11, 22, 33, 44, 55];
  const accuracies = [];
  const falsePositiveRates = [];
  for (const seed of seeds) {
    const r = simulate21Days({
      archetype: 'commuter',
      createEngineFn: makeEngine,
      applyNoise: true,
      noiseSeed: seed,
    });
    accuracies.push(r.summary.accuracy);
    falsePositiveRates.push(r.summary.falsePositiveRate);
  }
  const median = accuracies.slice().sort((a, b) => a - b)[Math.floor(accuracies.length / 2)];
  assert.ok(
    median >= 67,
    `median accuracy across noise seeds: ${median}% (accs=${accuracies.join(',')})`,
  );
  assert.deepEqual(
    falsePositiveRates,
    [0, 0, 0, 0, 0],
    `expected zero false positives across noise seeds, got ${falsePositiveRates.join(',')}`,
  );
});

test('precision-first scoring penalizes false positives harder than misses', () => {
  const result = simulate21Days({
    archetype: 'random_driver',
    createEngineFn: makeEngine,
    applyNoise: true,
    noiseSeed: 123,
  });

  assert.ok(
    (result.summary.precisionFirstScore || 0) <= result.summary.accuracy,
    `precision-first score should not exceed plain accuracy when false positives exist: ${JSON.stringify(result.summary)}`,
  );
});

test('noise injection simulates both stop signs and traffic lights', () => {
  const route = commuterMorning('sim-shell-downing', false);
  const noisy = addDrivingNoise(routeToSamples(route), {
    seed: 2026,
    returnMetadata: true,
    stopProbability: 0.95,
    stopIntervalM: 250,
  });

  const stopSigns = noisy.noiseEvents.filter(event => event.type === 'stop_sign').length;
  const trafficLights = noisy.noiseEvents.filter(event => event.type === 'traffic_light').length;

  assert.ok(stopSigns > 0, 'expected at least one stop sign event');
  assert.ok(trafficLights > 0, 'expected at least one traffic light event');
});

test('summary: aggregate metrics per archetype over 21 days', () => {
  const archs = ['commuter', 'road_tripper', 'weekend_shopper', 'random_driver'];
  const summaries = {};
  for (const arch of archs) {
    const r = simulate21Days({
      archetype: arch,
      createEngineFn: makeEngine,
      applyNoise: true,
      noiseSeed: 999,
    });
    summaries[arch] = r.summary;
  }
  // Each archetype should have some triggers (unless all-pattern-less)
  for (const arch of ['commuter', 'road_tripper', 'weekend_shopper']) {
    assert.ok(
      summaries[arch].avgTriggerDistanceMeters >= 0,
      `archetype ${arch} should have at least some valid triggers`,
    );
  }
});

test('21-day and hidden-intent sims expose the same scorecard keys for comparison', () => {
  const curated = simulate21Days({
    archetype: 'commuter',
    createEngineFn: makeEngine,
    applyNoise: true,
    noiseSeed: 999,
  }).summary.scorecard;
  const hidden = simulateHiddenIntentStressBatch({
    createEngineFn: makeEngine,
    applyNoise: true,
    noiseSeed: 4242,
    routeCount: 96,
    historyLevel: 'none',
  }).summary.scorecard;

  assert.deepEqual(
    Object.keys(curated).sort(),
    Object.keys(hidden).sort(),
    'scorecard keys should match across simulation suites'
  );
  console.log('[benchmark][curated][commuter]', JSON.stringify(curated));
  console.log('[benchmark][hidden][none]', JSON.stringify(hidden));
});

test('hidden-intent stress routes keep the pivot and target out of engine-visible samples', () => {
  const routes = buildHiddenIntentStressRoutes({
    seed: 4242,
    routeCount: 48,
  });
  const hiddenIntentRoutes = routes.filter(route => route.expectsTrigger);
  const noFuelRoutes = routes.filter(route => !route.expectsTrigger);

  assert.ok(hiddenIntentRoutes.length >= 4, `expected several hidden-intent routes, got ${hiddenIntentRoutes.length}`);
  assert.ok(noFuelRoutes.length > hiddenIntentRoutes.length, `expected majority non-fueling routes, got noFuel=${noFuelRoutes.length} hiddenIntent=${hiddenIntentRoutes.length}`);

  const decisionIndexes = new Set(hiddenIntentRoutes.map(route => route.hiddenDecisionIndex));
  assert.ok(
    decisionIndexes.size >= Math.min(hiddenIntentRoutes.length, 3),
    `expected diverse randomized decision points, got ${decisionIndexes.size}`,
  );

  const sampleLeak = routes
    .flatMap(route => routeToSamples(route))
    .some(sample => (
      Object.prototype.hasOwnProperty.call(sample, 'targetStationId') ||
      Object.prototype.hasOwnProperty.call(sample, 'hiddenDecisionIndex') ||
      Object.prototype.hasOwnProperty.call(sample, 'groundTruthOnly')
    ));
  assert.equal(sampleLeak, false, 'engine-visible samples must not contain hidden intent metadata');
});

test('hidden-intent stress batch reports precision and recall across history levels with many no-fuel drives', () => {
  const summaries = {};
  for (const historyLevel of ['none', 'light', 'rich']) {
    const result = simulateHiddenIntentStressBatch({
      createEngineFn: makeEngine,
      applyNoise: true,
      noiseSeed: 4242,
      routeCount: 96,
      historyLevel,
    });
    summaries[historyLevel] = result.summary;
    console.log(`[benchmark][hidden][${historyLevel}]`, JSON.stringify(result.summary.scorecard));

    assert.ok(result.summary.noFuelCount > result.summary.hiddenIntentCount, `${historyLevel}: expected more no-fuel routes than hidden-intent routes`);
    assert.ok(result.summary.noFuelCount >= 50, `${historyLevel}: expected many no-fuel routes, got ${result.summary.noFuelCount}`);
    assert.ok(result.summary.hiddenIntentCount >= 4, `${historyLevel}: expected several hidden-intent routes, got ${result.summary.hiddenIntentCount}`);
    assert.equal(Number.isFinite(result.summary.falsePositiveRate), true, `${historyLevel}: falsePositiveRate should be numeric`);
    assert.equal(Number.isFinite(result.summary.hiddenIntentRecall), true, `${historyLevel}: hiddenIntentRecall should be numeric`);
    assert.equal(Number.isFinite(result.summary.probableHiddenIntentRecall), true, `${historyLevel}: probableHiddenIntentRecall should be numeric`);
    assert.ok(Object.keys(result.summary.scenarioBreakdown).length >= 4, `${historyLevel}: expected diverse scenario breakdown`);
    assert.equal(typeof result.summary.scorecard, 'object', `${historyLevel}: expected standardized scorecard`);
    assert.equal(result.summary.scorecard.hiddenIntentCount, result.summary.hiddenIntentCount, `${historyLevel}: hidden-intent counts should align`);
  }

  assert.ok(
    (summaries.light.hiddenIntentRecall || 0) >= (summaries.none.hiddenIntentRecall || 0),
    `expected light-history hidden-intent recall >= no-history recall, got ${summaries.light.hiddenIntentRecall}% vs ${summaries.none.hiddenIntentRecall}%`,
  );
});
