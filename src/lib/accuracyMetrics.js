/**
 * Accuracy metrics: precision, recall, F1, confusion matrix, parameter tuning.
 */

const { runBatchMetrics } = require('./predictionMetrics.js');
const { createPredictiveFuelingEngine } = require('./predictiveFuelingEngine.js');

/**
 * Compute precision, recall, F1 from batch metrics output.
 * TP = routes where expectsTrigger=true AND didTrigger=true AND correct station
 * FP = routes where expectsTrigger=false AND didTrigger=true
 * FN = routes where expectsTrigger=true AND didTrigger=false
 * TN = routes where expectsTrigger=false AND didTrigger=false
 */
function computePRF1(batchMetrics) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const r of batchMetrics.routeResults) {
    if (r.expectsTrigger && r.didTrigger && r.correct) tp++;
    else if (r.expectsTrigger && r.didTrigger && !r.correct) fp++; // triggered wrong station
    else if (!r.expectsTrigger && r.didTrigger) fp++;
    else if (r.expectsTrigger && !r.didTrigger) fn++;
    else tn++;
  }
  const precision = (tp + fp) > 0 ? tp / (tp + fp) : 0;
  const recall = (tp + fn) > 0 ? tp / (tp + fn) : 0;
  const f1 = (precision + recall) > 0 ? 2 * precision * recall / (precision + recall) : 0;
  return {
    tp, fp, fn, tn,
    precision: Math.round(precision * 100) / 100,
    recall: Math.round(recall * 100) / 100,
    f1: Math.round(f1 * 100) / 100,
    accuracy: Math.round(((tp + tn) / batchMetrics.totalRoutes) * 100),
  };
}

/**
 * Grid search over engine parameters to find the best F1 score.
 */
function gridSearchParameters(routes, stations, paramGrid) {
  if (paramGrid === undefined) paramGrid = {};
  const {
    thresholds = [0.55, 0.65, 0.72, 0.80],
    windowSizes = [8, 12, 15, 20],
    bearingWeights = [0.35, 0.45, 0.55],
  } = paramGrid;

  const results = [];

  for (const threshold of thresholds) {
    for (const windowSize of windowSizes) {
      for (const bearingWeight of bearingWeights) {
        const approachWeight = (1 - bearingWeight) * 0.65;
        const speedWeight = (1 - bearingWeight) * 0.35;

        const engineFactory = function(overrides) {
          if (overrides === undefined) overrides = {};
          return createPredictiveFuelingEngine(Object.assign({
            triggerThreshold: threshold,
            windowSize,
            bearingWeight,
            approachWeight,
            speedWeight,
          }, overrides));
        };

        const batchResult = runBatchMetrics({ routes, engineFactory, stations });
        const prf1 = computePRF1(batchResult);

        results.push({
          params: { threshold, windowSize, bearingWeight: Math.round(bearingWeight * 100) / 100 },
          tp: prf1.tp,
          fp: prf1.fp,
          fn: prf1.fn,
          tn: prf1.tn,
          precision: prf1.precision,
          recall: prf1.recall,
          f1: prf1.f1,
          accuracy: prf1.accuracy,
          accuracyPercent: batchResult.accuracyPercent,
          avgTriggerDistanceMeters: batchResult.avgTriggerDistanceMeters,
        });
      }
    }
  }

  // Sort by F1 descending, then by recall
  results.sort((a, b) => b.f1 - a.f1 || b.recall - a.recall);

  return {
    best: results[0],
    top5: results.slice(0, 5),
    all: results,
  };
}

/**
 * Compare heuristic vs ML prediction with the same test data.
 */
function compareHeuristicVsML(heuristicMetrics, mlEvalResult) {
  const hPRF1 = computePRF1(heuristicMetrics);
  return {
    heuristic: hPRF1,
    ml: mlEvalResult,
    winner: mlEvalResult.f1 > hPRF1.f1 ? 'ml' : mlEvalResult.f1 < hPRF1.f1 ? 'heuristic' : 'tie',
    delta: {
      f1: Math.round((mlEvalResult.f1 - hPRF1.f1) * 100) / 100,
      precision: Math.round((mlEvalResult.precision - hPRF1.precision) * 100) / 100,
      recall: Math.round((mlEvalResult.recall - hPRF1.recall) * 100) / 100,
    },
  };
}

module.exports = { computePRF1, gridSearchParameters, compareHeuristicVsML };
