/**
 * Lightweight feedforward neural network for stop prediction.
 *
 * Features (12):
 *   0: bearing_score       (0–1)
 *   1: approach_score      (0–1)
 *   2: speed_score         (0–1)
 *   3: distance_norm       (0–1, normalized by maxRadius)
 *   4: time_sin            (sin of hour/24 * 2π)
 *   5: time_cos            (cos of hour/24 * 2π)
 *   6: history_score       (0–1, from user profile)
 *   7: fuel_grade_match    (0 or 1)
 *   8: price_rank_norm     (0–1, best price = 1)
 *   9: urgency             (0–1, from range estimator)
 *  10: path_score          (0–1, on-corridor alignment)
 *  11: intent_score        (0–1, history/time/urgency blend from engine)
 *
 * Architecture: 12 → 14 → 1, sigmoid activations
 * Output: probability of stopping at this station (0–1)
 */

const INPUT_SIZE = 12;
const HIDDEN_SIZE = 14;
const OUTPUT_SIZE = 1;

function sigmoid(x) {
  return 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, x))));
}

function sigmoidDerivative(sigOutput) {
  return sigOutput * (1 - sigOutput);
}

function createMLPredictor() {
  // Initialize weights with Xavier initialization
  const scale1 = Math.sqrt(2.0 / INPUT_SIZE);
  const scale2 = Math.sqrt(2.0 / HIDDEN_SIZE);

  // W1: INPUT_SIZE × HIDDEN_SIZE (flat row-major)
  let W1 = Array.from({ length: INPUT_SIZE * HIDDEN_SIZE }, () => (Math.random() * 2 - 1) * scale1);
  let b1 = new Array(HIDDEN_SIZE).fill(0);
  // W2: HIDDEN_SIZE × OUTPUT_SIZE
  let W2 = Array.from({ length: HIDDEN_SIZE * OUTPUT_SIZE }, () => (Math.random() * 2 - 1) * scale2);
  let b2 = new Array(OUTPUT_SIZE).fill(0);

  let trained = false;
  let trainingLog = []; // { epoch, loss, accuracy }

  /**
   * Forward pass for a single sample.
   * @param {number[]} x - feature vector of length INPUT_SIZE
   * @returns {{ a1: number[], a2: number[] }}
   */
  function forward(x) {
    // Hidden layer
    const z1 = new Array(HIDDEN_SIZE).fill(0);
    for (let j = 0; j < HIDDEN_SIZE; j++) {
      let sum = b1[j];
      for (let i = 0; i < INPUT_SIZE; i++) {
        sum += x[i] * W1[i * HIDDEN_SIZE + j];
      }
      z1[j] = sum;
    }
    const a1 = z1.map(sigmoid);

    // Output layer
    const z2 = new Array(OUTPUT_SIZE).fill(0);
    for (let k = 0; k < OUTPUT_SIZE; k++) {
      let sum = b2[k];
      for (let j = 0; j < HIDDEN_SIZE; j++) {
        sum += a1[j] * W2[j * OUTPUT_SIZE + k];
      }
      z2[k] = sum;
    }
    const a2 = z2.map(sigmoid);

    return { a1, a2 };
  }

  /**
   * Train on labeled examples.
   * @param {Array<{ features: number[], label: number }>} data
   * @param {Object} options
   */
  function train(data, options = {}) {
    const {
      epochs = 300,
      learningRate = 0.05,
      batchSize = 16,
    } = options;

    trainingLog = [];

    for (let epoch = 0; epoch < epochs; epoch++) {
      // Shuffle
      const shuffled = [...data].sort(() => Math.random() - 0.5);
      let totalLoss = 0;

      for (let bStart = 0; bStart < shuffled.length; bStart += batchSize) {
        const batch = shuffled.slice(bStart, bStart + batchSize);

        // Accumulators for gradients
        const dW1 = new Array(INPUT_SIZE * HIDDEN_SIZE).fill(0);
        const db1 = new Array(HIDDEN_SIZE).fill(0);
        const dW2 = new Array(HIDDEN_SIZE * OUTPUT_SIZE).fill(0);
        const db2 = new Array(OUTPUT_SIZE).fill(0);

        for (const { features, label } of batch) {
          const x = features;
          const y = label;
          const { a1, a2 } = forward(x);

          const eps = 1e-7;
          totalLoss += -(y * Math.log(a2[0] + eps) + (1 - y) * Math.log(1 - a2[0] + eps));

          // Output layer gradient: dL/dz2 = a2 - y (BCE + sigmoid simplification)
          const dz2 = [a2[0] - y];

          // dW2, db2
          for (let j = 0; j < HIDDEN_SIZE; j++) {
            for (let k = 0; k < OUTPUT_SIZE; k++) {
              dW2[j * OUTPUT_SIZE + k] += a1[j] * dz2[k];
            }
          }
          for (let k = 0; k < OUTPUT_SIZE; k++) db2[k] += dz2[k];

          // Hidden layer gradient
          const da1 = new Array(HIDDEN_SIZE).fill(0);
          for (let j = 0; j < HIDDEN_SIZE; j++) {
            for (let k = 0; k < OUTPUT_SIZE; k++) {
              da1[j] += W2[j * OUTPUT_SIZE + k] * dz2[k];
            }
          }
          const dz1 = a1.map((aj, j) => da1[j] * sigmoidDerivative(aj));

          for (let i = 0; i < INPUT_SIZE; i++) {
            for (let j = 0; j < HIDDEN_SIZE; j++) {
              dW1[i * HIDDEN_SIZE + j] += x[i] * dz1[j];
            }
          }
          for (let j = 0; j < HIDDEN_SIZE; j++) db1[j] += dz1[j];
        }

        // Update weights (average gradient over batch)
        const n = batch.length;
        const lr = learningRate;
        for (let i = 0; i < W1.length; i++) W1[i] -= lr * dW1[i] / n;
        for (let j = 0; j < HIDDEN_SIZE; j++) b1[j] -= lr * db1[j] / n;
        for (let i = 0; i < W2.length; i++) W2[i] -= lr * dW2[i] / n;
        for (let k = 0; k < OUTPUT_SIZE; k++) b2[k] -= lr * db2[k] / n;
      }

      if (epoch % 50 === 0 || epoch === epochs - 1) {
        const avgLoss = totalLoss / shuffled.length;
        trainingLog.push({ epoch, loss: Math.round(avgLoss * 10000) / 10000 });
      }
    }

    trained = true;
    // Compute final accuracy
    let finalCorrect = 0;
    for (const { features, label } of data) {
      const { a2 } = forward(features);
      if ((a2[0] >= 0.5 ? 1 : 0) === label) finalCorrect++;
    }
    return {
      trained: true,
      trainingAccuracy: Math.round((finalCorrect / data.length) * 100),
      trainingLog,
    };
  }

  /**
   * Predict stop probability for a feature vector.
   */
  function predict(features) {
    const { a2 } = forward(features);
    return a2[0];
  }

  /**
   * Evaluate on labeled test data. Returns precision, recall, F1.
   * @param {Array<{ features: number[], label: number }>} testData
   * @param {number} threshold
   */
  function evaluate(testData, threshold = 0.5) {
    let tp = 0, fp = 0, fn = 0, tn = 0;
    for (const { features, label } of testData) {
      const prob = predict(features);
      const predicted = prob >= threshold ? 1 : 0;
      if (predicted === 1 && label === 1) tp++;
      else if (predicted === 1 && label === 0) fp++;
      else if (predicted === 0 && label === 1) fn++;
      else tn++;
    }
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;
    const accuracy = (tp + tn) / testData.length;
    return {
      tp, fp, fn, tn,
      precision: Math.round(precision * 100) / 100,
      recall: Math.round(recall * 100) / 100,
      f1: Math.round(f1 * 100) / 100,
      accuracy: Math.round(accuracy * 100),
    };
  }

  function isTrained() { return trained; }
  function getTrainingLog() { return trainingLog; }

  // Serialize weights for persistence (optional)
  function exportWeights() {
    return JSON.stringify({ W1, b1, W2, b2 });
  }

  function importWeights(json) {
    const w = JSON.parse(json);
    W1 = w.W1; b1 = w.b1; W2 = w.W2; b2 = w.b2;
    trained = true;
  }

  return { train, predict, evaluate, isTrained, getTrainingLog, exportWeights, importWeights };
}

