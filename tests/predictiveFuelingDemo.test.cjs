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
    latitude: 37.7875,
    longitude: -122.3922,
  },
  expensiveStation: {
    brand: 'Shell',
    price: 5.39,
    coordinate: {
      latitude: 37.779919,
      longitude: -122.398028,
    },
  },
  destinationStation: {
    brand: 'Chevron',
    price: 4.99,
    coordinate: {
      latitude: 37.777304,
      longitude: -122.404647,
    },
  },
  fallbackRoute: {
    distanceMeters: 1677,
    expectedTravelTimeSeconds: 374,
    coordinates: [
      { latitude: 37.787397, longitude: -122.392634 },
      { latitude: 37.787295, longitude: -122.392776 },
      { latitude: 37.787241, longitude: -122.392708 },
      { latitude: 37.786841, longitude: -122.392198 },
      { latitude: 37.786760, longitude: -122.392076 },
      { latitude: 37.786603, longitude: -122.392278 },
      { latitude: 37.786117, longitude: -122.392898 },
      { latitude: 37.785807, longitude: -122.393280 },
      { latitude: 37.785219, longitude: -122.394025 },
      { latitude: 37.783442, longitude: -122.396302 },
      { latitude: 37.782864, longitude: -122.397031 },
      { latitude: 37.782569, longitude: -122.397405 },
      { latitude: 37.780787, longitude: -122.399660 },
      { latitude: 37.778604, longitude: -122.402392 },
      { latitude: 37.777015, longitude: -122.404409 },
      { latitude: 37.777091, longitude: -122.404512 },
      { latitude: 37.777167, longitude: -122.404615 },
      { latitude: 37.777196, longitude: -122.404581 },
      { latitude: 37.777276, longitude: -122.404682 },
    ],
    steps: [
      {
        instructions: 'Turn left onto Fremont St',
        distanceMeters: 17,
        expectedTravelTimeSeconds: 4,
        coordinate: { latitude: 37.787397, longitude: -122.392634 },
      },
      {
        instructions: 'Turn right onto Harrison St',
        distanceMeters: 86,
        expectedTravelTimeSeconds: 13,
        coordinate: { latitude: 37.787295, longitude: -122.392776 },
      },
      {
        instructions: 'Turn right into the parking lot',
        distanceMeters: 1533,
        expectedTravelTimeSeconds: 343,
        coordinate: { latitude: 37.786760, longitude: -122.392076 },
      },
      {
        instructions: 'Arrive at the destination',
        distanceMeters: 42,
        expectedTravelTimeSeconds: 14,
        coordinate: { latitude: 37.777015, longitude: -122.404409 },
      },
    ],
  },
  cameraPitch: 62,
  cameraLeadMeters: 140,
  routeSpacingMeters: 6,
  turnPreview: {
    altitude: 840,
    centerBlend: 0.36,
    headingBlend: 0.74,
    lookaheadMeters: 120,
    minimumTurnDistanceMeters: 18,
    postTurnSampleMeters: 76,
  },
  cameraProfiles: {
    intro: {
      altitude: 640,
      leadMeters: 130,
      pitch: 64,
    },
    cruise: {
      altitude: 1220,
      leadMeters: 220,
      pitch: 16,
    },
    showcase: {
      altitude: 720,
      leadMeters: 136,
      pitch: 58,
    },
  },
  cameraAltitudes: {
    driving: 680,
    passingExpensive: 560,
    routingCheap: 720,
  },
};

test('buildRouteMetrics computes total route distance and station progress', () => {
  const routeMetrics = buildRouteMetrics(PREDICTIVE_FUELING_SCENE.fallbackRoute, PREDICTIVE_FUELING_SCENE);

  assert.ok(routeMetrics.coordinates.length > PREDICTIVE_FUELING_SCENE.fallbackRoute.coordinates.length);
  assert.ok(routeMetrics.totalDistanceMeters > 1500);
  assert.ok(routeMetrics.expensiveStationProgress > 0.55);
  assert.ok(routeMetrics.expensiveStationProgress < 0.9);
  assert.ok(routeMetrics.turnEvents.length >= 1);
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
