const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_PRODUCTION_THRESHOLDS,
  runPredictiveRobustnessReport,
} = require('../src/lib/predictiveRobustnessHarness.js');

const BASELINE_SEEDS = [4242, 5252];
const ADVERSARIAL_SEEDS = [4242];

let cachedRobustnessReport = null;

function getRobustnessReport() {
  if (!cachedRobustnessReport) {
    cachedRobustnessReport = runPredictiveRobustnessReport({
      baselineSeeds: BASELINE_SEEDS,
      adversarialSeeds: ADVERSARIAL_SEEDS,
      driverCount: 6,
      routesPerDriver: 24,
      baselineHistoryLevels: ['none', 'light', 'rich'],
      adversarialHistoryLevels: ['none', 'rich'],
      thresholds: DEFAULT_PRODUCTION_THRESHOLDS,
    });
  }
  return cachedRobustnessReport;
}

function formatFailedChecks(failedChecks) {
  return failedChecks
    .map(check => `${check.id} [${check.scope}] actual=${JSON.stringify(check.actual)} threshold=${JSON.stringify(check.threshold)}`)
    .join('\n');
}

function compactAggregate(aggregate) {
  return {
    runCount: aggregate?.runCount,
    scorecards: {
      precision: aggregate?.scorecards?.precision,
      recall: aggregate?.scorecards?.recall,
      falsePositiveRate: aggregate?.scorecards?.falsePositiveRate,
      wrongStationRate: aggregate?.scorecards?.wrongStationRate,
    },
    promptMetrics: {
      promptsPer100TripsOverall: aggregate?.promptMetrics?.promptsPer100TripsOverall,
      promptsPerUserWeekDistribution: aggregate?.promptMetrics?.promptsPerUserWeekDistribution,
      backToBackPromptRateOverall: aggregate?.promptMetrics?.backToBackPromptRateOverall,
      repeatPromptAfterIgnoreShortHorizonRateOverall: aggregate?.promptMetrics?.repeatPromptAfterIgnoreShortHorizonRateOverall,
    },
    calibration: {
      expectedCalibrationError: aggregate?.calibration?.expectedCalibrationError,
      expectedCalibrationErrorOverall: aggregate?.calibration?.expectedCalibrationErrorOverall,
      topConfidenceBinActualCorrectnessOverall: aggregate?.calibration?.topConfidenceBinActualCorrectnessOverall,
    },
    oraclePriceMetrics: {
      visibleOracleRegretOverallMean: aggregate?.oraclePriceMetrics?.visibleOracleRegretOverallMean,
      visibleOracleRegretOverallP90: aggregate?.oraclePriceMetrics?.visibleOracleRegretOverallP90,
      meaningfulSavingsPromptShareOverall: aggregate?.oraclePriceMetrics?.meaningfulSavingsPromptShareOverall,
      missedHighValueOpportunityRateOverall: aggregate?.oraclePriceMetrics?.missedHighValueOpportunityRateOverall,
    },
  };
}

test('predictive robustness report exposes every requested production-readiness gate', () => {
  const report = getRobustnessReport();

  console.log('[robustness][baseline][overall]', JSON.stringify(compactAggregate(report.baseline.overall)));
  console.log('[robustness][baseline][none]', JSON.stringify(compactAggregate(report.baseline.histories.none)));
  console.log('[robustness][baseline][light]', JSON.stringify(compactAggregate(report.baseline.histories.light)));
  console.log('[robustness][baseline][rich]', JSON.stringify(compactAggregate(report.baseline.histories.rich)));
  console.log('[robustness][adversarial]', JSON.stringify(report.adversarial));
  console.log('[robustness][persistence]', JSON.stringify(report.persistence));
  console.log('[robustness][verdict]', JSON.stringify(report.verdict.overall));

  const expectedCheckIds = [
    'wrong_station_rate_p90',
    'wrong_station_rate_mean',
    'false_positive_rate_p90',
    'false_positive_rate_mean',
    'recall_p10_none',
    'recall_p10_light',
    'recall_p10_rich',
    'recall_median_none',
    'recall_median_light',
    'recall_median_rich',
    'precision_mean_none',
    'precision_mean_light',
    'precision_mean_rich',
    'precision_p10_none',
    'precision_p10_light',
    'precision_p10_rich',
    'expected_calibration_error_mean',
    'expected_calibration_error_p90',
    'top_confidence_bin_actual_correctness',
    'prompts_per_100_trips_none',
    'prompts_per_100_trips_light',
    'prompts_per_100_trips_rich',
    'prompts_per_user_week_median',
    'prompts_per_user_week_p90',
    'back_to_back_prompt_rate',
    'repeat_prompt_after_ignore_short_horizon_rate',
    'visible_oracle_regret_mean',
    'visible_oracle_regret_p90',
    'meaningful_savings_prompt_share',
    'missed_high_value_opportunity_rate_light',
    'missed_high_value_opportunity_rate_rich',
    'stale_prices_wrong_station_rate_p90',
    'stale_prices_false_positive_rate_p90',
    'stale_prices_recall_p10',
    'missing_cheapest_station_wrong_station_rate_p90',
    'missing_cheapest_station_false_positive_rate_p90',
    'missing_cheapest_station_recall_p10',
    'route_snap_noise_wrong_station_rate_p90',
    'route_snap_noise_false_positive_rate_p90',
    'route_snap_noise_recall_p10',
    'market_churn_wrong_station_rate_p90',
    'market_churn_false_positive_rate_p90',
    'market_churn_recall_p10',
    'corrupt_profile_normalization_crash_rate',
    'post_normalization_out_of_bounds_field_rate',
    'post_normalization_wrong_station_rate_increase',
    'state_reset_relearn_recall_recovery_light',
    'state_reset_relearn_recall_recovery_rich',
    'no_clean_realistic_sweep_unit_wrong_station_rate_gt_3',
    'no_clean_realistic_sweep_unit_false_positive_rate_gt_8',
    'recall_p10_vs_median_ratio_none',
    'recall_p10_vs_median_ratio_light',
    'recall_p10_vs_median_ratio_rich',
  ];

  const actualCheckIds = new Set(report.verdict.allChecks.map(check => check.id));
  for (const checkId of expectedCheckIds) {
    assert.ok(actualCheckIds.has(checkId), `missing production gate ${checkId}`);
  }
});

test('predictive system only passes robustness tests when every production threshold is met', () => {
  const report = getRobustnessReport();
  const failedChecks = report.verdict.allChecks.filter(check => !check.pass);

  assert.equal(
    report.verdict.overall.ready,
    true,
    `Production readiness thresholds failed:\n${formatFailedChecks(failedChecks)}`
  );
  assert.equal(
    report.verdict.overall.failedGateCount,
    0,
    `Expected zero failed production gates, found ${report.verdict.overall.failedGateCount}:\n${formatFailedChecks(failedChecks)}`
  );
  assert.equal(
    failedChecks.length,
    0,
    `Expected every requested threshold to pass, but these failed:\n${formatFailedChecks(failedChecks)}`
  );
});
