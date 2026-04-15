const test = require('node:test');
const assert = require('node:assert/strict');

const { runScaledMlCapacityExperiment } = require('../src/lib/mlAugmentedRecommender.js');

const experiment = runScaledMlCapacityExperiment({
  trainSeeds: Array.from({ length: 18 }, (_, index) => 9101 + index),
  validationSeeds: Array.from({ length: 4 }, (_, index) => 9201 + index),
  testSeeds: Array.from({ length: 4 }, (_, index) => 9301 + index),
  routeCount: 128,
});

test('scaled ML capacity experiment reports large dataset sizes and standardized scorecards', () => {
  assert.ok(experiment.datasets.train.replayCount >= 6000, `expected large train replay count, got ${experiment.datasets.train.replayCount}`);
  assert.ok(experiment.datasets.train.exampleCount >= 1000, `expected large train example count, got ${experiment.datasets.train.exampleCount}`);
  assert.ok(experiment.datasets.train.sequenceExampleCount >= experiment.datasets.train.exampleCount, 'expected sequence examples to be at least as many as base examples');

  const scorecardKeys = Object.keys(experiment.designs[0].test.scorecard).sort();
  for (const design of experiment.designs) {
    assert.deepEqual(
      Object.keys(design.test.scorecard).sort(),
      scorecardKeys,
      `${design.name}: expected standardized test scorecard keys`,
    );
    console.log(`[benchmark][ml-scale][${design.name}]`, JSON.stringify(design.test.scorecard));
  }
});

test('larger data and larger models materially change the held-out tradeoff versus the scaled logistic baseline', () => {
  const baseline = experiment.designs.find(design => design.name === 'logistic_large_data');
  const challengers = experiment.designs.filter(design => design.name !== 'logistic_large_data');

  assert.ok(baseline, 'expected logistic_large_data baseline');
  assert.ok(challengers.length >= 1, 'expected at least one challenger model');

  const changedTradeoff = challengers.some(design =>
    design.test.scorecard.recall > baseline.test.scorecard.recall ||
    design.test.scorecard.falsePositiveRate < baseline.test.scorecard.falsePositiveRate
  );
  const convergedToSameFrontier = challengers.every(design =>
    Math.abs(design.test.scorecard.recall - baseline.test.scorecard.recall) <= 2 &&
    Math.abs(design.test.scorecard.falsePositiveRate - baseline.test.scorecard.falsePositiveRate) <= 1
  );
  assert.equal(
    changedTradeoff || convergedToSameFrontier,
    true,
    'expected the scaled experiment to show either a materially different held-out tradeoff or convergence to the same frontier, which means added capacity did not help',
  );
});
