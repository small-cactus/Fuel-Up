const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PRIMARY_ML_OPTIMIZATION_BENCHMARK,
  runPrimaryMlOptimizationExperiment,
} = require('../src/lib/mlAugmentedRecommender.js');

const experiment = runPrimaryMlOptimizationExperiment({
  trainSeeds: [7101, 7102, 7103, 7104],
  validationSeeds: [7201, 7202],
  testSeeds: [7301],
  driverCount: 4,
  routesPerDriver: 18,
});

test('realistic cohort is the declared primary ML optimization benchmark', () => {
  assert.equal(
    PRIMARY_ML_OPTIMIZATION_BENCHMARK,
    'realistic_cohort',
    `expected realistic cohort to be the primary ML benchmark, got ${PRIMARY_ML_OPTIMIZATION_BENCHMARK}`,
  );
});

test('realistic cohort ML experiment reports standardized scorecards across designs', () => {
  const scorecardKeys = Object.keys(experiment.designs[0].test.scorecard).sort();
  for (const design of experiment.designs) {
    assert.deepEqual(
      Object.keys(design.test.scorecard).sort(),
      scorecardKeys,
      `${design.name}: expected standardized scorecard keys`,
    );
    console.log(`[benchmark][ml-cohort][${design.name}]`, JSON.stringify(design.test.scorecard));
  }
});

test('realistic cohort ML dataset is materially larger than a toy benchmark and spans train/validation/test splits', () => {
  assert.ok(experiment.datasets.train.replayCount >= 800, `expected large train replay count, got ${experiment.datasets.train.replayCount}`);
  assert.ok(experiment.datasets.train.exampleCount >= 150, `expected large train example count, got ${experiment.datasets.train.exampleCount}`);
  assert.ok(experiment.datasets.validation.replayCount >= 400, `expected large validation replay count, got ${experiment.datasets.validation.replayCount}`);
  assert.ok(experiment.datasets.test.replayCount >= 200, `expected large test replay count, got ${experiment.datasets.test.replayCount}`);
});

test('best realistic cohort ML design stays inside the false-positive budget with meaningful recall', () => {
  const best = experiment.bestDesign;
  assert.ok(best, 'expected a best realistic cohort design');
  assert.ok(best.test.scorecard.falsePositiveRate <= 5, `expected best cohort FPR <= 5, got ${best.test.scorecard.falsePositiveRate}`);
  assert.ok(best.test.scorecard.recall > 0, `expected non-zero grounded realistic recall, got ${best.test.scorecard.recall}`);
  assert.ok(best.test.scorecard.precision >= 10, `expected double-digit grounded realistic precision, got ${best.test.scorecard.precision}`);
  assert.ok(best.test.scorecard.silentRateWhenNoFuel >= 90, `expected strong silence on no-fuel routes, got ${best.test.scorecard.silentRateWhenNoFuel}`);
});

test('best realistic cohort ML design does not regress recall as history accumulates', () => {
  const best = experiment.bestDesign;
  assert.ok(best, 'expected a best realistic cohort design');
  const noneRecall = best.test.scorecard.historyBuckets?.none?.recall ?? 0;
  const lightRecall = best.test.scorecard.historyBuckets?.light?.recall ?? 0;
  const richRecall = best.test.scorecard.historyBuckets?.rich?.recall ?? 0;
  assert.ok(richRecall >= noneRecall, `expected rich-history recall >= none-history recall, got none=${noneRecall} rich=${richRecall}`);
  assert.ok(best.test.scorecard.wrongStationRate <= 35, `expected bounded wrong-station rate on the grounded benchmark, got ${best.test.scorecard.wrongStationRate}`);
});

test('realistic cohort best design is selected only from realistic cohort families', () => {
  const best = experiment.bestDesign;
  assert.ok(best, 'expected a best realistic cohort design');
  assert.equal(best.family, 'realistic_cohort', `expected realistic cohort family, got ${best.family}`);
});
