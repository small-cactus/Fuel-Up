const test = require('node:test');
const assert = require('node:assert/strict');
const { createMLPredictor, buildFeatureVector, generateTrainingData, INPUT_SIZE } = require('../src/lib/mlPredictor.js');
const { createPredictiveFuelingEngine } = require('../src/lib/predictiveFuelingEngine.js');
const { weekendCostcoTrip, SIM_STATIONS } = require('../src/lib/fuelerSimulation.js');
const { routeToSamples } = require('../src/lib/predictionMetrics.js');

function paddedFeatures(prefix) {
  return [...prefix, ...new Array(INPUT_SIZE - prefix.length).fill(0)];
}

test('predict returns value between 0 and 1 before training', () => {
  const predictor = createMLPredictor();
  const features = new Array(INPUT_SIZE).fill(0.5);
  const prob = predictor.predict(features);
  assert.ok(prob >= 0 && prob <= 1, `probability should be 0-1, got ${prob}`);
});

test('training improves accuracy on linearly separable data', () => {
  const predictor = createMLPredictor();
  // Simple separable data: high bearing/approach -> label 1, low -> label 0
  const trainingData = [];
  for (let i = 0; i < 60; i++) {
    trainingData.push({ features: paddedFeatures([0.9, 0.8, 0.7, 0.2, 0, 1, 0.7, 1, 0.8, 0.3, 0.9, 0.8]), label: 1 });
    trainingData.push({ features: paddedFeatures([0.1, 0.05, 0.3, 0.9, 0, 1, 0.0, 0, 0.2, 0.0, 0.1, 0.05]), label: 0 });
  }
  const result = predictor.train(trainingData, { epochs: 200, learningRate: 0.05 });
  assert.ok(result.trainingAccuracy >= 80, `training accuracy should be >= 80%, got ${result.trainingAccuracy}`);
});

test('evaluate returns precision, recall, F1', () => {
  const predictor = createMLPredictor();
  const data = [
    { features: new Array(INPUT_SIZE).fill(0.9), label: 1 },
    { features: new Array(INPUT_SIZE).fill(0.1), label: 0 },
  ];
  predictor.train(data, { epochs: 100 });
  const eval_ = predictor.evaluate(data);
  assert.ok('precision' in eval_ && 'recall' in eval_ && 'f1' in eval_);
  assert.ok(eval_.precision >= 0 && eval_.precision <= 1);
  assert.ok(eval_.recall >= 0 && eval_.recall <= 1);
  assert.ok(eval_.f1 >= 0 && eval_.f1 <= 1);
});

test('buildFeatureVector returns array of INPUT_SIZE', () => {
  const fakeScores = {
    bearingScore: 0.8,
    approachScore: 0.6,
    speedScore: 0.5,
    distanceMeters: 500,
    pathScore: 0.7,
    intentScore: 0.4,
  };
  const station = { stationId: 's1', price: 3.29 };
  const allStations = [station, { stationId: 's2', price: 3.49 }];
  const features = buildFeatureVector(fakeScores, station, allStations, {});
  assert.equal(features.length, INPUT_SIZE);
  features.forEach((f, i) => assert.ok(!isNaN(f), `feature[${i}] is NaN`));
});

test('generateTrainingData marks early recommendation windows as positives', () => {
  const route = weekendCostcoTrip();
  const data = generateTrainingData(
    [route],
    SIM_STATIONS,
    createPredictiveFuelingEngine,
    {},
    routeToSamples
  );

  const positiveCount = data.filter(entry => entry.label === 1).length;
  assert.ok(positiveCount > 0, 'expected early predictive positives in training data');
});

test('exportWeights and importWeights round-trip preserves predictions', () => {
  const p1 = createMLPredictor();
  const data = Array.from({ length: 40 }, (_, i) => ({
    features: new Array(INPUT_SIZE).fill(i % 2 === 0 ? 0.8 : 0.2),
    label: i % 2 === 0 ? 1 : 0,
  }));
  p1.train(data, { epochs: 100 });
  const weights = p1.exportWeights();

  const p2 = createMLPredictor();
  p2.importWeights(weights);
  const features = new Array(INPUT_SIZE).fill(0.8);
  const diff = Math.abs(p1.predict(features) - p2.predict(features));
  assert.ok(diff < 0.001, `predictions should match after import, diff=${diff}`);
});