/**
 * Build feature vector for a station at a given prediction context.
 * @param {Object} scores - from engine.getScores() for this station
 * @param {Object} station
 * @param {Object[]} allStations
 * @param {Object} context - { timestampMs, urgency, userHistoryScore, fuelGradeMatch }
 * @param {number} maxRadiusMeters
 */
function buildFeatureVector(scores, station, allStations, context, maxRadiusMeters) {
  if (context === undefined) context = {};
  if (maxRadiusMeters === undefined) maxRadiusMeters = 4000;

  const {
    timestampMs = Date.now(),
    urgency = 0,
    userHistoryScore = 0,
    fuelGradeMatch = 0,
  } = context;

  const hour = new Date(timestampMs).getHours();
  const timeSin = Math.sin(2 * Math.PI * hour / 24);
  const timeCos = Math.cos(2 * Math.PI * hour / 24);

  // Price rank: best (lowest) price gets rank 1, worst gets 0
  const prices = allStations.map(s => s.price).filter(Boolean).sort((a, b) => a - b);
  const priceIdx = prices.indexOf(station.price);
  const priceRankNorm = prices.length > 1
    ? 1 - priceIdx / (prices.length - 1)
    : 0.5;

  const distNorm = scores && scores.distanceMeters > 0
    ? Math.min(1, scores.distanceMeters / maxRadiusMeters)
    : 0.5;

  const safeScore = (value) => (Number.isFinite(value) ? value : 0);

  return [
    safeScore(scores ? scores.bearingScore : 0),
    safeScore(scores ? scores.approachScore : 0),
    safeScore(scores ? scores.speedScore : 0),
    distNorm,
    timeSin,
    timeCos,
    userHistoryScore,
    fuelGradeMatch,
    priceRankNorm,
    urgency,
    safeScore(scores ? scores.pathScore : 0),
    safeScore(scores ? scores.intentScore : 0),
  ];
}

