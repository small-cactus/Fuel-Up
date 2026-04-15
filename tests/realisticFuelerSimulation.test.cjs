const test = require('node:test');
const assert = require('node:assert/strict');

const { createPredictiveRecommender } = require('../src/lib/predictiveRecommender.js');
const {
  SIM_STATIONS,
  simulateHiddenIntentStressBatch,
  simulateRealisticHiddenIntentBatch,
} = require('../src/lib/fuelerSimulation.js');

function makeEngine({ profile, onTrigger }) {
  const recommender = createPredictiveRecommender({
    onTrigger,
    cooldownMs: 60 * 1000,
    triggerThreshold: 0.5,
  });
  recommender.setStations(SIM_STATIONS);
  recommender.setProfile(profile);
  return recommender;
}

function summarizeNeedBuckets(routes) {
  const lowNeedRoutes = routes.filter(route => route.estimatedRemainingMiles != null && route.estimatedRemainingMiles <= 110);
  const highReserveRoutes = routes.filter(route => route.estimatedRemainingMiles != null && route.estimatedRemainingMiles >= 160);
  return {
    lowNeedCount: lowNeedRoutes.length,
    lowNeedStopRate: lowNeedRoutes.length
      ? Math.round((lowNeedRoutes.filter(route => route.expectsTrigger).length / lowNeedRoutes.length) * 100)
      : null,
    highReserveCount: highReserveRoutes.length,
    highReserveStopRate: highReserveRoutes.length
      ? Math.round((highReserveRoutes.filter(route => route.expectsTrigger).length / highReserveRoutes.length) * 100)
      : null,
  };
}

test('realistic hidden-intent sim keeps the same latent route world across history levels', () => {
  const runs = Object.fromEntries(
    ['none', 'light', 'rich'].map(historyLevel => [
      historyLevel,
      simulateRealisticHiddenIntentBatch({
        createEngineFn: makeEngine,
        applyNoise: true,
        noiseSeed: 4242,
        routeCount: 64,
        historyLevel,
      }),
    ])
  );

  const latentPlan = run => run.routes.map(route => ({
    templateId: route.templateId,
    purpose: route.purpose,
    scenario: route.scenario,
    expectsTrigger: route.expectsTrigger,
    targetStationId: route.targetStationId,
    hiddenDecisionIndex: route.hiddenDecisionIndex,
    startingMilesSinceLastFill: route.startingMilesSinceLastFill,
  }));

  assert.deepEqual(
    latentPlan(runs.none),
    latentPlan(runs.light),
    'light-history batch should evaluate the same latent route world as no-history'
  );
  assert.deepEqual(
    latentPlan(runs.none),
    latentPlan(runs.rich),
    'rich-history batch should evaluate the same latent route world as no-history'
  );

  assert.equal(runs.none.burnInRouteCount, 0);
  assert.ok(runs.light.burnInRouteCount >= 60, `expected light history to span months, got ${runs.light.burnInRouteCount} routes`);
  assert.ok(runs.rich.burnInRouteCount >= 180, `expected rich history to span multiple months, got ${runs.rich.burnInRouteCount} routes`);
  assert.equal(runs.none.historySpanDays, 0);
  assert.ok(runs.light.historySpanDays >= 60, `expected light history span >= 60 days, got ${runs.light.historySpanDays}`);
  assert.ok(runs.rich.historySpanDays >= 180, `expected rich history span >= 180 days, got ${runs.rich.historySpanDays}`);
  assert.ok(
    (runs.light.seedProfile.visitHistory || []).reduce((sum, entry) => sum + (Number(entry?.visitCount) || 0), 0) >
      (runs.none.seedProfile.visitHistory || []).reduce((sum, entry) => sum + (Number(entry?.visitCount) || 0), 0),
    'expected light history to learn more station visits than none',
  );
  assert.ok(
    (runs.rich.seedProfile.visitHistory || []).reduce((sum, entry) => sum + (Number(entry?.visitCount) || 0), 0) >
      (runs.light.seedProfile.visitHistory || []).reduce((sum, entry) => sum + (Number(entry?.visitCount) || 0), 0),
    'expected rich history to learn more station visits than light',
  );

  assert.ok(runs.none.summary.historyBuckets.none, 'expected none bucket to be populated');
  assert.ok(runs.light.summary.historyBuckets.light, 'expected light bucket to be populated');
  assert.ok(runs.rich.summary.historyBuckets.rich, 'expected rich bucket to be populated');
});

