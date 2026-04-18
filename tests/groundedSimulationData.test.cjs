const test = require('node:test');
const assert = require('node:assert/strict');

const { createPredictiveRecommender } = require('../src/lib/predictiveRecommender.js');
const {
  GROUNDED_SIM_STATIONS,
  GROUNDED_ROUTE_FIXTURES,
} = require('../src/lib/groundedSimulationData.js');
const {
  simulateRealisticCohortBatch,
} = require('../src/lib/fuelerSimulation.js');

function makeEngine({ profile, onTrigger }) {
  const recommender = createPredictiveRecommender({
    onTrigger,
    cooldownMs: 60 * 1000,
    triggerThreshold: 0.5,
    enforcePresentationTiming: true,
  });
  recommender.setStations(GROUNDED_SIM_STATIONS);
  recommender.setProfile(profile);
  return recommender;
}

test('grounded simulation fixtures contain real route geometry and multi-station corridor markets', () => {
  assert.ok(GROUNDED_SIM_STATIONS.length >= 40, `expected a real station catalog, got ${GROUNDED_SIM_STATIONS.length}`);
  assert.ok(GROUNDED_ROUTE_FIXTURES.length >= 15, `expected base plus derived grounded routes, got ${GROUNDED_ROUTE_FIXTURES.length}`);

  for (const route of GROUNDED_ROUTE_FIXTURES) {
    assert.ok(route.distanceMeters > 4_000, `expected real route distance for ${route.id}, got ${route.distanceMeters}`);
    assert.ok(route.expectedTravelTimeSeconds > 300, `expected real travel time for ${route.id}, got ${route.expectedTravelTimeSeconds}`);
    assert.ok(route.routeCoordinates.length >= 25, `expected dense MapKit polyline for ${route.id}, got ${route.routeCoordinates.length}`);
    assert.ok(route.stationIds.length >= 2, `expected route ${route.id} to carry real stations, got ${route.stationIds.length}`);
  }

  for (const station of GROUNDED_SIM_STATIONS.slice(0, 20)) {
    assert.equal(station.providerId, 'gasbuddy');
    assert.ok(Number.isFinite(station.latitude) && Number.isFinite(station.longitude), `invalid coordinates for ${station.stationId}`);
    assert.ok(Number.isFinite(station.price) && station.price > 0, `invalid price for ${station.stationId}`);
    assert.ok(station.stationName, `missing station name for ${station.stationId}`);
  }
});

test('derived grounded subroutes preserve real geometry while cropping to actionable corridor segments', () => {
  const derivedRoutes = GROUNDED_ROUTE_FIXTURES.filter(route => route.derivedFrom);
  assert.ok(derivedRoutes.length >= 5, `expected multiple derived grounded routes, got ${derivedRoutes.length}`);

  for (const route of derivedRoutes) {
    assert.ok(route.derivedFrom.baseRouteId, `expected ${route.id} to track its base route`);
    assert.ok(route.derivedFrom.endFraction > route.derivedFrom.startFraction, `expected ordered crop fractions for ${route.id}`);
    assert.ok(route.routeCoordinates.length >= 25, `expected derived route ${route.id} to keep real polyline density`);
    assert.ok(route.stationIds.length >= 2, `expected derived route ${route.id} to keep multiple real stations`);
  }
});

test('realistic cohort simulations use grounded route geometry and route-specific real station markets', () => {
  const result = simulateRealisticCohortBatch({
    createEngineFn: makeEngine,
    applyNoise: true,
    noiseSeed: 4242,
    driverCount: 3,
    routesPerDriver: 10,
    historyLevel: 'none',
  });

  assert.ok(result.routes.length > 0);
  for (const route of result.routes) {
    assert.ok(
      route.groundedRouteStationCount >= 6,
      `expected a real route-specific grounded station market for ${route.routeId}, got ${route.groundedRouteStationCount}`,
    );
    assert.ok(
      route.groundedStationCount >= 1,
      `expected the filtered per-route fetched market for ${route.routeId} to stay non-empty, got ${route.groundedStationCount}`,
    );
    assert.ok(route.groundedRoutePointCount >= 30, `expected grounded route polyline density for ${route.routeId}, got ${route.groundedRoutePointCount}`);
    assert.ok(route.candidateStationCount >= 1, `expected at least one feasible visible station for ${route.routeId}`);
  }
});
