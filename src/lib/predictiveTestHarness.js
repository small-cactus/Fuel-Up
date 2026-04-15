/**
 * Route playback controller. Pure JS — no React imports.
 * The setManualLocationOverride and clearManualLocationOverride functions
 * are passed in at construction from AppStateContext.
 */

const { calculateHeadingDegrees } = require('../screens/onboarding/predictive/simulationMath.cjs');

// Build a flat array of LocationSamples from a TestRoute
function routeToSamples(route) {
  const samples = [];
  const waypoints = route.waypoints;

  // Base timestamp respects overrideTime for time-pattern matching.
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

    // Interpolate sub-steps between this waypoint and the next
    if (i < waypoints.length - 1) {
      const next = waypoints[i + 1];
      const steps = 6;
      for (let j = 0; j < steps; j++) {
        const t = j / steps;
        samples.push({
          latitude: wp.lat + (next.lat - wp.lat) * t,
          longitude: wp.lon + (next.lon - wp.lon) * t,
          heading,
          speed: speedMs,
          timestamp: baseTimestamp + (i * steps + j) * 2000,
        });
      }
    } else {
      samples.push({
        latitude: wp.lat,
        longitude: wp.lon,
        heading,
        speed: speedMs,
        timestamp: baseTimestamp + i * 12000,
      });
    }
  }
  return samples;
}

function createPredictiveTestHarness({ engine, setManualLocationOverride, clearManualLocationOverride, onStep, onComplete, onEvent }) {
  let samples = [];
  let stepIndex = 0;
  let intervalHandle = null;
  let speedMultiplier = 1;
  let phase = 'idle'; // 'idle' | 'playing' | 'paused' | 'complete'
  let lastLocationInjectTime = 0;
  const LOCATION_INJECT_MIN_INTERVAL_MS = 250; // max 4 injects/sec wall-clock

  function load(route) {
    if (intervalHandle) clearInterval(intervalHandle);
    samples = routeToSamples(route);
    stepIndex = 0;
    phase = 'idle';
    if (engine) engine.reset();
  }

  function step() {
    if (stepIndex >= samples.length) {
      if (intervalHandle) clearInterval(intervalHandle);
      intervalHandle = null;
      phase = 'complete';
      if (typeof onComplete === 'function') onComplete();
      return;
    }

    const sample = samples[stepIndex];
    if (engine) engine.pushLocation(sample);

    const now = Date.now();
    if (typeof setManualLocationOverride === 'function' && now - lastLocationInjectTime >= LOCATION_INJECT_MIN_INTERVAL_MS) {
      setManualLocationOverride({
        latitude: sample.latitude,
        longitude: sample.longitude,
        source: 'harness',
        updatedAt: new Date().toISOString(),
      });
      lastLocationInjectTime = now;
    }

    if (typeof onStep === 'function') {
      onStep({ sample, stepIndex, totalSteps: samples.length, elapsedMs: stepIndex * 2000 / speedMultiplier });
    }

    stepIndex++;
  }

  function play(mult = 1) {
    if (phase === 'complete') return;
    if (intervalHandle) clearInterval(intervalHandle);
    speedMultiplier = mult;
    phase = 'playing';
    const intervalMs = Math.max(16, Math.round(2000 / speedMultiplier));
    intervalHandle = setInterval(step, intervalMs);
  }

  function pause() {
    if (intervalHandle) clearInterval(intervalHandle);
    intervalHandle = null;
    if (phase === 'playing') phase = 'paused';
  }

  function reset() {
    if (intervalHandle) clearInterval(intervalHandle);
    intervalHandle = null;
    stepIndex = 0;
    phase = 'idle';
    if (engine) engine.reset();
    // Clear the manual location override using clearManualLocationOverride from AppStateContext
    if (typeof clearManualLocationOverride === 'function') {
      clearManualLocationOverride();
    }
  }

  function getStatus() {
    return { phase, stepIndex, totalSteps: samples.length, speedMultiplier };
  }

  return { load, play, pause, reset, getStatus };
}

module.exports = { createPredictiveTestHarness, routeToSamples };
