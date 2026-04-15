const test = require('node:test');
const assert = require('node:assert/strict');

const { runMlAugmentedFlowDesigns } = require('../src/lib/mlAugmentedRecommender.js');

const experiment = runMlAugmentedFlowDesigns({
  trainSeeds: [3101, 3102, 3103, 3104, 3105],
  validationSeeds: [4101, 4102, 4103],
  testSeeds: [5101],
  routeCount: 96,
});

test('hidden-intent ML benchmark remains a diagnostic scorecard suite across designs', () => {
  const scorecardKeys = Object.keys(experiment.designs[0].test.scorecard).sort();
  for (const design of experiment.designs) {
    assert.deepEqual(
      Object.keys(design.test.scorecard).sort(),
      scorecardKeys,
      `${design.name}: expected standardized overall scorecard keys`,
    );
    for (const historyLevel of ['none', 'light', 'rich']) {
      const bucket = design.test.scorecard.historyBuckets[historyLevel];
      assert.equal(bucket == null || typeof bucket === 'object', true, `${design.name}/${historyLevel}: expected scorecard bucket object or null`);
      if (bucket) {
        assert.deepEqual(
          Object.keys(bucket).sort(),
          scorecardKeys,
          `${design.name}/${historyLevel}: expected standardized bucket keys`,
        );
      }
    }
    console.log(`[benchmark][ml-design][${design.name}]`, JSON.stringify(design.test.scorecard));
  }
});

test('hidden-intent diagnostic still shows at least one ML design improving over the best heuristic-only budgeted baseline', () => {
  const heuristicBudgetedDesigns = experiment.designs.filter(design =>
    design.family.startsWith('heuristic') &&
    design.test.scorecard.falsePositiveRate <= 5
  );
  const bestHeuristicBudgeted = heuristicBudgetedDesigns.sort((left, right) =>
    (right.test.scorecard.recall - left.test.scorecard.recall) ||
    (right.test.scorecard.precisionFirstScore - left.test.scorecard.precisionFirstScore)
  )[0];
  const eligibleMlDesigns = experiment.designs.filter(design =>
    design.name.startsWith('ml_') &&
    design.test.scorecard.falsePositiveRate <= 5
  );

  assert.ok(bestHeuristicBudgeted, 'expected at least one heuristic-only budgeted design');
  assert.ok(eligibleMlDesigns.length >= 1, 'expected at least one ML design within the false-positive budget');

  const improved = eligibleMlDesigns.some(design =>
    design.test.scorecard.recall > bestHeuristicBudgeted.test.scorecard.recall
  );
  assert.equal(
    improved,
    true,
    'expected at least one ML design to improve held-out recall over the best heuristic-only budgeted design while staying inside the same false-positive budget',
  );
});

test('hidden-intent diagnostic best ML design stays quieter than permissive proposals without becoming a wrong-station chatter path', () => {
  const permissive = experiment.designs.find(design => design.name === 'proposal_only_permissive');
  const best = experiment.bestDesign;

  assert.ok(permissive, 'expected proposal_only_permissive design');
  assert.ok(best, 'expected a best ML design');
  assert.ok(best.test.scorecard.falsePositiveRate <= 5, `expected best design FPR <= 5, got ${best.test.scorecard.falsePositiveRate}`);
  assert.ok(
    best.test.scorecard.falsePositiveRate < permissive.test.scorecard.falsePositiveRate,
    `expected best ML design to cut false positives vs permissive proposals, got best=${best.test.scorecard.falsePositiveRate} permissive=${permissive.test.scorecard.falsePositiveRate}`,
  );
  assert.ok(
    best.test.scorecard.wrongStationRate === 0,
    `expected best hidden-intent ML design wrongStationRate === 0, got ${best.test.scorecard.wrongStationRate}`,
  );
});

test('hidden-intent diagnostic best ML design stays within the false-positive budget and keeps wrong-station risk at zero', () => {
  const best = experiment.bestDesign;

  assert.ok(best, 'expected a best ML design');
  assert.ok(
    best.test.scorecard.falsePositiveRate <= 5,
    `expected best ML falsePositiveRate <= 5, got ${best.test.scorecard.falsePositiveRate}`,
  );
  assert.ok(
    best.test.scorecard.wrongStationRate === 0,
    `expected best ML wrongStationRate === 0, got ${best.test.scorecard.wrongStationRate}`,
  );
});
