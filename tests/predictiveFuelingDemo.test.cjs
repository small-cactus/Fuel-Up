const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPredictiveRouteMetrics,
  densifyCoordinates,
  getDistanceForTimeProgress,
  getDemoSnapshot,
  getScenePhase,
  haversineDistanceMeters,
} = require('../src/screens/onboarding/predictive/simulationMath.cjs');
const {
  getPredictiveRouteDiagnostics,
} = require('../src/screens/onboarding/predictive/routeDiagnostics.cjs');
const {
  PREDICTIVE_FUELING_SCENE,
  getPredictiveFuelingFallbackRoutes,
} = require('../src/screens/onboarding/predictive/constants.js');

function createFallbackRouteMetrics() {
  return buildPredictiveRouteMetrics(
    getPredictiveFuelingFallbackRoutes(),
    PREDICTIVE_FUELING_SCENE
  );
}

test('buildPredictiveRouteMetrics composes the expensive leg and reroute leg', () => {
  const routeMetrics = createFallbackRouteMetrics();

  assert.ok(routeMetrics.initialRouteMetrics.coordinates.length > 20);
  assert.ok(routeMetrics.rerouteRouteMetrics.coordinates.length > 20);
  assert.ok(routeMetrics.coordinates.length > routeMetrics.initialRouteMetrics.coordinates.length);
  assert.ok(routeMetrics.totalDistanceMeters > routeMetrics.initialRouteMetrics.totalDistanceMeters);
  assert.ok(routeMetrics.rerouteTriggerProgress > 0.2);
  assert.ok(routeMetrics.rerouteTriggerProgress < 0.7);
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

test('demo snapshot starts at route origin and ends at cheaper destination', () => {
  const routeMetrics = createFallbackRouteMetrics();
  const startSnapshot = getDemoSnapshot(routeMetrics, PREDICTIVE_FUELING_SCENE, 0);
  const endSnapshot = getDemoSnapshot(routeMetrics, PREDICTIVE_FUELING_SCENE, 1, 1000);
  const destination = PREDICTIVE_FUELING_SCENE.destinationStation.coordinate;

  assert.deepEqual(startSnapshot.carCoordinate, routeMetrics.coordinates[0]);
  assert.ok(haversineDistanceMeters(endSnapshot.carCoordinate, destination) < 25);
  assert.equal(endSnapshot.scenePhase, 'arrived');
});

test('scene phase moves from driving to expensive warning to cheaper reroute', () => {
  const routeMetrics = createFallbackRouteMetrics();

  assert.equal(
    getScenePhase(
      Math.max(0, routeMetrics.expensiveStationProgress - 0.08),
      routeMetrics.expensiveStationProgress,
      routeMetrics.rerouteTriggerProgress
    ),
    'driving'
  );
  assert.equal(
    getScenePhase(
      routeMetrics.expensiveStationProgress + 0.01,
      routeMetrics.expensiveStationProgress,
      routeMetrics.rerouteTriggerProgress
    ),
    'passing-expensive'
  );
  assert.equal(
    getScenePhase(
      Math.min(1, routeMetrics.rerouteTriggerProgress + 0.05),
      routeMetrics.expensiveStationProgress,
      routeMetrics.rerouteTriggerProgress
    ),
    'routing-cheap'
  );
});

test('distance timing remains non-linear around turn windows', () => {
  const routeMetrics = createFallbackRouteMetrics();
  const weightedDistance = getDistanceForTimeProgress(routeMetrics, 0.4);
  const linearDistance = routeMetrics.totalDistanceMeters * 0.4;

  assert.ok(Math.abs(weightedDistance - linearDistance) > 3);
});

test('route diagnostics report reroute metadata for fallback routes', () => {
  const diagnostics = getPredictiveRouteDiagnostics(
    getPredictiveFuelingFallbackRoutes(),
    PREDICTIVE_FUELING_SCENE
  );

  assert.equal(diagnostics.source, 'fallback');
  assert.ok(diagnostics.renderedCoordinateCount > diagnostics.initialRawCoordinateCount);
  assert.ok(diagnostics.rerouteTriggerProgress > 0.2);
});

test('camera target remains continuous through turn windows and arrival handoff', () => {
  const routeMetrics = createFallbackRouteMetrics();
  let previousCamera = null;
  let maximumPitchDelta = 0;
  let maximumAltitudeDelta = 0;
  let maximumHeadingDelta = 0;

  for (let index = 0; index <= 480; index += 1) {
    const elapsedMs = (PREDICTIVE_FUELING_SCENE.loopDurationMs + 1800) * (index / 480);
    const progress = Math.min(elapsedMs / PREDICTIVE_FUELING_SCENE.loopDurationMs, 1);
    const arrivalElapsedMs = Math.max(0, elapsedMs - PREDICTIVE_FUELING_SCENE.loopDurationMs);
    const snapshot = getDemoSnapshot(
      routeMetrics,
      PREDICTIVE_FUELING_SCENE,
      progress,
      arrivalElapsedMs
    );

    if (previousCamera) {
      const headingDelta = Math.abs(
        ((snapshot.activeCamera.heading - previousCamera.heading + 540) % 360) - 180
      );
      maximumHeadingDelta = Math.max(maximumHeadingDelta, headingDelta);
      maximumPitchDelta = Math.max(
        maximumPitchDelta,
        Math.abs(snapshot.activeCamera.pitch - previousCamera.pitch)
      );
      maximumAltitudeDelta = Math.max(
        maximumAltitudeDelta,
        Math.abs(snapshot.activeCamera.altitude - previousCamera.altitude)
      );
    }

    previousCamera = snapshot.activeCamera;
  }

  assert.ok(maximumPitchDelta < 10, `maximum pitch delta was ${maximumPitchDelta}`);
  assert.ok(maximumAltitudeDelta < 90, `maximum altitude delta was ${maximumAltitudeDelta}`);
  assert.ok(maximumHeadingDelta < 36, `maximum heading delta was ${maximumHeadingDelta}`);
});

test('close turns are grouped into one camera event', () => {
  const routeMetrics = createFallbackRouteMetrics();

  assert.ok(routeMetrics.turnEvents.length > routeMetrics.cameraTurnEvents.length);
  assert.equal(routeMetrics.cameraTurnEvents.at(-1)?.eventCount, 3);
});

test('expensive chip reveals 800ms before the cheaper chip during the reroute overview', () => {
  const routeMetrics = createFallbackRouteMetrics();
  const rerouteOverviewStartProgress = Math.max(
    0,
    routeMetrics.rerouteTriggerProgress +
    (PREDICTIVE_FUELING_SCENE.cameraStoryboard.rerouteOverviewDelayMs / PREDICTIVE_FUELING_SCENE.loopDurationMs) -
    PREDICTIVE_FUELING_SCENE.cameraStoryboard.rerouteOverviewLeadProgress
  );
  const expensiveRevealProgress = rerouteOverviewStartProgress + (
    PREDICTIVE_FUELING_SCENE.stationChipReveal.expensiveAfterOverviewStartMs /
    PREDICTIVE_FUELING_SCENE.loopDurationMs
  );
  const destinationRevealProgress = rerouteOverviewStartProgress + (
    PREDICTIVE_FUELING_SCENE.stationChipReveal.destinationAfterOverviewStartMs /
    PREDICTIVE_FUELING_SCENE.loopDurationMs
  );
  const earlySnapshot = getDemoSnapshot(
    routeMetrics,
    PREDICTIVE_FUELING_SCENE,
    Math.max(0, expensiveRevealProgress - 0.01),
    0
  );
  const expensiveRevealSnapshot = getDemoSnapshot(
    routeMetrics,
    PREDICTIVE_FUELING_SCENE,
    expensiveRevealProgress + 0.01,
    0
  );
  const destinationRevealSnapshot = getDemoSnapshot(
    routeMetrics,
    PREDICTIVE_FUELING_SCENE,
    destinationRevealProgress + 0.01,
    0
  );

  assert.equal(earlySnapshot.chipRevealState.expensive, false);
  assert.equal(earlySnapshot.chipRevealState.destination, false);
  assert.equal(expensiveRevealSnapshot.chipRevealState.expensive, true);
  assert.equal(expensiveRevealSnapshot.chipRevealState.destination, false);
  assert.equal(destinationRevealSnapshot.chipRevealState.expensive, true);
  assert.equal(destinationRevealSnapshot.chipRevealState.destination, true);
});

test('visible route switches from expensive leg to cheaper reroute leg', () => {
  const routeMetrics = createFallbackRouteMetrics();
  const rerouteOverviewStartProgress = Math.max(
    0,
    routeMetrics.rerouteTriggerProgress +
    (PREDICTIVE_FUELING_SCENE.cameraStoryboard.rerouteOverviewDelayMs / PREDICTIVE_FUELING_SCENE.loopDurationMs) -
    PREDICTIVE_FUELING_SCENE.cameraStoryboard.rerouteOverviewLeadProgress
  );
  const destinationRevealProgress = rerouteOverviewStartProgress + (
    PREDICTIVE_FUELING_SCENE.stationChipReveal.destinationAfterOverviewStartMs /
    PREDICTIVE_FUELING_SCENE.loopDurationMs
  );
  const routeRevealDurationProgress = (
    PREDICTIVE_FUELING_SCENE.stationChipReveal.routeRevealDurationMs /
    PREDICTIVE_FUELING_SCENE.loopDurationMs
  );
  const beforeDestinationReveal = getDemoSnapshot(
    routeMetrics,
    PREDICTIVE_FUELING_SCENE,
    Math.max(0, destinationRevealProgress - 0.01),
    0
  );
  const afterDestinationReveal = getDemoSnapshot(
    routeMetrics,
    PREDICTIVE_FUELING_SCENE,
    destinationRevealProgress + routeRevealDurationProgress + 0.01,
    0
  );
  const immediateRerouteReveal = getDemoSnapshot(
    routeMetrics,
    PREDICTIVE_FUELING_SCENE,
    destinationRevealProgress + 0.01,
    0
  );

  assert.ok(beforeDestinationReveal.visibleRouteCoordinates.length > 0);
  assert.ok(immediateRerouteReveal.visibleRouteCoordinates.length > 0);
  assert.ok(afterDestinationReveal.visibleRouteCoordinates.length > 0);
  assert.ok(
    haversineDistanceMeters(
      beforeDestinationReveal.visibleRouteCoordinates.at(-1),
      PREDICTIVE_FUELING_SCENE.expensiveStation.coordinate
    ) < 40
  );
  assert.ok(
    haversineDistanceMeters(
      immediateRerouteReveal.visibleRouteCoordinates.at(-1),
      PREDICTIVE_FUELING_SCENE.destinationStation.coordinate
    ) > 40
  );
  assert.ok(
    haversineDistanceMeters(
      afterDestinationReveal.visibleRouteCoordinates.at(-1),
      PREDICTIVE_FUELING_SCENE.destinationStation.coordinate
    ) < 40
  );
});
