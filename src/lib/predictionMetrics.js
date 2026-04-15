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

  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];
    const speedMs = (wp.speedMph || 25) * 0.44704;
    const timestamp = baseTimestamp + i * 5000;

    let heading = 0;
    if (i < waypoints.length - 1) {
      heading = calculateHeadingDegrees(
        { latitude: wp.lat, longitude: wp.lon },
        { latitude: waypoints[i + 1].lat, longitude: waypoints[i + 1].lon }
      );
    } else if (i > 0) {
      heading = calculateHeadingDegrees(
        { latitude: waypoints[i - 1].lat, longitude: waypoints[i - 1].lon },
        { latitude: wp.lat, longitude: wp.lon }
      );
    }

    // Add intermediate samples between waypoints for a denser window
    if (i < waypoints.length - 1) {
      const next = waypoints[i + 1];
      const interpCount = 4; // 4 intermediate points between each waypoint
      for (let j = 0; j <= interpCount; j++) {
        const t = j / interpCount;
        const lat = wp.lat + (next.lat - wp.lat) * t;
        const lon = wp.lon + (next.lon - wp.lon) * t;
        samples.push({
          latitude: lat,
          longitude: lon,
          heading,
          speed: speedMs,
          timestamp: timestamp + j * 1200,
        });
      }
    } else {
      samples.push({ latitude: wp.lat, longitude: wp.lon, heading, speed: speedMs, timestamp });
    }
  }

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
