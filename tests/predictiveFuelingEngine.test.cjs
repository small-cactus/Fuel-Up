const test = require('node:test');
const assert = require('node:assert/strict');
const { createPredictiveFuelingEngine } = require('../src/lib/predictiveFuelingEngine.js');

// Helper: create a location sample
function makeSample(lat, lon, heading = 0, speed = 8, timestamp = Date.now()) {
  return { latitude: lat, longitude: lon, heading, speed, timestamp };
}

// Helper: create a station
function makeStation(id, lat, lon) {
  return { stationId: id, stationName: id, latitude: lat, longitude: lon, price: 3.0, distanceMiles: 0, brand: 'Test' };
}

// Helper: build a window of samples heading due-north from (lat, lon), each step ~50m north
function buildApproachWindow(targetLat, targetLon, count = 10, startDistanceM = 800) {
  // Start south of target, heading north
  const latDegPerMeter = 1 / 111320;
  const samples = [];
  for (let i = 0; i < count; i++) {
    const progress = i / (count - 1);
    const distRemaining = startDistanceM * (1 - progress * 0.7); // closing in
    const lat = targetLat - distRemaining * latDegPerMeter;
    samples.push(makeSample(lat, targetLon, 0, 8, Date.now() + i * 3000));
  }
  return samples;
}

test('pushLocation with fewer than 3 samples returns zero-confidence scores', () => {
  const engine = createPredictiveFuelingEngine();
  const station = makeStation('s1', 39.74, -104.99);
  engine.setStations([station]);
  engine.pushLocation(makeSample(39.73, -104.99));
  engine.pushLocation(makeSample(39.732, -104.99));
  const scores = engine.getScores();
  if (scores.has('s1')) {
    assert.equal(scores.get('s1').confidence, 0);
  }
  // Scores map may be empty (< 3 samples guard) — both valid
});

test('bearing score near 1.0 when moving directly toward station (due north)', () => {
  const engine = createPredictiveFuelingEngine({ triggerThreshold: 999 }); // disable trigger
  const station = makeStation('s1', 39.75, -104.99);
  engine.setStations([station]);
  const samples = buildApproachWindow(39.75, -104.99, 8, 600);
  for (const s of samples) engine.pushLocation(s);
  const scores = engine.getScores();
  assert.ok(scores.has('s1'), 'station should be scored');
  assert.ok(scores.get('s1').bearingScore >= 0.8, `bearingScore should be >= 0.8, got ${scores.get('s1').bearingScore}`);
});

test('bearing score near 0 when moving directly away from station', () => {
  const engine = createPredictiveFuelingEngine({ triggerThreshold: 999 });
  const station = makeStation('s1', 39.74, -104.99);
  engine.setStations([station]);
  // Start near station and move north (away)
  const latDegPerMeter = 1 / 111320;
  for (let i = 0; i < 8; i++) {
    engine.pushLocation(makeSample(39.741 + i * 50 * latDegPerMeter, -104.99, 0, 8, Date.now() + i * 3000));
  }
  const scores = engine.getScores();
  if (scores.has('s1')) {
    assert.ok(scores.get('s1').bearingScore <= 0.2, `bearingScore should be <= 0.2, got ${scores.get('s1').bearingScore}`);
  }
});

test('approach score rises as vehicle closes distance', () => {
  const engine = createPredictiveFuelingEngine({ triggerThreshold: 999 });
  const station = makeStation('s1', 39.75, -104.99);
  engine.setStations([station]);
  const samples = buildApproachWindow(39.75, -104.99, 12, 1000);
  for (const s of samples) engine.pushLocation(s);
  const scores = engine.getScores();
  assert.ok(scores.has('s1'));
  assert.ok(scores.get('s1').approachScore >= 0.6, `approachScore should be >= 0.6, got ${scores.get('s1').approachScore}`);
});

test('approach score is low when driving parallel to and past a station', () => {
  const engine = createPredictiveFuelingEngine({ triggerThreshold: 999 });
  // Vehicle drives due north starting already north of the station — purely receding.
  // Station is 400m to the east and south of the entire drive path.
  // This simulates driving on a parallel road past a station without approaching it.
  const latDegPerMeter = 1 / 111320;
  const lonDegPerMeter = 1 / (111320 * Math.cos(39.74 * Math.PI / 180));
  // Station is south of the drive: at 39.737; vehicle drives from 39.740 northward
  const station = makeStation('s1', 39.737, -104.99 + 400 * lonDegPerMeter);
  engine.setStations([station]);
  for (let i = 0; i < 12; i++) {
    engine.pushLocation(makeSample(39.740 + i * 50 * latDegPerMeter, -104.99, 0, 8, Date.now() + i * 3000));
  }
  const scores = engine.getScores();
  if (scores.has('s1')) {
    assert.ok(scores.get('s1').approachScore <= 0.3, `approachScore should be <= 0.3, got ${scores.get('s1').approachScore}`);
  }
});

