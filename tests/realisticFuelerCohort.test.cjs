const test = require('node:test');
const assert = require('node:assert/strict');

const { createPredictiveRecommender } = require('../src/lib/predictiveRecommender.js');
const {
  SIM_STATIONS,
  simulateRealisticCohortBatch,
} = require('../src/lib/fuelerSimulation.js');

function makeEngine({
  profile,
  onTrigger,
  onDecisionSnapshot,
  onRecommendationEvaluation,
  onRecommendationSuppressed,
  onRecommendationSkipped,
}) {
  const recommender = createPredictiveRecommender({
    onTrigger,
    onDecisionSnapshot,
    onRecommendationEvaluation,
    onRecommendationSuppressed,
    onRecommendationSkipped,
    cooldownMs: 60 * 1000,
    triggerThreshold: 0.5,
    enforcePresentationTiming: true,
  });
  recommender.setStations(SIM_STATIONS);
  recommender.setProfile(profile);
  return recommender;
}

function routeIsActualFuelingStop(route) {
  return typeof route?.willFuel === 'boolean'
    ? route.willFuel
    : Boolean(route?.expectsTrigger);
}

function routeActualTargetStationId(route) {
  return route?.actualFuelStopStationId || route?.targetStationId || null;
}

function computeRepeatedRouteTargetConcentration(run) {
  const groups = new Map();
  for (const route of run.routes) {
    if (!routeIsActualFuelingStop(route) || !routeActualTargetStationId(route)) continue;
    const key = `${route.driverId}::${route.templateId}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(routeActualTargetStationId(route));
  }

  const concentrations = [];
  for (const targetIds of groups.values()) {
    if (targetIds.length < 2) continue;
    const counts = targetIds.reduce((map, stationId) => {
      map.set(stationId, (map.get(stationId) || 0) + 1);
      return map;
    }, new Map());
    const maxShare = Math.max(...counts.values()) / targetIds.length;
    concentrations.push(maxShare);
  }

  if (!concentrations.length) return 0;
  return concentrations.reduce((sum, value) => sum + value, 0) / concentrations.length;
}

test('realistic cohort batch keeps the same route context world across history levels while allowing habit-dependent choices', () => {
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
    weather: route.context.weather,
    trafficLevel: route.context.trafficLevel,
    occupancy: route.context.occupancy,
  }));

  assert.deepEqual(latentPlan(runs.none), latentPlan(runs.light));
  assert.deepEqual(latentPlan(runs.none), latentPlan(runs.rich));
  assert.equal(runs.none.evaluationRouteIndexOffset, runs.light.evaluationRouteIndexOffset);
  assert.equal(runs.none.evaluationRouteIndexOffset, runs.rich.evaluationRouteIndexOffset);
  const matchedOutcomeCount = runs.none.routes.reduce((count, route, index) => {
    const lightRoute = runs.light.routes[index];
    return count + (
      routeIsActualFuelingStop(route) === routeIsActualFuelingStop(lightRoute) &&
      routeActualTargetStationId(route) === routeActualTargetStationId(lightRoute)
        ? 1
        : 0
    );
  }, 0);
  assert.ok(
    matchedOutcomeCount < runs.none.routes.length,
    'expected at least some latent station choices or stop decisions to differ once history is introduced',
  );
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
  assert.ok(
    runs.rich.drivers.every(driver =>
      Object.keys(driver.seedProfile?.routeStationHabits || {}).every(key => !/^template:.*-\d+$/.test(key))
    ),
    'expected route-habit template keys to stay on stable template families, not per-route instance ids',
  );
  assert.ok(runs.none.summary.historyBuckets.none);
  assert.ok(runs.light.summary.historyBuckets.light);
  assert.ok(runs.rich.summary.historyBuckets.rich);
});

test('realistic cohort learned history increases repeated-route station consistency over no-history', () => {
  const seeds = [4242, 5252, 6262];
  const concentrationByHistoryLevel = Object.fromEntries(
    ['none', 'light', 'rich'].map(historyLevel => {
      const averageConcentration = seeds.reduce((sum, seed) => {
        const run = simulateRealisticCohortBatch({
          createEngineFn: makeEngine,
          applyNoise: true,
          noiseSeed: seed,
          driverCount: 4,
          routesPerDriver: 18,
          historyLevel,
        });
        return sum + computeRepeatedRouteTargetConcentration(run);
      }, 0) / seeds.length;
      return [historyLevel, averageConcentration];
    })
  );

  assert.ok(
    concentrationByHistoryLevel.light >= concentrationByHistoryLevel.none + 0.30,
    `expected light-history route consistency > no-history, got ${concentrationByHistoryLevel.light.toFixed(3)} vs ${concentrationByHistoryLevel.none.toFixed(3)}`,
  );
  assert.ok(
    concentrationByHistoryLevel.rich >= concentrationByHistoryLevel.none + 0.20,
    `expected rich-history route consistency > no-history, got ${concentrationByHistoryLevel.rich.toFixed(3)} vs ${concentrationByHistoryLevel.none.toFixed(3)}`,
  );
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
  assert.ok(
    result.routes.length - result.summary.actualFuelStopCount > result.summary.actualFuelStopCount,
    'expected non-fueling drives to remain the majority',
  );
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
        if (routeIsActualFuelingStop(route)) lowNeedStops += 1;
      }
      if (route.estimatedRemainingMiles != null && route.estimatedRemainingMiles >= 240) {
        highReserveRoutes += 1;
        if (routeIsActualFuelingStop(route)) highReserveStops += 1;
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
  assert.ok(
    result.summary.scorecard.recall >= 50,
    `expected no-history realistic recall to stay at least 50, got ${result.summary.scorecard.recall}`,
  );
  assert.ok(
    result.summary.scorecard.falsePositiveRate <= 4,
    `expected no-history realistic FPR to stay at most 4, got ${result.summary.scorecard.falsePositiveRate}`,
  );
  assert.ok(
    result.summary.scorecard.precision >= 33,
    `expected no-history realistic precision to stay at least 33, got ${result.summary.scorecard.precision}`,
  );
  assert.ok(
    result.summary.scorecard.wrongStationRate <= 17,
    `expected no-history realistic wrong-station rate to stay at most 17, got ${result.summary.scorecard.wrongStationRate}`,
  );
});

test('realistic rich-history cohort keeps repeat-route false positives bounded without losing current recall', () => {
  const result = simulateRealisticCohortBatch({
    createEngineFn: makeEngine,
    applyNoise: true,
    noiseSeed: 4242,
    driverCount: 6,
    routesPerDriver: 24,
    historyLevel: 'rich',
  });

  assert.ok(
    result.summary.scorecard.accuracy >= 97,
    `expected rich-history realistic accuracy to stay at least 97, got ${result.summary.scorecard.accuracy}`,
  );
  assert.ok(
    result.summary.scorecard.recall >= 80,
    `expected rich-history realistic recall to stay at least 80, got ${result.summary.scorecard.recall}`,
  );
  assert.ok(
    result.summary.scorecard.falsePositiveRate <= 2,
    `expected rich-history realistic FPR to stay at most 2, got ${result.summary.scorecard.falsePositiveRate}`,
  );
  assert.ok(
    result.summary.scorecard.precision >= 57,
    `expected rich-history realistic precision to stay at least 57, got ${result.summary.scorecard.precision}`,
  );
  assert.ok(
    result.summary.scorecard.precisionFirstScore >= 92,
    `expected rich-history realistic precision-first score to stay at least 92, got ${result.summary.scorecard.precisionFirstScore}`,
  );
  assert.equal(
    result.summary.scorecard.wrongStationRate,
    0,
    `expected rich-history realistic wrong-station rate to remain zero, got ${result.summary.scorecard.wrongStationRate}`,
  );
});

test('realistic light-history cohort recovers learned late-route stops without spending extra false positives', () => {
  const result = simulateRealisticCohortBatch({
    createEngineFn: makeEngine,
    applyNoise: true,
    noiseSeed: 4242,
    driverCount: 6,
    routesPerDriver: 24,
    historyLevel: 'light',
  });

  assert.ok(
    result.summary.scorecard.recall >= 50,
    `expected light-history realistic recall to stay at least 50, got ${result.summary.scorecard.recall}`,
  );
  assert.ok(
    result.summary.scorecard.falsePositiveRate <= 4,
    `expected light-history realistic FPR to stay at most 4, got ${result.summary.scorecard.falsePositiveRate}`,
  );
  assert.equal(
    result.summary.scorecard.wrongStationRate,
    0,
    `expected light-history realistic wrong-station rate to remain zero, got ${result.summary.scorecard.wrongStationRate}`,
  );
});

test('realistic cohort batch emits route-level stateful trace summaries and miss breakdowns', () => {
  const result = simulateRealisticCohortBatch({
    createEngineFn: makeEngine,
    applyNoise: true,
    noiseSeed: 4242,
    driverCount: 4,
    routesPerDriver: 18,
    historyLevel: 'rich',
    collectStatefulTrace: true,
  });

  assert.ok(result.routes.every(route => route.statefulTraceSummary), 'expected every route to carry a stateful trace summary');

  const statefulOutcomeTotal = Object.values(result.summary.diagnostics.statefulOutcomeBreakdown || {})
    .reduce((sum, count) => sum + count, 0);
  assert.equal(statefulOutcomeTotal, result.routes.length, 'stateful outcome breakdown should account for every route');

  const hiddenMisses = result.routes.filter(route => route.expectsTrigger && !route.firstTriggerCorrect);
  if (hiddenMisses.length > 0) {
    assert.ok(
      hiddenMisses.some(route => route.statefulTraceSummary?.targetEverVisible),
      'expected at least one hidden miss where the target became visible to the live pipeline',
    );
    assert.ok(
      Object.keys(result.summary.diagnostics.hiddenMissFailureBreakdown || {}).length >= 1,
      'expected at least one hidden-miss failure category',
    );
  } else {
    assert.deepEqual(
      result.summary.diagnostics.hiddenMissFailureBreakdown || {},
      {},
      'expected no hidden-miss failure categories when the slice has no hidden misses',
    );
  }
  const noCorridorRoutes = result.routes.filter(route => route.statefulTraceSummary?.dominantSkipReason === 'no_corridor_candidates');
  const hiddenNoCorridorRoutes = hiddenMisses.filter(route => route.statefulTraceSummary?.dominantSkipReason === 'no_corridor_candidates');
  if (noCorridorRoutes.length > 0) {
    assert.ok(
      noCorridorRoutes.every(route => typeof route.statefulTraceSummary?.noCorridorClassification === 'string' && route.statefulTraceSummary.noCorridorClassification.length > 0),
      'expected no-corridor routes to include a market classification',
    );
    if (hiddenNoCorridorRoutes.length > 0) {
      assert.ok(
        Object.keys(result.summary.diagnostics.hiddenMissFailureBreakdown || {}).some(key => key.startsWith('skipped:no_corridor_candidates:')),
        'expected hidden-miss breakdown to expose classified no-corridor failures',
      );
    }
  }
  assert.ok(
    result.routes.some(route => route.statefulTraceSummary?.dominantSkipReason || route.statefulTraceSummary?.skipCount > 0),
    'expected stateful traces to capture at least some early-skip diagnostics',
  );
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
  assert.equal(result.transactions.length, result.summary.actualFuelStopCount, 'expected one transaction per true fueling decision');
  assert.ok(
    result.summary.actualFuelStopCount >= result.summary.hiddenIntentCount,
    'actual fuel stops should be at least as common as actionable recommendation opportunities',
  );
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
