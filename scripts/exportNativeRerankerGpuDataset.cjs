const fs = require('node:fs');
const path = require('node:path');

const {
  buildRealisticNativeRerankerGpuDataset,
} = require('../src/lib/mlAugmentedRecommender.js');

function parseJsonArg(rawValue, fallback) {
  if (!rawValue) return fallback;
  try {
    return JSON.parse(rawValue);
  } catch {
    return fallback;
  }
}

function readArg(flag, fallback = null) {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index === process.argv.length - 1) {
    return fallback;
  }
  return process.argv[index + 1];
}

const outputPath = readArg('--out', null);
const options = {
  trainSeeds: parseJsonArg(readArg('--train-seeds'), undefined),
  validationSeeds: parseJsonArg(readArg('--validation-seeds'), undefined),
  testSeeds: parseJsonArg(readArg('--test-seeds'), undefined),
  historyLevels: parseJsonArg(readArg('--history-levels'), undefined),
  driverCount: Number(readArg('--driver-count')) || undefined,
  routesPerDriver: Number(readArg('--routes-per-driver')) || undefined,
  freezeVisitHistory: readArg('--freeze-visit-history') === 'true',
  maxFalsePositiveRate: Number(readArg('--max-fpr')) || undefined,
};

const dataset = buildRealisticNativeRerankerGpuDataset(options);
const payload = JSON.stringify(dataset);

if (outputPath) {
  const resolved = path.resolve(outputPath);
  fs.writeFileSync(resolved, payload);
  console.error(`wrote ${resolved}`);
} else {
  process.stdout.write(payload);
}
