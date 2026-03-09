const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildRouteMetrics,
  densifyCoordinates,
  getDemoSnapshot,
  getScenePhase,
  haversineDistanceMeters,
} = require('../src/screens/onboarding/predictive/simulationMath.cjs');
const {
  getPredictiveRouteDiagnostics,
} = require('../src/screens/onboarding/predictive/routeDiagnostics.cjs');

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
    distanceMeters: 3711,
    expectedTravelTimeSeconds: 715,
    coordinates: [
      { latitude: 37.792879, longitude: -122.396226 },
      { latitude: 37.793138, longitude: -122.396529 },
      { latitude: 37.793199, longitude: -122.396455 },
      { latitude: 37.793811, longitude: -122.395683 },
      { latitude: 37.790503, longitude: -122.391538 },
      { latitude: 37.790318, longitude: -122.391246 },
      { latitude: 37.790094, longitude: -122.390960 },
      { latitude: 37.790255, longitude: -122.390761 },
      { latitude: 37.790745, longitude: -122.390163 },
      { latitude: 37.790290, longitude: -122.389554 },
      { latitude: 37.789619, longitude: -122.388721 },
      { latitude: 37.789496, longitude: -122.388599 },
      { latitude: 37.789269, longitude: -122.388434 },
      { latitude: 37.789067, longitude: -122.388318 },
      { latitude: 37.788833, longitude: -122.388228 },
      { latitude: 37.788081, longitude: -122.388036 },
      { latitude: 37.787733, longitude: -122.387990 },
      { latitude: 37.787572, longitude: -122.387986 },
      { latitude: 37.786910, longitude: -122.388026 },
      { latitude: 37.784751, longitude: -122.388201 },
      { latitude: 37.784753, longitude: -122.388268 },
      { latitude: 37.784746, longitude: -122.388401 },
      { latitude: 37.784589, longitude: -122.388620 },
      { latitude: 37.783619, longitude: -122.389855 },
      { latitude: 37.781852, longitude: -122.392078 },
      { latitude: 37.780965, longitude: -122.393200 },
      { latitude: 37.780072, longitude: -122.394330 },
      { latitude: 37.779683, longitude: -122.394848 },
      { latitude: 37.778384, longitude: -122.396493 },
      { latitude: 37.776583, longitude: -122.398775 },
      { latitude: 37.774919, longitude: -122.400828 },
      { latitude: 37.773978, longitude: -122.402060 },
      { latitude: 37.773041, longitude: -122.403228 },
      { latitude: 37.773288, longitude: -122.403539 },
      { latitude: 37.774278, longitude: -122.404775 },
      { latitude: 37.774382, longitude: -122.404640 },
      { latitude: 37.774713, longitude: -122.404222 },
      { latitude: 37.774675, longitude: -122.404174 },
      { latitude: 37.774557, longitude: -122.404027 },
    ],
  },
  cameraPitch: 62,
  cameraLeadMeters: 140,
  routeSpacingMeters: 6,
  cameraAltitudes: {
    driving: 680,
    passingExpensive: 560,
    routingCheap: 720,
  },
};

test('buildRouteMetrics computes total route distance and station progress', () => {
  const routeMetrics = buildRouteMetrics(PREDICTIVE_FUELING_SCENE.fallbackRoute, PREDICTIVE_FUELING_SCENE);

  assert.ok(routeMetrics.coordinates.length > PREDICTIVE_FUELING_SCENE.fallbackRoute.coordinates.length);
  assert.ok(routeMetrics.totalDistanceMeters > 3000);
  assert.ok(routeMetrics.expensiveStationProgress > 0.2);
  assert.ok(routeMetrics.expensiveStationProgress < 0.8);
});

test('densifyCoordinates adds interpolation points for smoother motion', () => {
  const sparseCoordinates = [
    { latitude: 37.7931, longitude: -122.3959 },
    { latitude: 37.7905, longitude: -122.3915 },
    { latitude: 37.7745, longitude: -122.4041 },
  ];

  const densifiedCoordinates = densifyCoordinates(sparseCoordinates, 8);

  assert.ok(densifiedCoordinates.length > sparseCoordinates.length);
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

test('route diagnostics report whether the predictive route is native or fallback', () => {
  const diagnostics = getPredictiveRouteDiagnostics(
    {
      ...PREDICTIVE_FUELING_SCENE.fallbackRoute,
      isFallback: true,
      steps: [],
    },
    PREDICTIVE_FUELING_SCENE
  );

  assert.equal(diagnostics.source, 'fallback');
  assert.ok(diagnostics.renderedCoordinateCount > diagnostics.rawCoordinateCount);
  assert.ok(diagnostics.maxSegmentDistanceMeters <= 6.1);
});