test('confidence exceeds threshold and triggers onTrigger callback', () => {
  let triggerEvent = null;
  const engine = createPredictiveFuelingEngine({
    triggerThreshold: 0.72,
    onTrigger: (event) => { triggerEvent = event; },
  });
  const station = makeStation('s1', 39.75, -104.99);
  engine.setStations([station]);
  const samples = buildApproachWindow(39.75, -104.99, 15, 800);
  for (const s of samples) engine.pushLocation(s);
  assert.ok(triggerEvent !== null, 'onTrigger should have been called');
  assert.equal(triggerEvent.stationId, 's1');
  assert.ok(triggerEvent.confidence >= 0.72);
});

test('cooldown suppresses second trigger within cooldown window', () => {
  let triggerCount = 0;
  const engine = createPredictiveFuelingEngine({
    triggerThreshold: 0.72,
    cooldownMs: 60000,
    onTrigger: () => { triggerCount++; },
  });
  const station = makeStation('s1', 39.75, -104.99);
  engine.setStations([station]);
  const now = Date.now();
  const samples = buildApproachWindow(39.75, -104.99, 15, 800);
  for (const s of samples) engine.pushLocation({ ...s, timestamp: now });
  // Feed more perfect approach samples
  for (const s of samples) engine.pushLocation({ ...s, timestamp: now + 1000 });
  assert.equal(triggerCount, 1, 'should only trigger once due to cooldown');
});

test('reset() clears window and cooldown state, allowing re-trigger', () => {
  let triggerCount = 0;
  const engine = createPredictiveFuelingEngine({
    triggerThreshold: 0.72,
    cooldownMs: 60000,
    onTrigger: () => { triggerCount++; },
  });
  const station = makeStation('s1', 39.75, -104.99);
  engine.setStations([station]);
  const samples = buildApproachWindow(39.75, -104.99, 15, 800);
  for (const s of samples) engine.pushLocation(s);
  assert.equal(triggerCount, 1);
  engine.reset();
  for (const s of samples) engine.pushLocation({ ...s, timestamp: Date.now() + 100000 });
  assert.equal(triggerCount, 2, 'should trigger again after reset()');
});

test('speed score penalizes highway speed near a close station', () => {
  const engine = createPredictiveFuelingEngine({ triggerThreshold: 999 });
  const station = makeStation('s1', 39.7503, -104.99); // ~300m north
  engine.setStations([station]);
  const latDegPerMeter = 1 / 111320;
  for (let i = 0; i < 10; i++) {
    engine.pushLocation(makeSample(39.748 + i * 10 * latDegPerMeter, -104.99, 0, 30, Date.now() + i * 1000)); // 30 m/s = ~67mph
  }
  const scores = engine.getScores();
  if (scores.has('s1')) {
    assert.ok(scores.get('s1').speedScore <= 0.3, `speedScore should be <= 0.3 at highway speed, got ${scores.get('s1').speedScore}`);
  }
});

test('stations outside maxCandidateRadiusMeters are not scored', () => {
  const engine = createPredictiveFuelingEngine({ maxCandidateRadiusMeters: 4000, triggerThreshold: 999 });
  // Station is ~12km north; vehicle stays well south, never closer than ~10km
  const farStation = makeStation('far', 39.90, -104.99); // ~12km north of 39.79
  engine.setStations([farStation]);
  const latDegPerMeter = 1 / 111320;
  for (let i = 0; i < 10; i++) {
    // Vehicle drives around 39.79 — always >10km from the station at 39.90
    engine.pushLocation(makeSample(39.790 + i * 10 * latDegPerMeter, -104.99, 0, 8, Date.now() + i * 3000));
  }
  const scores = engine.getScores();
  assert.ok(!scores.has('far'), 'station outside radius should not be scored');
});

test('setStations() replaces candidate list mid-window', () => {
  const engine = createPredictiveFuelingEngine({ triggerThreshold: 999 });
  const stationA = makeStation('a', 39.75, -104.99);
  const stationB = makeStation('b', 39.73, -104.95);
  engine.setStations([stationA]);
  const samplesA = buildApproachWindow(39.75, -104.99, 5, 500);
  for (const s of samplesA) engine.pushLocation(s);
  // Replace stations
  engine.setStations([stationB]);
  const samples2 = buildApproachWindow(39.75, -104.99, 5, 400);
  for (const s of samples2) engine.pushLocation(s);
  const scores = engine.getScores();
  assert.ok(!scores.has('a'), 'old station should not be scored after setStations');
});

