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
  });
  recommender.setStations(GROUNDED_SIM_STATIONS);
  recommender.setProfile(profile);
  return recommender;
}

test('grounded simulation fixtures contain real route geometry and multi-station corridor markets', () => {
  assert.ok(GROUNDED_SIM_STATIONS.length >= 40, `expected a real station catalog, got ${GROUNDED_SIM_STATIONS.length}`);
  assert.equal(GROUNDED_ROUTE_FIXTURES.length, 10);

  for (const route of GROUNDED_ROUTE_FIXTURES) {
    assert.ok(route.distanceMeters > 4_000, `expected real route distance for ${route.id}, got ${route.distanceMeters}`);
    assert.ok(route.expectedTravelTimeSeconds > 300, `expected real travel time for ${route.id}, got ${route.expectedTravelTimeSeconds}`);
    assert.ok(route.routeCoordinates.length >= 50, `expected dense MapKit polyline for ${route.id}, got ${route.routeCoordinates.length}`);
    assert.ok(route.stationIds.length >= 8, `expected route ${route.id} to carry many real stations, got ${route.stationIds.length}`);
  }

  for (const station of GROUNDED_SIM_STATIONS.slice(0, 20)) {
    assert.equal(station.providerId, 'gasbuddy');
    assert.ok(Number.isFinite(station.latitude) && Number.isFinite(station.longitude), `invalid coordinates for ${station.stationId}`);
    assert.ok(Number.isFinite(station.price) && station.price > 0, `invalid price for ${station.stationId}`);
    assert.ok(station.stationName, `missing station name for ${station.stationId}`);
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
    assert.ok(route.groundedStationCount >= 8, `expected a dense grounded station market for ${route.routeId}, got ${route.groundedStationCount}`);
    assert.ok(route.groundedRoutePointCount >= 30, `expected grounded route polyline density for ${route.routeId}, got ${route.groundedRoutePointCount}`);
    assert.ok(route.candidateStationCount >= 1, `expected at least one feasible visible station for ${route.routeId}`);
  }
});