test('realistic hidden-intent sim produces a no-fuel majority and diverse trip purposes', () => {
  const result = simulateRealisticHiddenIntentBatch({
    createEngineFn: makeEngine,
    applyNoise: true,
    noiseSeed: 4242,
    routeCount: 96,
    historyLevel: 'none',
  });

  assert.ok(
    result.summary.noFuelCount > result.summary.hiddenIntentCount,
    `expected most drives to be non-fueling, got noFuel=${result.summary.noFuelCount} hidden=${result.summary.hiddenIntentCount}`,
  );
  assert.ok(
    result.summary.hiddenIntentCount >= 12 && result.summary.hiddenIntentCount <= 40,
    `expected realistic hidden-intent count between 12 and 40, got ${result.summary.hiddenIntentCount}`,
  );

  const purposeCount = new Set(result.routes.map(route => route.purpose)).size;
  const scenarioCount = Object.keys(result.summary.scenarioBreakdown).length;
  assert.ok(purposeCount >= 5, `expected at least 5 route purposes, got ${purposeCount}`);
  assert.ok(scenarioCount >= 4, `expected at least 4 route scenarios, got ${scenarioCount}`);
});

test('realistic hidden-intent sim increases stop propensity as remaining fuel drops', () => {
  const seeds = [101, 202, 404, 505];
  const aggregate = {
    lowNeedCount: 0,
    lowNeedStopCount: 0,
    highReserveCount: 0,
    highReserveStopCount: 0,
  };

  for (const seed of seeds) {
    const result = simulateRealisticHiddenIntentBatch({
      createEngineFn: makeEngine,
      applyNoise: true,
      noiseSeed: seed,
      routeCount: 96,
      historyLevel: 'none',
    });
    const bucketSummary = summarizeNeedBuckets(result.routes);
    aggregate.lowNeedCount += bucketSummary.lowNeedCount;
    aggregate.lowNeedStopCount += result.routes.filter(route => route.estimatedRemainingMiles != null && route.estimatedRemainingMiles <= 110 && route.expectsTrigger).length;
    aggregate.highReserveCount += bucketSummary.highReserveCount;
    aggregate.highReserveStopCount += result.routes.filter(route => route.estimatedRemainingMiles != null && route.estimatedRemainingMiles >= 160 && route.expectsTrigger).length;
  }

  const lowNeedStopRate = Math.round((aggregate.lowNeedStopCount / aggregate.lowNeedCount) * 100);
  const highReserveStopRate = Math.round((aggregate.highReserveStopCount / aggregate.highReserveCount) * 100);

  assert.ok(aggregate.lowNeedCount >= 18, `expected a meaningful low-need slice, got ${aggregate.lowNeedCount}`);
  assert.ok(aggregate.highReserveCount >= 50, `expected many high-reserve samples, got ${aggregate.highReserveCount}`);
  assert.ok(
    lowNeedStopRate >= highReserveStopRate + 8,
    `expected low-fuel stop rate to be materially higher than high-reserve stop rate, got low=${lowNeedStopRate}% high=${highReserveStopRate}%`,
  );
});

test('realistic hidden-intent sim exposes the same scorecard schema as the older stress suite', () => {
  const baseline = simulateHiddenIntentStressBatch({
    createEngineFn: makeEngine,
    applyNoise: true,
    noiseSeed: 4242,
    routeCount: 96,
    historyLevel: 'none',
  }).summary.scorecard;
  const realistic = simulateRealisticHiddenIntentBatch({
    createEngineFn: makeEngine,
    applyNoise: true,
    noiseSeed: 4242,
    routeCount: 96,
    historyLevel: 'none',
  }).summary.scorecard;

  assert.deepEqual(
    Object.keys(realistic).sort(),
    Object.keys(baseline).sort(),
    'expected realistic and legacy stress suites to emit the same scorecard keys'
  );

  console.log('[benchmark][realistic][none]', JSON.stringify(realistic));
  console.log('[benchmark][legacy-hidden][none]', JSON.stringify(baseline));
});