/**
 * Generate training data from test routes by running the engine synchronously.
 * Returns Array<{ features: number[], label: number }>.
 *
 * @param {Array} routes
 * @param {Array} stations
 * @param {Function} createEngine
 * @param {Object} options
 * @param {Function} routeToSamplesFn - optional, pass in to avoid circular deps
 */
function generateTrainingData(routes, stations, createEngine, options, routeToSamplesFn) {
  if (options === undefined) options = {};
  const {
    urgency = 0,
    userHistoryScore = 0,
    positiveMinAlongTrackMeters = 1500,
    positiveMaxAlongTrackMeters = 16000,
  } = options;
  const trainingData = [];

  // Allow caller to pass routeToSamples to avoid circular dep issues
  const routeToSamples = routeToSamplesFn || require('./predictiveTestHarness.js').routeToSamples;

  for (const route of routes) {
    const triggers = [];
    const engine = createEngine({
      onTrigger: e => triggers.push(e),
      triggerThreshold: 0.01, // very low — capture all scoring data
    });
    engine.setStations(stations);

    const samples = routeToSamples(route);

    for (let i = 0; i < samples.length; i++) {
      engine.pushLocation(samples[i]);
      if (i < 3) continue; // need at least 3 samples in window

      const scores = engine.getScores();
      for (const station of stations) {
        const stationScores = scores.get(station.stationId);
        if (!stationScores) continue;

        const features = buildFeatureVector(
          stationScores,
          station,
          stations,
          {
            timestampMs: samples[i].timestamp,
            urgency,
            userHistoryScore,
            fuelGradeMatch: 0.5, // neutral
          }
        );

        // Label the EARLY predictive decision window rather than only the
        // near-station confirmation window. This teaches the model to fire
        // while the correct station is still well ahead on the route.
        const targetStationId = route.recommendationStationId || route.destinationStationId;
        const isTargetStation = route.expectsTrigger && station.stationId === targetStationId;
        const inPredictiveBand = (
          stationScores.alongTrack >= positiveMinAlongTrackMeters &&
          stationScores.alongTrack <= positiveMaxAlongTrackMeters &&
          stationScores.pathScore >= 0.25
        );
        const label = (isTargetStation && inPredictiveBand) ? 1 : 0;
        const repetitions = label === 1
          ? (stationScores.alongTrack >= 3500 ? 3 : 2)
          : 1;

        for (let repeat = 0; repeat < repetitions; repeat++) {
          trainingData.push({ features, label });
        }
      }
    }
  }

  return trainingData;
}

module.exports = { createMLPredictor, buildFeatureVector, generateTrainingData, INPUT_SIZE };