// --- NEW SIGNAL TESTS ---

test('cpaScore approaches 0 when station is behind vehicle direction of travel', () => {
  const engine = createPredictiveFuelingEngine({ triggerThreshold: 999 });
  // Station is north, vehicle is at the station and continues heading north
  // (station becomes behind).
  const station = makeStation('s1', 39.74, -104.99);
  engine.setStations([station]);
  const latDegPerMeter = 1 / 111320;
  // Start at station and drive north away from it for 300m
  for (let i = 0; i < 10; i++) {
    engine.pushLocation(makeSample(39.74 + i * 30 * latDegPerMeter, -104.99, 0, 8, Date.now() + i * 3000));
  }
  const scores = engine.getScores();
  if (scores.has('s1')) {
    const s = scores.get('s1');
    assert.ok(s.cpaScore <= 0.1, `cpaScore should be ~0 when station is behind, got ${s.cpaScore}`);
    assert.ok(s.confidence <= 0.2, `confidence should be suppressed, got ${s.confidence}`);
  }
});

test('pathScore is 1 for on-path station, near 0 for off-path station', () => {
  const engine = createPredictiveFuelingEngine({ triggerThreshold: 999 });
  // Station 1: directly north, on-path
  // Station 2: north but 300m east — off-path for a due-north drive
  const lonDegPerMeter = 1 / (111320 * Math.cos(39.74 * Math.PI / 180));
  const onPath = makeStation('on', 39.75, -104.99);
  const offPath = makeStation('off', 39.75, -104.99 + 300 * lonDegPerMeter);
  engine.setStations([onPath, offPath]);
  const samples = buildApproachWindow(39.75, -104.99, 10, 600);
  for (const s of samples) engine.pushLocation(s);
  const scores = engine.getScores();
  const onScore = scores.get('on');
  const offScore = scores.get('off');
  assert.ok(onScore.pathScore >= 0.8, `on-path pathScore should be >= 0.8, got ${onScore.pathScore}`);
  assert.ok(offScore.pathScore <= 0.2, `off-path pathScore should be <= 0.2, got ${offScore.pathScore}`);
  assert.ok(offScore.confidence < onScore.confidence, 'off-path confidence must be lower');
});

test('decelScore is high when vehicle strongly decelerates', () => {
  const engine = createPredictiveFuelingEngine({ triggerThreshold: 999 });
  const station = makeStation('s1', 39.75, -104.99);
  engine.setStations([station]);
  // Start at 15 m/s, slow to 3 m/s by end of window
  const latDegPerMeter = 1 / 111320;
  const count = 12;
  for (let i = 0; i < count; i++) {
    const progress = i / (count - 1);
    const speed = 15 - progress * 12; // 15 → 3 m/s
    const lat = 39.75 - (600 - i * 50) * latDegPerMeter;
    engine.pushLocation(makeSample(lat, -104.99, 0, speed, Date.now() + i * 2000));
  }
  const scores = engine.getScores();
  assert.ok(scores.has('s1'));
  assert.ok(scores.get('s1').decelScore >= 0.8, `decelScore should be >= 0.8 for strong decel, got ${scores.get('s1').decelScore}`);
});

test('decelScore is 0 when vehicle accelerates', () => {
  const engine = createPredictiveFuelingEngine({ triggerThreshold: 999 });
  const station = makeStation('s1', 39.75, -104.99);
  engine.setStations([station]);
  // Start at 3 m/s, speed up to 12 m/s
  const latDegPerMeter = 1 / 111320;
  const count = 12;
  for (let i = 0; i < count; i++) {
    const progress = i / (count - 1);
    const speed = 3 + progress * 9;
    const lat = 39.75 - (600 - i * 50) * latDegPerMeter;
    engine.pushLocation(makeSample(lat, -104.99, 0, speed, Date.now() + i * 2000));
  }
  const scores = engine.getScores();
  if (scores.has('s1')) {
    assert.ok(scores.get('s1').decelScore <= 0.1, `decelScore should be ~0 for accel, got ${scores.get('s1').decelScore}`);
  }
});

test('dwell override: near-stopped within 80m triggers even with weak base', () => {
  let triggered = null;
  const engine = createPredictiveFuelingEngine({
    triggerThreshold: 0.72,
    onTrigger: e => { if (!triggered) triggered = e; },
  });
  const station = makeStation('s1', 39.75, -104.99);
  engine.setStations([station]);
  const latDegPerMeter = 1 / 111320;
  // Sit stationary 30m south of station
  for (let i = 0; i < 10; i++) {
    engine.pushLocation(makeSample(39.75 - 30 * latDegPerMeter, -104.99, 0, 0, Date.now() + i * 3000));
  }
  assert.ok(triggered !== null, 'dwell override should have fired trigger');
});

