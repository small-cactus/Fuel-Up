const { haversineDistanceMeters, calculateHeadingDegrees } = require('../screens/onboarding/predictive/simulationMath.cjs');

/**
 * Convert a TestRoute into an array of LocationSamples for synchronous engine feeding.
 * Simple linear interpolation between waypoints — no external route APIs needed.
 *
 * If `route.overrideTime = { hour, dayOfWeek }` is set, the base timestamp
 * is snapped to the next occurrence of that time (useful for testing
 * time-of-day pattern matching). dayOfWeek 0=Sun, 1=Mon, ..., 6=Sat.
 */
function routeToSamples(route) {
  const samples = [];
  const waypoints = route.waypoints;

  // Base timestamp: either "now" or the next occurrence of the requested
  // hour-of-day / day-of-week combination.
  let baseTimestamp = Date.now();
  if (route.overrideTime) {
    const { hour = 12, dayOfWeek } = route.overrideTime;
    const d = new Date();
    if (typeof dayOfWeek === 'number') {
      const cur = d.getDay();
      const delta = (dayOfWeek - cur + 7) % 7;
      d.setDate(d.getDate() + delta);
    }
    d.setHours(hour, 0, 0, 0);
    baseTimestamp = d.getTime();
  }

  if (!Array.isArray(waypoints) || waypoints.length === 0) {
    return samples;
  }

  let currentTimestamp = baseTimestamp;
  let cumulativeDistanceMeters = 0;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const wp = waypoints[i];
    const next = waypoints[i + 1];
    const startSpeedMs = Math.max(1.5, (wp.speedMph || 25) * 0.44704);
    const endSpeedMs = Math.max(1.5, (next.speedMph || wp.speedMph || 25) * 0.44704);
    const segmentDistanceMeters = haversineDistanceMeters(
      { latitude: wp.lat, longitude: wp.lon },
      { latitude: next.lat, longitude: next.lon }
    );
    const segmentDurationMs = Math.max(
      3000,
      Math.round((segmentDistanceMeters / Math.max(1.5, (startSpeedMs + endSpeedMs) / 2)) * 1000)
    );
    const heading = calculateHeadingDegrees(
      { latitude: wp.lat, longitude: wp.lon },
      { latitude: next.lat, longitude: next.lon }
    );
    const interpCount = Math.max(1, Math.min(6, Math.round(segmentDistanceMeters / 90)));

    for (let j = 0; j < interpCount; j++) {
      const t = j / interpCount;
      samples.push({
        latitude: wp.lat + ((next.lat - wp.lat) * t),
        longitude: wp.lon + ((next.lon - wp.lon) * t),
        heading,
        speed: startSpeedMs + ((endSpeedMs - startSpeedMs) * t),
        timestamp: currentTimestamp + Math.round(segmentDurationMs * t),
        alongRouteMeters: cumulativeDistanceMeters + (segmentDistanceMeters * t),
      });
    }
    cumulativeDistanceMeters += segmentDistanceMeters;
    currentTimestamp += segmentDurationMs;
  }

  const lastWaypoint = waypoints[waypoints.length - 1];
  const previousWaypoint = waypoints[waypoints.length - 2] || lastWaypoint;
  samples.push({
    latitude: lastWaypoint.lat,
    longitude: lastWaypoint.lon,
    heading: calculateHeadingDegrees(
      { latitude: previousWaypoint.lat, longitude: previousWaypoint.lon },
      { latitude: lastWaypoint.lat, longitude: lastWaypoint.lon }
    ),
    speed: Math.max(0.5, (lastWaypoint.speedMph || previousWaypoint.speedMph || 25) * 0.44704),
    timestamp: currentTimestamp,
    alongRouteMeters: cumulativeDistanceMeters,
  });

  return samples;
}

function runBatchMetrics({ routes, engineFactory, stations }) {
  const routeResults = [];

  for (const route of routes) {
    const triggers = [];

    // Create a capturing engine with onTrigger injected
    const capturingEngine = engineFactory({
      onTrigger: (event) => triggers.push(event),
    });
    capturingEngine.setStations(stations);

    const samples = routeToSamples(route);
    for (const sample of samples) {
      capturingEngine.pushLocation(sample);
    }

    // Find the destination station
    const destStation = stations.find(s => s.stationId === route.destinationStationId);

    // Evaluate
    const didTrigger = triggers.length > 0;
    const correctTrigger = didTrigger
      ? triggers.some(t => t.stationId === route.destinationStationId)
      : null;
    const correct = route.expectsTrigger
      ? didTrigger && correctTrigger
      : !didTrigger;

    let triggerDistanceMeters = null;
    let triggerStepIndex = null;
    let triggeredStationId = null;

    if (triggers.length > 0 && destStation) {
      const firstTrigger = triggers[0];
      triggerDistanceMeters = haversineDistanceMeters(
        { latitude: firstTrigger.location.latitude, longitude: firstTrigger.location.longitude },
        { latitude: destStation.latitude, longitude: destStation.longitude }
      );
      triggeredStationId = firstTrigger.stationId;
      // Find step index by matching trigger timestamp to samples
      triggerStepIndex = samples.findIndex(s => Math.abs(s.timestamp - firstTrigger.triggeredAt) < 2000);
    }

    routeResults.push({
      routeId: route.id,
      routeName: route.name,
      expectsTrigger: route.expectsTrigger,
      didTrigger,
      correct,
      triggerDistanceMeters,
      triggerStepIndex,
      triggeredStationId,
      allTriggers: triggers,
    });
  }

  const correctPredictions = routeResults.filter(r => r.correct).length;
  const falsePositives = routeResults.filter(r => !r.expectsTrigger && r.didTrigger).length;
  const falseNegatives = routeResults.filter(r => r.expectsTrigger && !r.didTrigger).length;
  const truePosDistances = routeResults
    .filter(r => r.expectsTrigger && r.didTrigger && r.triggerDistanceMeters !== null)
    .map(r => r.triggerDistanceMeters);
  const avgTriggerDistanceMeters = truePosDistances.length > 0
    ? truePosDistances.reduce((a, b) => a + b, 0) / truePosDistances.length
    : null;

  const truePosStepIndices = routeResults
    .filter(r => r.expectsTrigger && r.didTrigger && r.triggerStepIndex !== null)
    .map(r => r.triggerStepIndex);
  const avgTriggerStepIndex = truePosStepIndices.length > 0
    ? truePosStepIndices.reduce((a, b) => a + b, 0) / truePosStepIndices.length
    : null;

  return {
    totalRoutes: routes.length,
    correctPredictions,
    accuracyPercent: Math.round((correctPredictions / routes.length) * 100),
    falsePositives,
    falseNegatives,
    avgTriggerDistanceMeters,
    avgTriggerStepIndex,
    routeResults,
  };
}

function compareEngines({ routes, stationsA, engineFactoryA, stationsB, engineFactoryB }) {
  const baseline = runBatchMetrics({ routes, engineFactory: engineFactoryA, stations: stationsA });
  const challenger = runBatchMetrics({ routes, engineFactory: engineFactoryB, stations: stationsB });
  return {
    baseline,
    challenger,
    delta: {
      accuracyDelta: challenger.accuracyPercent - baseline.accuracyPercent,
      falsePositiveDelta: challenger.falsePositives - baseline.falsePositives,
      avgDistanceDelta: (challenger.avgTriggerDistanceMeters || 0) - (baseline.avgTriggerDistanceMeters || 0),
    },
  };
}

module.exports = { runBatchMetrics, compareEngines, routeToSamples };
