const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildRouteMetrics,
  getDemoSnapshot,
  getScenePhase,
  haversineDistanceMeters,
} = require('../src/screens/onboarding/predictive/simulationMath.cjs');

const PREDICTIVE_FUELING_SCENE = {
  origin: {
    latitude: 37.7931,
    longitude: -122.3959,
  },
  expensiveStation: {
    brand: 'Chevron',
    price: 5.29,
    coordinate: {
      latitude: 37.7861,
      longitude: -122.3988,
    },
  },
  destinationStation: {
    brand: 'ARCO',
    price: 4.69,
    coordinate: {
      latitude: 37.7745,
      longitude: -122.4041,
    },
  },
  fallbackRoute: {
    distanceMeters: 2620,
    expectedTravelTimeSeconds: 440,
    coordinates: [
      { latitude: 37.7931, longitude: -122.3959 },
      { latitude: 37.7924, longitude: -122.3961 },
      { latitude: 37.7915, longitude: -122.3965 },
      { latitude: 37.7902, longitude: -122.3970 },
      { latitude: 37.7889, longitude: -122.3976 },
      { latitude: 37.7875, longitude: -122.3982 },
      { latitude: 37.7861, longitude: -122.3988 },
      { latitude: 37.7849, longitude: -122.3994 },
      { latitude: 37.7834, longitude: -122.4002 },
      { latitude: 37.7817, longitude: -122.4012 },
      { latitude: 37.7799, longitude: -122.4022 },
      { latitude: 37.7784, longitude: -122.4030 },
      { latitude: 37.7768, longitude: -122.4035 },
      { latitude: 37.7755, longitude: -122.4038 },
      { latitude: 37.7745, longitude: -122.4041 },
    ],
  },
  cameraPitch: 62,
  cameraLeadMeters: 140,
  cameraAltitudes: {
    driving: 680,
    passingExpensive: 560,
    routingCheap: 720,
  },
};

test('buildRouteMetrics computes total route distance and station progress', () => {
  const routeMetrics = buildRouteMetrics(PREDICTIVE_FUELING_SCENE.fallbackRoute, PREDICTIVE_FUELING_SCENE);

  assert.equal(routeMetrics.coordinates.length, PREDICTIVE_FUELING_SCENE.fallbackRoute.coordinates.length);
  assert.ok(routeMetrics.totalDistanceMeters > 2000);
  assert.ok(routeMetrics.expensiveStationProgress > 0.2);
  assert.ok(routeMetrics.expensiveStationProgress < 0.8);
});

test('demo snapshot starts at route origin and ends at destination', () => {
  const routeMetrics = buildRouteMetrics(PREDICTIVE_FUELING_SCENE.fallbackRoute, PREDICTIVE_FUELING_SCENE);
  const startSnapshot = getDemoSnapshot(routeMetrics, PREDICTIVE_FUELING_SCENE, 0);
  const endSnapshot = getDemoSnapshot(routeMetrics, PREDICTIVE_FUELING_SCENE, 1);
  const destination = PREDICTIVE_FUELING_SCENE.destinationStation.coordinate;

  assert.deepEqual(startSnapshot.carCoordinate, routeMetrics.coordinates[0]);
  assert.ok(haversineDistanceMeters(endSnapshot.carCoordinate, destination) < 25);
  assert.equal(endSnapshot.scenePhase, 'routing-cheap');
});

test('scene phase moves from driving to passing to routing cheap', () => {
  const routeMetrics = buildRouteMetrics(PREDICTIVE_FUELING_SCENE.fallbackRoute, PREDICTIVE_FUELING_SCENE);
  const expensiveProgress = routeMetrics.expensiveStationProgress;

  assert.equal(getScenePhase(Math.max(0, expensiveProgress - 0.1), expensiveProgress), 'driving');
  assert.equal(getScenePhase(expensiveProgress, expensiveProgress), 'passing-expensive');
  assert.equal(getScenePhase(Math.min(1, expensiveProgress + 0.08), expensiveProgress), 'routing-cheap');
});
