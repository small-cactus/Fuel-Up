#!/usr/bin/env node

const {
  DEFAULT_PRODUCTION_THRESHOLDS,
  runPredictiveRobustnessReport,
} = require('../src/lib/predictiveRobustnessHarness.js');

function parseArgs(argv) {
  const options = {
    baselineSeeds: [4242, 5252, 6262, 7272, 8282, 9292, 10303, 11313, 12323, 13333, 14343, 15353],
    adversarialSeeds: [4242, 5252, 6262, 7272, 8282, 9292],
    driverCount: 8,
    routesPerDriver: 24,
    json: false,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      options.json = true;
    } else if (arg.startsWith('--driver-count=')) {
      options.driverCount = Number(arg.split('=')[1]) || options.driverCount;
    } else if (arg.startsWith('--routes-per-driver=')) {
      options.routesPerDriver = Number(arg.split('=')[1]) || options.routesPerDriver;
    } else if (arg.startsWith('--baseline-seeds=')) {
      options.baselineSeeds = arg.split('=')[1].split(',').map(value => Number(value)).filter(Number.isFinite);
    } else if (arg.startsWith('--adversarial-seeds=')) {
      options.adversarialSeeds = arg.split('=')[1].split(',').map(value => Number(value)).filter(Number.isFinite);
    }
  }

  return options;
}

function printHistory(historyLevel, aggregate) {
  console.log(`[robustness][${historyLevel}] recall`, JSON.stringify(aggregate.scorecards.recall));
  console.log(`[robustness][${historyLevel}] falsePositiveRate`, JSON.stringify(aggregate.scorecards.falsePositiveRate));
  console.log(`[robustness][${historyLevel}] wrongStationRate`, JSON.stringify(aggregate.scorecards.wrongStationRate));
  console.log(`[robustness][${historyLevel}] promptsPer100Trips`, JSON.stringify(aggregate.promptMetrics.promptsPer100Trips));
  console.log(`[robustness][${historyLevel}] calibration`, JSON.stringify(aggregate.calibration.expectedCalibrationError));
}

const options = parseArgs(process.argv);
const report = runPredictiveRobustnessReport({
  baselineSeeds: options.baselineSeeds,
  adversarialSeeds: options.adversarialSeeds,
  driverCount: options.driverCount,
  routesPerDriver: options.routesPerDriver,
  thresholds: DEFAULT_PRODUCTION_THRESHOLDS,
});

if (options.json) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

for (const historyLevel of ['none', 'light', 'rich']) {
  printHistory(historyLevel, report.baseline.histories[historyLevel]);
}
console.log('[robustness][overall]', JSON.stringify(report.baseline.overall));
console.log('[robustness][adversarial]', JSON.stringify(report.adversarial));
console.log('[robustness][verdict]', JSON.stringify(report.verdict));
