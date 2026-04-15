const { haversineDistanceMeters, calculateHeadingDegrees } = require('../screens/onboarding/predictive/simulationMath.cjs');
const {
  computeProfileBonus,
  computeProfilePenalty,
  computeHistoryScore,
  computeTimePatternScore,
} = require('./userFuelingProfile.js');

const DEFAULT_OPTIONS = {
  windowSize: 15,
  triggerThreshold: 0.72,
  cooldownMs: 45000,
  // Expanded candidate radius so long-range approaches (highway trips, urgent
  // tanks) have a chance to surface before the driver is right on top.
  maxCandidateRadiusMeters: 6500,
  // Base-confidence weights. Physical signals sum to 0.87, intent adds 0.13.
  // This keeps a perfect-physics approach (no decel) at exactly 0.74 — just
  // above the 0.72 trigger threshold, so history/urgency can push it higher.
  bearingWeight: 0.27,
  approachWeight: 0.20,
  speedWeight: 0.10,
  decelWeight: 0.16,
  pathWeight: 0.14,
  // Intent (history / time-pattern / urgency) weight. At far distance this
  // becomes the dominant signal via the far-field gate below.
  intentWeight: 0.13,
  userProfile: null,
  // Minimum GPS accuracy (meters) to trust a sample fully.
  minAccuracyMeters: 35,
  // Distance (meters) at which "far-field" intent-gated logic kicks in.
  // Below this, physics dominates; above, history/urgency dominate.
  farFieldDistanceMeters: 1500,
  // Urgency (0-1) from the range estimator. Passed in by the app each time
  // the engine is invoked. Urgent drivers get a trigger distance boost.
  urgency: 0,
  // Explicit road-trip hint from the app (optional). If true, relaxes the
  // history-required gate since road trips don't follow home/work patterns.
  isRoadTripHint: false,
};

