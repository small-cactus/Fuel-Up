const test = require('node:test');
const assert = require('node:assert/strict');

const { createPredictiveRecommender } = require('../src/lib/predictiveRecommender.js');
const {
  SIM_STATIONS,
  simulateRealisticCohortBatch,
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

test('realistic cohort batch keeps the same latent route world across history levels', () => {
  const runs = Object.fromEntries(
    ['none', 'light', 'rich'].map(historyLevel => [
      historyLevel,
      simulateRealisticCohortBatch({
        createEngineFn: makeEngine,
        applyNoise: true,
        noiseSeed: 4242,
        driverCount: 4,
        routesPerDriver: 18,
        historyLevel,
      }),
    ])
  );

  const latentPlan = run => run.routes.map(route => ({
    driverId: route.driverId,
    driverArchetype: route.driverArchetype,
    templateId: route.templateId,
    purpose: route.purpose,
    scenario: route.scenario,
    expectsTrigger: route.expectsTrigger,
    targetStationId: route.targetStationId,
    hiddenDecisionIndex: route.hiddenDecisionIndex,
    weather: route.context.weather,
    trafficLevel: route.context.trafficLevel,
    occupancy: route.context.occupancy,
    visibleStationIds: route.context.visibleStationIds,
  }));

  assert.deepEqual(latentPlan(runs.none), latentPlan(runs.light));
  assert.deepEqual(latentPlan(runs.none), latentPlan(runs.rich));
  assert.equal(runs.none.evaluationRouteIndexOffset, runs.light.evaluationRouteIndexOffset);
  assert.equal(runs.none.evaluationRouteIndexOffset, runs.rich.evaluationRouteIndexOffset);
  assert.equal(runs.none.burnInRouteCountByLevel.none, 0);
  assert.ok(runs.light.burnInRouteCountByLevel.light >= 60);
  assert.ok(runs.rich.burnInRouteCountByLevel.rich >= 180);
  assert.ok(runs.light.drivers.every(driver => driver.historySpanDays >= 60), 'expected every light-history driver to span at least 60 days');
  assert.ok(runs.rich.drivers.every(driver => driver.historySpanDays >= 180), 'expected every rich-history driver to span at least 180 days');
  assert.ok(
    runs.light.drivers.every(driver =>
      (driver.seedProfile?.visitHistory || []).reduce((sum, entry) => sum + (Number(entry?.visitCount) || 0), 0) >
      0
    ),
    'expected light-history drivers to have learned visit history',
  );
  assert.ok(
    runs.rich.drivers.every((driver, index) =>
      (driver.seedProfile?.visitHistory || []).reduce((sum, entry) => sum + (Number(entry?.visitCount) || 0), 0) >=
      (runs.light.drivers[index]?.seedProfile?.visitHistory || []).reduce((sum, entry) => sum + (Number(entry?.visitCount) || 0), 0)
    ),
    'expected rich-history drivers to learn at least as much visit history as light-history drivers',
  );
  assert.ok(runs.none.summary.historyBuckets.none);
  assert.ok(runs.light.summary.historyBuckets.light);
  assert.ok(runs.rich.summary.historyBuckets.rich);
});

test('realistic cohort batch produces broad real-world context diversity and coherent exposure', () => {
  const result = simulateRealisticCohortBatch({
    createEngineFn: makeEngine,
    applyNoise: true,
    noiseSeed: 4242,
    driverCount: 6,
    routesPerDriver: 24,
    historyLevel: 'none',
  });

  assert.ok(result.routes.length === 144, `expected 144 routes, got ${result.routes.length}`);
  assert.ok(result.summary.noFuelCount > result.summary.hiddenIntentCount, 'expected non-fueling drives to remain the majority');
  assert.ok(Object.keys(result.summary.diagnostics.purposeDistribution).length >= 8, 'expected broad trip-purpose diversity');
  assert.ok(Object.keys(result.summary.diagnostics.trafficDistribution).length >= 3, 'expected multiple traffic states');
  assert.ok(Object.keys(result.summary.diagnostics.weatherDistribution).length >= 4, 'expected multiple weather states');
  assert.ok(Object.keys(result.summary.diagnostics.occupancyDistribution).length >= 3, 'expected solo/passenger/kids occupancy coverage');
  assert.ok(Object.keys(result.summary.diagnostics.archetypeDistribution).length >= 3, 'expected multiple driver archetypes');
  assert.ok(
    result.summary.diagnostics.avgVisibleStationCount >= 1.5 &&
    result.summary.diagnostics.avgVisibleStationCount <= 2.5,
    `expected realistic visible-station count, got ${result.summary.diagnostics.avgVisibleStationCount}`,
  );
  assert.equal(result.summary.diagnostics.visibleTargetCoverageRate, 100, 'expected every hidden target to remain inside visible station exposure');

  const kidRoutes = result.routes.filter(route => route.context.occupancy === 'kids');
  const snowRoutes = result.routes.filter(route => route.context.weather === 'snow');
  const nightLikeRoutes = result.routes.filter(route => route.context.hour >= 20);
  assert.ok(kidRoutes.length >= 12, `expected many family routes, got ${kidRoutes.length}`);
  assert.ok(snowRoutes.length >= 8, `expected weather adversity coverage, got ${snowRoutes.length}`);
  assert.ok(nightLikeRoutes.length >= 6, `expected some night routes, got ${nightLikeRoutes.length}`);
});

test('realistic cohort batch ties lower remaining fuel to materially higher hidden stop rate', () => {
  const seeds = [4242, 5252, 6262, 7272];
  let lowNeedRoutes = 0;
  let lowNeedStops = 0;
  let highReserveRoutes = 0;
  let highReserveStops = 0;

  for (const seed of seeds) {
    const result = simulateRealisticCohortBatch({
      createEngineFn: makeEngine,
      applyNoise: true,
      noiseSeed: seed,
      driverCount: 6,
      routesPerDriver: 24,
      historyLevel: 'none',
    });
    for (const route of result.routes) {
      if (route.estimatedRemainingMiles != null && route.estimatedRemainingMiles <= 120) {
        lowNeedRoutes += 1;
        if (route.expectsTrigger) lowNeedStops += 1;
      }
      if (route.estimatedRemainingMiles != null && route.estimatedRemainingMiles >= 240) {
        highReserveRoutes += 1;
        if (route.expectsTrigger) highReserveStops += 1;
      }
    }
  }

  const lowNeedRate = Math.round((lowNeedStops / lowNeedRoutes) * 100);
  const highReserveRate = Math.round((highReserveStops / highReserveRoutes) * 100);
  assert.ok(lowNeedRoutes >= 24, `expected a meaningful set of low-need routes, got ${lowNeedRoutes}`);
  assert.ok(highReserveRoutes >= 120, `expected many high-reserve routes, got ${highReserveRoutes}`);
  assert.ok(
    lowNeedRate >= highReserveRate + 8,
    `expected lower remaining fuel to materially raise hidden stop rate, got low=${lowNeedRate}% high=${highReserveRate}%`,
  );
});

test('realistic cohort benchmark exposes standardized scorecards and diagnostics', () => {
  const result = simulateRealisticCohortBatch({
    createEngineFn: makeEngine,
    applyNoise: true,
    noiseSeed: 4242,
    driverCount: 6,
    routesPerDriver: 24,
    historyLevel: 'none',
  });

  const scorecardKeys = [
    'accuracy',
    'precision',
    'recall',
    'falsePositiveRate',
    'silentRateWhenNoFuel',
    'wrongStationRate',
    'avgCorrectTriggerDistanceMeters',
    'precisionFirstScore',
    'hiddenIntentCount',
    'noFuelCount',
    'historyBuckets',
  ];
  assert.deepEqual(Object.keys(result.summary.scorecard), scorecardKeys);
  console.log('[benchmark][realistic-cohort][none]', JSON.stringify(result.summary.scorecard));
  console.log('[benchmark][realistic-cohort][diagnostics]', JSON.stringify(result.summary.diagnostics));
});

test('realistic cohort batch emits household/person/vehicle dimensions and fact tables', () => {
  const result = simulateRealisticCohortBatch({
    createEngineFn: makeEngine,
    applyNoise: true,
    noiseSeed: 4242,
    driverCount: 4,
    routesPerDriver: 18,
    historyLevel: 'none',
  });

  assert.equal(result.households.length, 4);
  assert.equal(result.persons.length, 4);
  assert.equal(result.vehicles.length, 4);
  assert.equal(result.decision_events.length, result.routes.length);
  assert.ok(result.candidate_stations.length >= result.routes.length, 'expected at least one candidate station per decision');
  assert.equal(result.transactions.length, result.summary.hiddenIntentCount, 'expected one transaction per true fueling decision');
  assert.equal(result.daily_vehicle_summary.length, result.routes.length, 'expected one vehicle-day summary per route record');

  const decisionIds = new Set(result.decision_events.map(row => row.decision_id));
  assert.equal(decisionIds.size, result.decision_events.length, 'decision ids should be unique');
  for (const route of result.routes) {
    assert.ok(route.decisionId, 'route should reference decision id');
    assert.ok(decisionIds.has(route.decisionId), 'route decision id should exist in decision_event table');
  }

  for (const transaction of result.transactions) {
    assert.ok(decisionIds.has(transaction.decision_id), 'transaction should map to a decision');
    assert.ok(transaction.gallons_bought > 0, 'transaction gallons should be positive');
  }
});

test('realistic cohort fact tables preserve observable vs latent separation and feasible candidate sets', () => {
  const result = simulateRealisticCohortBatch({
    createEngineFn: makeEngine,
    applyNoise: true,
    noiseSeed: 5252,
    driverCount: 4,
    routesPerDriver: 18,
    historyLevel: 'none',
  });

  for (const route of result.routes.slice(0, 20)) {
    const latentKeys = Object.keys(route.latentState || {});
    const observedKeys = Object.keys(route.observedState || {});
    assert.ok(latentKeys.every(key => key.startsWith('true_')), `latent keys must be true_* only, got ${latentKeys.join(',')}`);
    assert.ok(observedKeys.every(key => key.startsWith('observed_') || key === 'fuel_display_pct'), `observed keys must be observable-only, got ${observedKeys.join(',')}`);

    const routeCandidateStations = result.candidate_stations.filter(row => row.decision_id === route.decisionId);
    assert.ok(routeCandidateStations.length >= 1, 'each decision should have feasible candidate stations');
    const visibleIds = new Set(route.context.visibleStationIds);
    for (const candidate of routeCandidateStations) {
      assert.ok(visibleIds.has(candidate.station_id), 'candidate station must come from visible feasible exposure set');
      assert.equal(candidate.fuel_compatible_flag, 1, 'candidate should be fuel compatible');
      assert.equal(candidate.station_open_flag, true, 'candidate should be open');
    }
  }
});
