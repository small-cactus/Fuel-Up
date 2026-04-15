/**
 * Realistic noise injection for driving simulation.
 * Used to test that the predictive engine is robust to signal dropouts and
 * short stops that a real driver hits all the time (red lights, stop signs,
 * crosswalks, GPS jitter in urban canyons).
 *
 * Pure-JS, deterministic via seed — same seed reproduces the same noise.
 */

function mulberry32(seed) {
  return function rand() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rand) {
  return Math.sqrt(-2 * Math.log(Math.max(1e-9, rand()))) * Math.cos(2 * Math.PI * rand());
}

/**
 * Inject realistic driving noise into a sample array:
 *  - Stop-sign / red-light events: insert a short stretch of speed=0 samples
 *    every ~400-800m of urban driving (skipped for highway samples > 20 m/s).
 *  - GPS jitter: add gaussian position noise (stdPosM, default 8m).
 *  - Speed jitter: add gaussian speed noise (stdSpeedMps, default 0.3 m/s).
 *  - Accuracy variation: vary reported accuracy between 8–30m.
 *
 * The output preserves timestamps (stops get their own monotonically-increasing
 * timestamps) so windowing still works correctly.
 */
function addDrivingNoise(samples, options = {}) {
  const {
    seed = 42,
    stdPosM = 8,
    stdSpeedMps = 0.3,
    stopIntervalM = 500,      // average distance between noise events
    stopDurationSamples = 6,  // retained as fallback for generic stop config
    skipStopsAboveSpeed = 18, // highway-speed samples don't get red lights
    stopProbability = 0.6,    // probability of a noise event at each candidate point
    stopSignProbability = 0.45,
    trafficLightProbability = 0.55,
    gpsJitter = true,
    returnMetadata = false,
  } = options;

  const rand = mulberry32(seed);
  const result = [];
  const noiseEvents = [];
  let distanceSinceLastStop = 0;
  let lastLat = samples[0] ? samples[0].latitude : 0;
  let lastLon = samples[0] ? samples[0].longitude : 0;
  const R = 6371000;

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const latPerM = 1 / 111320;
    const lonPerM = 1 / (111320 * Math.cos(s.latitude * Math.PI / 180));

    // Segment distance from previous sample (meters).
    const dLat = (s.latitude - lastLat) * (Math.PI / 180);
    const dLon = (s.longitude - lastLon) * (Math.PI / 180);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lastLat * Math.PI / 180) * Math.cos(s.latitude * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    const segDist = 2 * R * Math.asin(Math.sqrt(a));
    distanceSinceLastStop += segDist;
    lastLat = s.latitude;
    lastLon = s.longitude;

    // GPS jitter
    let latJ = 0, lonJ = 0, speedJ = 0;
    if (gpsJitter) {
      latJ = gauss(rand) * stdPosM * latPerM;
      lonJ = gauss(rand) * stdPosM * lonPerM;
      speedJ = gauss(rand) * stdSpeedMps;
    }
    const baseAccuracy = 8 + Math.abs(gauss(rand)) * 12;

    result.push({
      ...s,
      latitude: s.latitude + latJ,
      longitude: s.longitude + lonJ,
      speed: Math.max(0, s.speed + speedJ),
      accuracy: baseAccuracy,
    });

    // Maybe insert a stop event
    if (
      distanceSinceLastStop >= stopIntervalM &&
      s.speed > 1 &&
      s.speed <= skipStopsAboveSpeed &&
      rand() < stopProbability
    ) {
      distanceSinceLastStop = 0;
      const stopLat = s.latitude + latJ;
      const stopLon = s.longitude + lonJ;
      const baseTs = s.timestamp || Date.now();
      const totalProbability = Math.max(0.0001, stopSignProbability + trafficLightProbability);
      const normalizedStopSignProbability = stopSignProbability / totalProbability;
      const chosenType = rand() < normalizedStopSignProbability ? 'stop_sign' : 'traffic_light';
      const durationSamples = chosenType === 'stop_sign'
        ? Math.max(2, Math.round(stopDurationSamples * 0.5))
        : Math.max(4, Math.round(stopDurationSamples * 1.35));
      noiseEvents.push({
        type: chosenType,
        sampleIndex: i,
        latitude: stopLat,
        longitude: stopLon,
        startedAt: baseTs,
        durationSamples,
      });
      for (let k = 0; k < durationSamples; k++) {
        // Stop signs are brief pauses; traffic lights hold longer then ramp.
        const holdSamples = chosenType === 'traffic_light'
          ? durationSamples - 2
          : Math.max(1, durationSamples - 1);
        const ramp = k < holdSamples
          ? (chosenType === 'stop_sign' ? 0.2 : 0.05)
          : ((k - holdSamples + 1) / Math.max(1, durationSamples - holdSamples + 1)) * s.speed;
        result.push({
          ...s,
          latitude: stopLat + gauss(rand) * 2 * latPerM,
          longitude: stopLon + gauss(rand) * 2 * lonPerM,
          speed: Math.max(0, ramp),
          timestamp: baseTs + (k + 1) * 1200,
          accuracy: 8 + Math.abs(gauss(rand)) * 12,
        });
      }
    }
  }
  if (returnMetadata) {
    return { samples: result, noiseEvents };
  }
  return result;
}

module.exports = { addDrivingNoise, mulberry32, gauss };