// --- helpers ---
function angularDifference(a, b) {
  const diff = Math.abs(((a - b) + 180) % 360 - 180);
  return diff;
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function clamp(x, min, max) {
  return Math.max(min, Math.min(max, x));
}

function avg(arr) {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// Average accuracy (meters). Missing values assumed 20m (reasonable urban GPS).
function avgAccuracy(samples) {
  if (!samples || samples.length === 0) return 20;
  const vals = samples.map(s => (typeof s.accuracy === 'number' && s.accuracy >= 0 ? s.accuracy : 20));
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

// Valid speed samples (from device). expo-location emits -1 when unknown.
function validSpeeds(samples) {
  return samples.filter(s => typeof s.speed === 'number' && s.speed >= 0).map(s => s.speed);
}

// Compute local meters-per-degree factors at a given latitude.
function localMetersPerDeg(latitude) {
  const latRad = latitude * Math.PI / 180;
  return {
    mPerDegLat: 111320,
    mPerDegLon: 111320 * Math.max(0.1, Math.cos(latRad)),
  };
}

// Project station relative to vehicle motion vector. Returns along-track
// (positive = station ahead along heading, negative = behind) and cross-track
// (absolute perpendicular offset), both in meters. Uses the window's
// oldest→newest path direction as the vehicle motion vector.
function projectStationOntoTrajectory(window, station) {
  const current = window[window.length - 1];
  const oldest = window[0];
  const { mPerDegLat, mPerDegLon } = localMetersPerDeg(current.latitude);
  const dx = (current.longitude - oldest.longitude) * mPerDegLon;
  const dy = (current.latitude - oldest.latitude) * mPerDegLat;
  const motionLength = Math.hypot(dx, dy);
  const sx = (station.longitude - current.longitude) * mPerDegLon;
  const sy = (station.latitude - current.latitude) * mPerDegLat;
  const distance = Math.hypot(sx, sy);
  if (motionLength < 5) {
    // Vehicle is essentially stationary — no reliable direction of travel.
    return { alongTrack: 0, crossTrack: distance, motionLength, distance };
  }
  const ux = dx / motionLength;
  const uy = dy / motionLength;
  const alongTrack = sx * ux + sy * uy;
  const crossTrack = Math.abs(sx * (-uy) + sy * ux);
  return { alongTrack, crossTrack, motionLength, distance };
}

// Fit a simple least-squares line to distance-vs-time, returning slope in
// meters/second (negative = approaching, positive = receding).
function fitDistanceSlope(window, station) {
  if (window.length < 3) return 0;
  const t0 = window[0].timestamp || 0;
  const points = window.map(s => {
    const d = haversineDistanceMeters(
      { latitude: s.latitude, longitude: s.longitude },
      { latitude: station.latitude, longitude: station.longitude }
    );
    const t = ((s.timestamp || 0) - t0) / 1000; // seconds
    return { t, d };
  });
  const n = points.length;
  const meanT = avg(points.map(p => p.t));
  const meanD = avg(points.map(p => p.d));
  let num = 0, den = 0;
  for (const p of points) {
    num += (p.t - meanT) * (p.d - meanD);
    den += (p.t - meanT) * (p.t - meanT);
  }
  return den > 0 ? num / den : 0;
}

// Find index of minimum distance within window (useful for passed-CPA detection).
function findMinDistanceIndex(window, station) {
  let minD = Infinity;
  let minI = 0;
  for (let i = 0; i < window.length; i++) {
    const d = haversineDistanceMeters(
      { latitude: window[i].latitude, longitude: window[i].longitude },
      { latitude: station.latitude, longitude: station.longitude }
    );
    if (d < minD) { minD = d; minI = i; }
  }
  return { minI, minD };
}

// Detect "road trip mode" from the current window and profile state.
// Road trips need different handling: no home/work history, sustained highway
// speeds, and range-based urgency matter more than bearing/approach physics.
function detectRoadTripContext(window, opts) {
  if (opts.isRoadTripHint) return { mode: 'hint', score: 1 };
  const speeds = window.filter(s => typeof s.speed === 'number' && s.speed >= 0).map(s => s.speed);
  if (speeds.length < 6) return { mode: 'none', score: 0 };
  const meanSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  const minSpeed = Math.min(...speeds);
  // Sustained high speed: mean > 18 m/s (~40 mph) AND min > 13 m/s (~29 mph)
  // — i.e. never dropped out of a highway cruise within the window.
  const sustainedHighway = meanSpeed > 18 && minSpeed > 13;
  const urgencyHigh = (opts.urgency || 0) > 0.5;
  if (sustainedHighway && urgencyHigh) return { mode: 'highway+urgent', score: 1 };
  if (sustainedHighway) return { mode: 'highway', score: 0.7 };
  if (urgencyHigh) return { mode: 'urgent', score: 0.6 };
  return { mode: 'none', score: 0 };
}

function scoreStation(window, station, opts, allCandidateStations) {
  if (!opts) opts = DEFAULT_OPTIONS;
  if (!allCandidateStations) allCandidateStations = [];
  const bearingWeight = opts.bearingWeight !== undefined ? opts.bearingWeight : DEFAULT_OPTIONS.bearingWeight;
  const approachWeight = opts.approachWeight !== undefined ? opts.approachWeight : DEFAULT_OPTIONS.approachWeight;
  const speedWeight = opts.speedWeight !== undefined ? opts.speedWeight : DEFAULT_OPTIONS.speedWeight;
  const decelWeight = opts.decelWeight !== undefined ? opts.decelWeight : DEFAULT_OPTIONS.decelWeight;
  const pathWeight = opts.pathWeight !== undefined ? opts.pathWeight : DEFAULT_OPTIONS.pathWeight;
  const intentWeight = opts.intentWeight !== undefined ? opts.intentWeight : DEFAULT_OPTIONS.intentWeight;
  const minAccuracyMeters = opts.minAccuracyMeters !== undefined ? opts.minAccuracyMeters : DEFAULT_OPTIONS.minAccuracyMeters;
  const farFieldDistanceMeters = opts.farFieldDistanceMeters !== undefined ? opts.farFieldDistanceMeters : DEFAULT_OPTIONS.farFieldDistanceMeters;
  const urgency = Math.max(0, Math.min(1, opts.urgency || 0));

  if (window.length < 3) {
    return {
      stationId: station.stationId,
      confidence: 0,
      bearingScore: 0,
      approachScore: 0,
      speedScore: 0,
      decelScore: 0,
      pathScore: 0,
      cpaScore: 0,
      historyScore: 0,
      timePatternScore: 0,
      intentScore: 0,
      distanceMeters: 0,
      alongTrack: 0,
      crossTrack: 0,
    };
  }

  const current = window[window.length - 1];
  const distanceMeters = haversineDistanceMeters(
    { latitude: current.latitude, longitude: current.longitude },
    { latitude: station.latitude, longitude: station.longitude }
  );

  // --- Bearing score ---
  const oldest = window[0];
  const smoothedHeading = calculateHeadingDegrees(
    { latitude: oldest.latitude, longitude: oldest.longitude },
    { latitude: current.latitude, longitude: current.longitude }
  );
  const bearingToStation = calculateHeadingDegrees(
    { latitude: current.latitude, longitude: current.longitude },
    { latitude: station.latitude, longitude: station.longitude }
  );
  const headingDelta = angularDifference(smoothedHeading, bearingToStation);
  const bearingScore = 1 - smoothstep(10, 90, headingDelta);

  // --- Approach score ---
  // Use oldest-vs-newest half comparison, but also check for passed-closest-point.
  const halfMidpoint = Math.floor(window.length / 2);
  const olderDistances = window.slice(0, halfMidpoint).map(s =>
    haversineDistanceMeters({ latitude: s.latitude, longitude: s.longitude }, { latitude: station.latitude, longitude: station.longitude })
  );
  const newerDistances = window.slice(halfMidpoint).map(s =>
    haversineDistanceMeters({ latitude: s.latitude, longitude: s.longitude }, { latitude: station.latitude, longitude: station.longitude })
  );
  const meanOlder = avg(olderDistances);
  const meanNewer = avg(newerDistances);
  let approachScore = 0;
  if (meanOlder > 0) {
    const progressionRatio = (meanOlder - meanNewer) / meanOlder;
    approachScore = clamp(progressionRatio / 0.15, 0, 1);
  }
  // Detect "passed and receding" — window's minimum distance is in the past
  // and current distance is noticeably higher. Zero the approach score.
  const { minI, minD } = findMinDistanceIndex(window, station);
  const passedByWindow = (
    minI < window.length - 2 &&
    distanceMeters > minD + 30 &&
    distanceMeters > 80
  );
  if (passedByWindow) {
    approachScore = 0;
  }

  // --- Speed score (in-range check for "driveable approach" speeds) ---
  const speedSamples = validSpeeds(window);
  let speedScore = 0.5;
  let meanSpeed = 0;
  if (speedSamples.length > 0) {
    meanSpeed = avg(speedSamples);
    // Rewards urban approach speeds (2–13 m/s ≈ 5–29 mph); penalizes highway.
    const lowerScore = smoothstep(0.3, 2.2, meanSpeed);
    const upperScore = 1 - smoothstep(13.0, 22.0, meanSpeed);
    speedScore = lowerScore * upperScore;
    if (distanceMeters < 400 && meanSpeed < 1.0) {
      // Parked-near-station ambiguity; dwell override below handles true parking.
      speedScore = Math.min(speedScore, 0.3);
    }
  }

  // --- Deceleration score ---
  // Compare newest quarter to oldest quarter of the window.
  // - Strong decel (speed dropped > 45%)  → 1.0   (clear stopping intent)
  // - Constant speed                       → 0.35  (non-accelerating baseline)
  // - Clearly accelerating                  → 0     (pulling away, not stopping)
  const qLen = Math.max(2, Math.floor(window.length / 4));
  const oldQ = validSpeeds(window.slice(0, qLen));
  const newQ = validSpeeds(window.slice(-qLen));
  const oldMeanSpeed = avg(oldQ);
  const newMeanSpeed = avg(newQ);
  let decelScore = 0;
  let speedRatio = 1;
  if (oldMeanSpeed > 1.5) {
    speedRatio = newMeanSpeed / oldMeanSpeed;
    // Curve: ratio 0.5 → 1.0 | ratio 1.0 → ~0.32 | ratio 1.3 → ~0.0
    decelScore = 1 - smoothstep(0.5, 1.3, speedRatio);
  } else if (newMeanSpeed < 1.5) {
    // Already stopped or never moving — gets full "at rest" credit if near station.
    decelScore = distanceMeters < 300 ? 1 : 0.2;
  } else {
    // Started from rest and accelerating (leaving somewhere) — weak signal.
    decelScore = 0.2;
  }

  // --- Trajectory projection (CPA and cross-track) ---
  const proj = projectStationOntoTrajectory(window, station);
  // pathScore: station must be within ~40m of the vehicle's heading line to
  // count as "directly on path" (accounts for typical urban GPS drift), and
  // is fully off-path beyond ~200m (2 lanes + parallel lot is ~60m;
  // 200m is definitely on a different street/block).
  const pathScore = 1 - smoothstep(40, 200, proj.crossTrack);
  // cpaScore: applied multiplicatively. Station clearly behind the vehicle's
  // direction of travel → cpaScore trends toward 0.
  // alongTrack > 0 means station is still ahead.
  let cpaScore;
  if (proj.motionLength < 5) {
    // Vehicle not moving — can't compute direction. Neutral.
    cpaScore = 0.8;
  } else if (proj.alongTrack >= 0) {
    cpaScore = 1.0;
  } else {
    // alongTrack negative: how far behind? Normalize against distance to station.
    // Allow slight overshoot (e.g. ~30m) without hard-penalizing — GPS is noisy.
    cpaScore = 1 - smoothstep(-30, -200, proj.alongTrack);
  }

  // --- Intent signals (history, time pattern, urgency) ---
  // Use the newest sample's timestamp as "now" so unit tests can simulate
  // different times of day without touching Date.now().
  const nowMs = current.timestamp || Date.now();
  const historyScore = computeHistoryScore(station, opts.userProfile, nowMs);
  const timePatternScore = computeTimePatternScore(station, opts.userProfile, nowMs);
  // Intent score combines history, time pattern, and tank urgency. Any one
  // being strong is enough — we don't require all three.
  const intentScore = Math.max(historyScore, timePatternScore, urgency * 0.9);

  // Road-trip context (computed once per engine call, but we recompute per
  // station for simplicity — cheap).
  const roadTripCtx = detectRoadTripContext(window, opts);
  const isRoadTrip = roadTripCtx.score >= 0.6;

  // --- Base confidence ---
  let base =
    bearingScore * bearingWeight +
    approachScore * approachWeight +
    speedScore * speedWeight +
    decelScore * decelWeight +
    pathScore * pathWeight +
    intentScore * intentWeight;

  // CPA gate (multiplicative). Station behind vehicle hard-suppresses trigger.
  base *= cpaScore;

  // --- Speed/decel combined gate ---
  // A vehicle still cruising at high speed with no deceleration is not about
  // to fuel. 12 m/s (~27 mph) is the lower bound — 25 mph urban approaches
  // stay in the clear so they aren't penalized, while 30+ mph drive-bys get
  // hit hard.
  const cruisingNoStop = newMeanSpeed > 12.0 && decelScore < 0.4;
  if (cruisingNoStop) {
    const speedPenaltyStrength = clamp((newMeanSpeed - 12.0) / 5.0, 0, 1);
    base *= 1 - speedPenaltyStrength * 0.80;
  }

  // Sustained acceleration across the window (e.g., pulling away from a light)
  // strongly suggests the vehicle is not stopping at this station.
  if (oldMeanSpeed > 1.5 && speedRatio > 1.18) {
    const accelStrength = clamp((speedRatio - 1.18) / 0.5, 0, 1);
    base *= 1 - accelStrength * 0.55;
  }

  // --- Drive-through suppression ---
  // Very close to the station, but still moving at normal driving speed and
  // not decelerating → the driver is physically passing through.
  if (distanceMeters < 140 && newMeanSpeed > 4.5 && decelScore < 0.35) {
    base = Math.min(base, 0.25);
  }

  // --- Dwell override ---
  // Driver has brought the vehicle to a near-stop within ~80m of the pump.
  // This is an unambiguous "they parked here" signal.
  if (distanceMeters < 80 && newMeanSpeed < 1.5) {
    base = Math.max(base, 0.85);
  }

  // --- ETA gate ---
  // If the vehicle would take many minutes to reach the station at current
  // speed AND is not decelerating, the signal is speculative. A driver
  // doesn't typically plan a fuel stop 10 minutes in advance — either they'll
  // decelerate (bumping decelScore) or they'll change direction (bumping CPA).
  // Road trips / highway cruises legitimately have long ETAs, so we soften
  // this gate when road-trip mode is active.
  if (newMeanSpeed > 1.0 && proj.alongTrack > 0) {
    const etaSeconds = proj.alongTrack / newMeanSpeed;
    const etaRelaxed = isRoadTrip || urgency > 0.5;
    const etaCutoff = etaRelaxed ? 360 : 180;
    if (etaSeconds > etaCutoff && decelScore < 0.3) {
      const etaPenaltyStrength = etaRelaxed ? 0.3 : 0.5;
      const etaPenalty = clamp((etaSeconds - etaCutoff) / 420, 0, 1);
      base *= 1 - etaPenalty * etaPenaltyStrength;
    }
  }

  // --- Far-field intent gate ---
  // At long distances, physics alone is ambiguous — many stations are "ahead"
  // and "on my path". The engine only triggers far out when there's a clear
  // intent signal (visit history, time-of-day pattern, or tank urgency).
  //
  // In road-trip mode, we relax this gate (road trippers have no history by
  // definition, and we want them to get early-warning notifications when
  // their tank is running low).
  if (distanceMeters > farFieldDistanceMeters && !isRoadTrip) {
    const farness = smoothstep(farFieldDistanceMeters, farFieldDistanceMeters + 3500, distanceMeters);
    if (intentScore < 0.25) {
      // No intent signal — suppress far-field confidence.
      // farness 1 → multiply by 0.35; farness 0.5 → multiply by ~0.67.
      base *= 1 - farness * 0.65;
    } else {
      // Intent is present — give a distance-aware boost.
      base += intentScore * farness * 0.22;
    }
  } else if (distanceMeters > farFieldDistanceMeters && isRoadTrip) {
    // Road trip: boost based on urgency + physics. No history needed.
    // Capped so we don't blast notifications for every station on the highway.
    const farness = smoothstep(farFieldDistanceMeters, farFieldDistanceMeters + 4500, distanceMeters);
    base += urgency * farness * 0.28;
    // Physics requirement: still must be ahead, on-path, and not receding.
    // That's already enforced by cpaScore and pathScore above.
  }

  // --- GPS accuracy down-weight ---
  // If the window's average GPS accuracy is poor (> minAccuracyMeters), reduce
  // confidence — a noisy fix is not reliable enough to surface a notification.
  const meanAcc = avgAccuracy(window);
  if (meanAcc > minAccuracyMeters) {
    const accuracyPenalty = clamp((meanAcc - minAccuracyMeters) / minAccuracyMeters, 0, 1);
    base *= 1 - accuracyPenalty * 0.5;
  }

  // --- Profile bonus / penalty ---
  // Profile effects only apply once the base is credible. This prevents a
  // "my favorite Shell" bonus from creating triggers on drive-bys that would
  // otherwise have been rejected.
  let profileAdjustment = 0;
  if (base >= 0.35) {
    profileAdjustment += computeProfileBonus(station, opts.userProfile, allCandidateStations);
    if (typeof computeProfilePenalty === 'function') {
      profileAdjustment -= computeProfilePenalty(station, opts.userProfile, allCandidateStations);
    }
  }

  const confidence = clamp(base + profileAdjustment, 0, 1);

  return {
    stationId: station.stationId,
    confidence,
    bearingScore,
    approachScore,
    speedScore,
    decelScore,
    pathScore,
    cpaScore,
    historyScore,
    timePatternScore,
    intentScore,
    isRoadTrip,
    distanceMeters,
    alongTrack: proj.alongTrack,
    crossTrack: proj.crossTrack,
  };
}

function createPredictiveFuelingEngine(options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let window = [];
  let stations = [];
  const cooldowns = new Map();
  // Track how long each station's confidence has been above threshold. Used
  // for a "sustained" guard that prevents single-sample confidence spikes from
  // triggering — a moderate but not excessive form of temporal smoothing.
  const sustainedCount = new Map();
  const SUSTAIN_REQUIRED = Math.max(1, Math.floor(opts.sustainRequired || 3));

  function pushLocation(sample) {
    window.push(sample);
    if (window.length > opts.windowSize) {
      window = window.slice(window.length - opts.windowSize);
    }

    const now = sample.timestamp || Date.now();
    const scores = new Map();
    const current = window[window.length - 1];

    const candidatesInRadius = stations.filter(station => {
      const dist = haversineDistanceMeters(
        { latitude: current.latitude, longitude: current.longitude },
        { latitude: station.latitude, longitude: station.longitude }
      );
      return dist <= opts.maxCandidateRadiusMeters;
    });

    // Clear sustain counts for stations that left the radius.
    const inRadiusIds = new Set(candidatesInRadius.map(s => s.stationId));
    for (const id of Array.from(sustainedCount.keys())) {
      if (!inRadiusIds.has(id)) sustainedCount.delete(id);
    }

    for (const station of candidatesInRadius) {
      const score = scoreStation(window, station, opts, candidatesInRadius);
      scores.set(station.stationId, score);

      if (score.confidence >= opts.triggerThreshold) {
        const prevCount = sustainedCount.get(station.stationId) || 0;
        sustainedCount.set(station.stationId, prevCount + 1);

        if (prevCount + 1 >= SUSTAIN_REQUIRED) {
          const cooldownExpiry = cooldowns.get(station.stationId) || 0;
          if (now >= cooldownExpiry) {
            cooldowns.set(station.stationId, now + opts.cooldownMs);
            if (typeof opts.onTrigger === 'function') {
              opts.onTrigger({
                type: 'trigger',
                stationId: station.stationId,
                confidence: score.confidence,
                location: sample,
                triggeredAt: now,
              });
            }
          }
        }
      } else {
        sustainedCount.delete(station.stationId);
      }
    }

    if (typeof opts.onScoresUpdated === 'function') {
      opts.onScoresUpdated(scores);
    }

    return scores;
  }

  function setStations(newStations) {
    stations = newStations || [];
  }

  function setUserProfile(profile) {
    opts.userProfile = profile;
  }

  function getScores() {
    if (window.length < 3) return new Map();
    const current = window[window.length - 1];
    const scores = new Map();
    const candidatesInRadius = stations.filter(station => {
      const dist = haversineDistanceMeters(
        { latitude: current.latitude, longitude: current.longitude },
        { latitude: station.latitude, longitude: station.longitude }
      );
      return dist <= opts.maxCandidateRadiusMeters;
    });
    for (const station of candidatesInRadius) {
      scores.set(station.stationId, scoreStation(window, station, opts, candidatesInRadius));
    }
    return scores;
  }

  function reset() {
    window = [];
    cooldowns.clear();
    sustainedCount.clear();
  }

  function getWindow() {
    return [...window];
  }

  return { setStations, setUserProfile, pushLocation, getScores, reset, getWindow };
}

module.exports = { createPredictiveFuelingEngine, scoreStation };
