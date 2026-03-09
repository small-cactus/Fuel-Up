const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildRouteMetrics,
  densifyCoordinates,
  getDistanceForTimeProgress,
  getDemoSnapshot,
  getScenePhase,
  haversineDistanceMeters,
} = require('../src/screens/onboarding/predictive/simulationMath.cjs');
const {
  getPredictiveRouteDiagnostics,
} = require('../src/screens/onboarding/predictive/routeDiagnostics.cjs');

const PREDICTIVE_FUELING_SCENE = {
  origin: {
    latitude: 37.7953,
    longitude: -122.4028,
  },
  expensiveStation: {
    brand: 'Shell',
    price: 5.39,
    routeProgress: 0.84,
    coordinate: {
      latitude: 37.779919,
      longitude: -122.398028,
    },
  },
  destinationStation: {
    brand: 'Shell',
    price: 4.99,
    coordinate: {
      latitude: 37.780655,
      longitude: -122.394679,
    },
  },
  fallbackRoute: {
    distanceMeters: 2426,
    expectedTravelTimeSeconds: 519,
    coordinates: [
      { latitude: 37.795586, longitude: -122.402857 },
      { latitude: 37.795529, longitude: -122.403317 },
      { latitude: 37.795489, longitude: -122.403309 },
      { latitude: 37.792820, longitude: -122.402772 },
      { latitude: 37.790979, longitude: -122.402395 },
      { latitude: 37.789107, longitude: -122.402019 },
      { latitude: 37.788731, longitude: -122.401996 },
      { latitude: 37.788631, longitude: -122.401957 },
      { latitude: 37.788467, longitude: -122.401754 },
      { latitude: 37.787976, longitude: -122.401135 },
      { latitude: 37.787450, longitude: -122.400514 },
      { latitude: 37.787572, longitude: -122.400360 },
      { latitude: 37.788016, longitude: -122.399804 },
      { latitude: 37.787996, longitude: -122.399778 },
      { latitude: 37.786648, longitude: -122.398099 },
      { latitude: 37.785595, longitude: -122.396778 },
      { latitude: 37.784385, longitude: -122.395261 },
      { latitude: 37.783794, longitude: -122.394524 },
      { latitude: 37.783786, longitude: -122.394514 },
      { latitude: 37.783687, longitude: -122.394390 },
      { latitude: 37.783078, longitude: -122.393621 },
      { latitude: 37.781852, longitude: -122.392078 },
      { latitude: 37.781767, longitude: -122.392184 },
      { latitude: 37.780965, longitude: -122.393200 },
      { latitude: 37.780072, longitude: -122.394330 },
      { latitude: 37.780175, longitude: -122.394461 },
      { latitude: 37.780414, longitude: -122.394758 },
      { latitude: 37.780531, longitude: -122.394613 },
      { latitude: 37.780572, longitude: -122.394563 },
      { latitude: 37.780658, longitude: -122.394675 },
    ],
    steps: [
      {
        instructions: 'Turn left onto Montgomery St',
        distanceMeters: 41,
        expectedTravelTimeSeconds: 3,
        coordinate: { latitude: 37.795586, longitude: -122.402857 },
      },
      {
        instructions: 'Turn left onto Mission St',
        distanceMeters: 960,
        expectedTravelTimeSeconds: 72,
        coordinate: { latitude: 37.795529, longitude: -122.403317 },
      },
      {
        instructions: 'Turn right onto 2nd St',
        distanceMeters: 89,
        expectedTravelTimeSeconds: 7,
        coordinate: { latitude: 37.787450, longitude: -122.400514 },
      },
      {
        instructions: 'Turn right onto Brannan St',
        distanceMeters: 965,
        expectedTravelTimeSeconds: 72,
        coordinate: { latitude: 37.788016, longitude: -122.399804 },
      },
      {
        instructions: 'Turn right onto 3rd St',
        distanceMeters: 280,
        expectedTravelTimeSeconds: 21,
        coordinate: { latitude: 37.781852, longitude: -122.392078 },
      },
      {
        instructions: 'Turn right into the parking lot',
        distanceMeters: 54,
        expectedTravelTimeSeconds: 4,
        coordinate: { latitude: 37.780072, longitude: -122.394330 },
      },
      {
        instructions: 'Arrive at the destination',
        distanceMeters: 38,
        expectedTravelTimeSeconds: 3,
        coordinate: { latitude: 37.780414, longitude: -122.394758 },
      },
    ],
  },
  cameraPitch: 62,
  cameraLeadMeters: 140,
  routeSpacingMeters: 4,
  turnPreview: {
    altitude: 980,
    lookaheadMeters: 170,
    leadMeters: 188,
    pitch: 12,
    minimumTurnDistanceMeters: 18,
    recoveryMeters: 96,
    postTurnSampleMeters: 76,
  },
  cameraProfiles: {
    intro: {
      altitude: 620,
      leadMeters: 124,
      pitch: 64,
    },
    cruise: {
      altitude: 1320,
      leadMeters: 242,
      pitch: 10,
    },
    showcase: {
      altitude: 660,
      leadMeters: 128,
      pitch: 58,
    },
    arrival: {
      altitude: 560,
      pitch: 66,
    },
  },
  motionProfile: {
    slowdownLookaheadMeters: 86,
    slowdownRecoveryMeters: 54,
    turnSlowFactor: 0.76,
  },
  orbit: {
    degreesPerSecond: 9,
  },
  cameraSmoothing: {
    center: 0.18,
    heading: 0.12,
    altitude: 0.14,
    pitch: 0.16,
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
  assert.ok(routeMetrics.totalDistanceMeters > 2200);
  assert.equal(routeMetrics.expensiveStationProgress, 0.84);
  assert.ok(routeMetrics.turnEvents.length >= 4);
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
  const endSnapshot = getDemoSnapshot(routeMetrics, PREDICTIVE_FUELING_SCENE, 1, 1000);
  const destination = PREDICTIVE_FUELING_SCENE.destinationStation.coordinate;

  assert.deepEqual(startSnapshot.carCoordinate, routeMetrics.coordinates[0]);
  assert.ok(haversineDistanceMeters(endSnapshot.carCoordinate, destination) < 25);
  assert.equal(endSnapshot.scenePhase, 'arrived');
});

test('scene phase moves from driving to passing to routing cheap', () => {
  const routeMetrics = buildRouteMetrics(PREDICTIVE_FUELING_SCENE.fallbackRoute, PREDICTIVE_FUELING_SCENE);
  const expensiveProgress = routeMetrics.expensiveStationProgress;

  assert.equal(getScenePhase(Math.max(0, expensiveProgress - 0.1), expensiveProgress), 'driving');
  assert.equal(getScenePhase(expensiveProgress, expensiveProgress), 'passing-expensive');
  assert.equal(getScenePhase(Math.min(1, expensiveProgress + 0.08), expensiveProgress), 'routing-cheap');
});

test('distance timing slows slightly around turn windows', () => {
  const routeMetrics = buildRouteMetrics(PREDICTIVE_FUELING_SCENE.fallbackRoute, PREDICTIVE_FUELING_SCENE);
  const halfwayDistance = getDistanceForTimeProgress(routeMetrics, 0.5);
  const linearHalfwayDistance = routeMetrics.totalDistanceMeters * 0.5;

  assert.ok(halfwayDistance < linearHalfwayDistance);
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