test('drive-through suppression: moderate speed right at station does not trigger', () => {
  let triggered = null;
  const engine = createPredictiveFuelingEngine({
    triggerThreshold: 0.72,
    onTrigger: e => { if (!triggered) triggered = e; },
  });
  const station = makeStation('s1', 39.75, -104.99);
  engine.setStations([station]);
  const latDegPerMeter = 1 / 111320;
  // Move north at 8 m/s, passing directly through the station at constant speed.
  // Vehicle enters from 100m south and exits 100m north without slowing.
  for (let i = 0; i < 12; i++) {
    const lat = 39.75 - 100 * latDegPerMeter + i * 20 * latDegPerMeter;
    engine.pushLocation(makeSample(lat, -104.99, 0, 8, Date.now() + i * 2000));
  }
  // A cruise through the station without decelerating is not a fuel stop.
  // Confidence should be held down by the drive-through / CPA suppressions.
  const scores = engine.getScores();
  if (scores.has('s1')) {
    const s = scores.get('s1');
    assert.ok(s.confidence < 0.72, `drive-through should not trigger, got conf=${s.confidence}`);
  }
});

test('sustained-confidence guard: single-sample spike does not fire trigger', () => {
  let triggerCount = 0;
  const engine = createPredictiveFuelingEngine({
    triggerThreshold: 0.72,
    sustainRequired: 3,
    onTrigger: () => { triggerCount++; },
  });
  const station = makeStation('s1', 39.75, -104.99);
  engine.setStations([station]);
  // Feed a long sequence where only ONE sample produces high confidence
  // (we'll alternate speeds to break the sustain chain).
  const samples = buildApproachWindow(39.75, -104.99, 12, 600);
  // Corrupt every other sample with a large lateral jump (simulates a bad GPS
  // fix that breaks the smoothed heading and drops confidence).
  for (let i = 0; i < samples.length; i++) {
    if (i % 2 === 1) {
      samples[i] = { ...samples[i], longitude: samples[i].longitude + 0.005 };
    }
  }
  for (const s of samples) engine.pushLocation(s);
  assert.equal(triggerCount, 0, 'spiky confidence should not trigger');
});

test('GPS accuracy below threshold downweights confidence', () => {
  const engineGood = createPredictiveFuelingEngine({ triggerThreshold: 999 });
  const engineBad = createPredictiveFuelingEngine({ triggerThreshold: 999 });
  const station = makeStation('s1', 39.75, -104.99);
  engineGood.setStations([station]);
  engineBad.setStations([station]);
  const goodSamples = buildApproachWindow(39.75, -104.99, 10, 600).map(s => ({ ...s, accuracy: 10 }));
  const badSamples = buildApproachWindow(39.75, -104.99, 10, 600).map(s => ({ ...s, accuracy: 120 }));
  for (const s of goodSamples) engineGood.pushLocation(s);
  for (const s of badSamples) engineBad.pushLocation(s);
  const goodConf = engineGood.getScores().get('s1').confidence;
  const badConf = engineBad.getScores().get('s1').confidence;
  assert.ok(badConf < goodConf, `bad-accuracy confidence (${badConf}) should be less than good (${goodConf})`);
});

test('profile-aware penalty: expensive station gets lower confidence for cheapest profile', () => {
  const { PROFILE_PRESETS } = require('../src/lib/userFuelingProfile.js');
  const cheapest = PROFILE_PRESETS.cheapest;

  const engineWithProfile = createPredictiveFuelingEngine({
    triggerThreshold: 999,
    userProfile: cheapest,
  });
  const engineNoProfile = createPredictiveFuelingEngine({ triggerThreshold: 999 });

  const expensive = { ...makeStation('exp', 39.75, -104.99), price: 3.99, brand: 'Shell' };
  const cheap = { ...makeStation('chp', 39.745, -104.98), price: 2.99, brand: 'Costco' };
  engineWithProfile.setStations([expensive, cheap]);
  engineNoProfile.setStations([expensive, cheap]);

  const samples = buildApproachWindow(39.75, -104.99, 12, 800);
  for (const s of samples) {
    engineWithProfile.pushLocation(s);
    engineNoProfile.pushLocation(s);
  }
  const profConf = engineWithProfile.getScores().get('exp').confidence;
  const plainConf = engineNoProfile.getScores().get('exp').confidence;
  assert.ok(profConf < plainConf, `profile penalty should reduce confidence (${profConf} vs ${plainConf})`);
});
