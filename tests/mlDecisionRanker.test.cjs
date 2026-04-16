const test = require('node:test');
const assert = require('node:assert/strict');

const {
  runPrimaryMlOptimizationExperiment,
} = require('../src/lib/mlAugmentedRecommender.js');

const experiment = runPrimaryMlOptimizationExperiment({
  trainSeeds: [7101, 7102, 7103, 7104],
  validationSeeds: [7201, 7202],
  testSeeds: [7301],
  driverCount: 4,
  routesPerDriver: 18,
});

test('realistic cohort experiment includes decision-ranker designs with explicit no-offer training data', () => {
  const decisionDesigns = experiment.designs.filter(design => design.name.includes('decision_ranker'));
  assert.ok(decisionDesigns.length >= 4, `expected multiple decision-ranker designs, got ${decisionDesigns.length}`);
  assert.ok(
    experiment.datasets.train.decisionReplayCount >= experiment.datasets.train.replayCount,
    `expected decision replay count to cover the realistic cohort routes, got ${experiment.datasets.train.decisionReplayCount}`,
  );
  assert.ok(
    experiment.datasets.train.decisionExampleCount > experiment.datasets.train.decisionReplayCount,
    `expected explicit candidate/no-offer decision examples, got ${experiment.datasets.train.decisionExampleCount}`,
  );
  assert.ok(
    experiment.datasets.train.snapshotReplayCount > 0,
    `expected native proposal snapshot replays, got ${experiment.datasets.train.snapshotReplayCount}`,
  );
  assert.ok(
    experiment.datasets.train.snapshotPairwiseExampleCount > 0,
    `expected native proposal pairwise reranker examples, got ${experiment.datasets.train.snapshotPairwiseExampleCount}`,
  );
});

test('decision-ranker designs report standardized realistic scorecards', () => {
  const decisionDesigns = experiment.designs.filter(design => design.name.includes('decision_ranker'));
  const scorecardKeys = Object.keys(decisionDesigns[0].test.scorecard).sort();
  for (const design of decisionDesigns) {
    assert.deepEqual(
      Object.keys(design.test.scorecard).sort(),
      scorecardKeys,
      `${design.name}: expected standardized decision-ranker scorecards`,
    );
  }
});

test('realistic cohort experiment includes native proposal snapshot reranker designs', () => {
  const nativeDesigns = experiment.designs.filter(design => design.name.includes('native_reranker'));
  assert.ok(nativeDesigns.length >= 2, `expected native reranker designs, got ${nativeDesigns.length}`);
  for (const design of nativeDesigns) {
    assert.equal(design.family, 'realistic_cohort');
    assert.ok(design.test?.scorecard, `${design.name}: expected test scorecard`);
  }
});
