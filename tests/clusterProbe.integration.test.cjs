const test = require('node:test');
const assert = require('node:assert/strict');

const {
  runClusterProbeIntegration,
} = require('../scripts/clusterProbeIntegration.cjs');

const LAYER_KEYS = ['outside', 'accumulator', 'mergeMover', 'splitMover'];
const TRANSITION_KEYS = [
  'merge-sequence-start',
  'merge-duplicate-spawn',
  'merge-accumulator-increment',
  'merge-sequence-complete',
  'split-sequence-start',
  'split-duplicate-spawn',
  'split-duplicate-arrive',
  'split-handoff-complete',
];

const GATES = {
  maxFrameDeltaPx: 2,
  visibleP95Px: 1.25,
  visibleP99Px: 1.75,
  minSampleCount: 250,
  minTransitionEvents: 8,
  minSteppedModeSamples: 80,
  minOneShotModeSamples: 20,
  minOutsideVisibleSamples: 100,
  minAccumulatorVisibleSamples: 60,
  minMergeMoverVisibleSamples: 20,
  minSplitMoverVisibleSamples: 20,
  minMergeMoverDistancePx: 20,
  minSplitMoverDistancePx: 20,
  maxResetPairDistanceDeltaPx: 1.5,
  maxResetMeanPairDistanceDeltaPx: 0.5,
};

function formatMetric(value, digits = 2) {
  if (!Number.isFinite(value)) {
    return '--';
  }

  return value.toFixed(digits);
}

function computePercentile(values, percentile) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }

  const sortedValues = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.min(sortedValues.length - 1, Math.ceil(sortedValues.length * percentile) - 1));
  return sortedValues[index];
}

function isVisible(sample, layerKey) {
  const visible = Boolean(sample?.[`${layerKey}Visible`]);
  const opacity = Number.isFinite(sample?.[`${layerKey}Opacity`])
    ? sample[`${layerKey}Opacity`]
    : (visible ? 1 : 0);

  return visible && opacity > 0.001;
}

function getPoint(sample, layerKey) {
  return {
    x: Number.isFinite(sample?.[`${layerKey}X`]) ? sample[`${layerKey}X`] : 0,
    y: Number.isFinite(sample?.[`${layerKey}Y`]) ? sample[`${layerKey}Y`] : 0,
  };
}

function computeSmoothness(report) {
  const samples = Array.isArray(report?.samples) ? report.samples : [];
  const transitions = Array.isArray(report?.transitionEvents) ? report.transitionEvents : [];

  const visibleDeltas = [];
  const modeCounts = new Map();
  const phaseCounts = new Map();
  const transitionCounts = new Map();

  const visibleByLayer = {
    outside: 0,
    accumulator: 0,
    mergeMover: 0,
    splitMover: 0,
  };

  const travelByLayer = {
    outside: 0,
    accumulator: 0,
    mergeMover: 0,
    splitMover: 0,
  };

  transitions.forEach(event => {
    if (!event?.type) {
      return;
    }
    transitionCounts.set(event.type, (transitionCounts.get(event.type) || 0) + 1);
  });

  for (let index = 1; index < samples.length; index += 1) {
    const previousSample = samples[index - 1];
    const currentSample = samples[index];

    const mode = currentSample?.probeMode || 'unknown';
    modeCounts.set(mode, (modeCounts.get(mode) || 0) + 1);

    const phase = currentSample?.runtimePhase || 'unknown';
    phaseCounts.set(phase, (phaseCounts.get(phase) || 0) + 1);

    let frameMaxVisibleDelta = 0;

    LAYER_KEYS.forEach(layerKey => {
      if (!isVisible(currentSample, layerKey)) {
        return;
      }

      visibleByLayer[layerKey] += 1;
      const previousPoint = getPoint(previousSample, layerKey);
      const currentPoint = getPoint(currentSample, layerKey);
      const delta = Math.hypot(currentPoint.x - previousPoint.x, currentPoint.y - previousPoint.y);

      visibleDeltas.push(delta);
      travelByLayer[layerKey] += delta;
      frameMaxVisibleDelta = Math.max(frameMaxVisibleDelta, delta);
    });

    if ((currentSample?.maxFrameDelta || 0) > frameMaxVisibleDelta) {
      frameMaxVisibleDelta = currentSample.maxFrameDelta || frameMaxVisibleDelta;
    }
  }

  return {
    samples,
    transitions,
    visibleDeltas,
    visibleP95: computePercentile(visibleDeltas, 0.95),
    visibleP99: computePercentile(visibleDeltas, 0.99),
    maxVisibleDelta: visibleDeltas.length > 0 ? Math.max(...visibleDeltas) : 0,
    modeCounts: Object.fromEntries(modeCounts.entries()),
    phaseCounts: Object.fromEntries(phaseCounts.entries()),
    transitionCounts: Object.fromEntries(transitionCounts.entries()),
    visibleByLayer,
    travelByLayer,
  };
}

function collectFailures(report, smoothness) {
  const failures = [];

  if (!Number.isFinite(report.sampleCount) || report.sampleCount < GATES.minSampleCount) {
    failures.push(`sampleCount too low: expected >= ${GATES.minSampleCount}, received ${report.sampleCount}.`);
  }

  if (!Number.isFinite(report.transitionCount) || report.transitionCount < GATES.minTransitionEvents) {
    failures.push(`transitionCount too low: expected >= ${GATES.minTransitionEvents}, received ${report.transitionCount}.`);
  }

  if ((smoothness.modeCounts.stepped || 0) < GATES.minSteppedModeSamples) {
    failures.push(`stepped mode coverage too low: expected >= ${GATES.minSteppedModeSamples}, received ${smoothness.modeCounts.stepped || 0}.`);
  }

  if ((smoothness.modeCounts['one-shot'] || 0) < GATES.minOneShotModeSamples) {
    failures.push(`one-shot mode coverage too low: expected >= ${GATES.minOneShotModeSamples}, received ${smoothness.modeCounts['one-shot'] || 0}.`);
  }

  if ((smoothness.phaseCounts.live || 0) <= 0) {
    failures.push('runtime phase coverage missing: live phase not recorded.');
  }

  if ((smoothness.phaseCounts.merge_active || 0) <= 0) {
    failures.push('runtime phase coverage missing: merge_active phase not recorded.');
  }

  if ((smoothness.phaseCounts.split_active || 0) <= 0) {
    failures.push('runtime phase coverage missing: split_active phase not recorded.');
  }

  TRANSITION_KEYS.forEach(transitionType => {
    if ((smoothness.transitionCounts[transitionType] || 0) <= 0) {
      failures.push(`transition coverage missing: ${transitionType}.`);
    }
  });

  if (smoothness.visibleP95 > GATES.visibleP95Px) {
    failures.push(`visible frame delta p95 too high: expected <= ${GATES.visibleP95Px}px, received ${formatMetric(smoothness.visibleP95, 3)}px.`);
  }

  if (smoothness.visibleP99 > GATES.visibleP99Px) {
    failures.push(`visible frame delta p99 too high: expected <= ${GATES.visibleP99Px}px, received ${formatMetric(smoothness.visibleP99, 3)}px.`);
  }

  if ((report.maxFrameDelta || 0) > GATES.maxFrameDeltaPx) {
    failures.push(`maxFrameDelta too high: expected <= ${GATES.maxFrameDeltaPx}px, received ${formatMetric(report.maxFrameDelta, 3)}px.`);
  }

  if ((smoothness.visibleByLayer.outside || 0) < GATES.minOutsideVisibleSamples) {
    failures.push(`outside layer coverage too low: expected >= ${GATES.minOutsideVisibleSamples}, received ${smoothness.visibleByLayer.outside || 0}.`);
  }

  if ((smoothness.visibleByLayer.accumulator || 0) < GATES.minAccumulatorVisibleSamples) {
    failures.push(`accumulator layer coverage too low: expected >= ${GATES.minAccumulatorVisibleSamples}, received ${smoothness.visibleByLayer.accumulator || 0}.`);
  }

  if ((smoothness.visibleByLayer.mergeMover || 0) < GATES.minMergeMoverVisibleSamples) {
    failures.push(`mergeMover layer coverage too low: expected >= ${GATES.minMergeMoverVisibleSamples}, received ${smoothness.visibleByLayer.mergeMover || 0}.`);
  }

  if ((smoothness.visibleByLayer.splitMover || 0) < GATES.minSplitMoverVisibleSamples) {
    failures.push(`splitMover layer coverage too low: expected >= ${GATES.minSplitMoverVisibleSamples}, received ${smoothness.visibleByLayer.splitMover || 0}.`);
  }

  if ((smoothness.travelByLayer.mergeMover || 0) < GATES.minMergeMoverDistancePx) {
    failures.push(`mergeMover travel too low: expected >= ${GATES.minMergeMoverDistancePx}px, received ${formatMetric(smoothness.travelByLayer.mergeMover, 3)}px.`);
  }

  if ((smoothness.travelByLayer.splitMover || 0) < GATES.minSplitMoverDistancePx) {
    failures.push(`splitMover travel too low: expected >= ${GATES.minSplitMoverDistancePx}px, received ${formatMetric(smoothness.travelByLayer.splitMover, 3)}px.`);
  }

  const resetInvariant = report?.resetInvariant || {};
  if ((resetInvariant.maxPairDistanceDelta || 0) > GATES.maxResetPairDistanceDeltaPx) {
    failures.push(
      `map reset pair-distance delta too high: expected <= ${GATES.maxResetPairDistanceDeltaPx}px, ` +
      `received ${formatMetric(resetInvariant.maxPairDistanceDelta, 3)}px.`
    );
  }

  if ((resetInvariant.meanPairDistanceDelta || 0) > GATES.maxResetMeanPairDistanceDeltaPx) {
    failures.push(
      `map reset mean pair-distance delta too high: expected <= ${GATES.maxResetMeanPairDistanceDeltaPx}px, ` +
      `received ${formatMetric(resetInvariant.meanPairDistanceDelta, 3)}px.`
    );
  }

  return failures;
}

test('cluster probe integration enforces strict smoothness, continuity, and transition coverage', {
  timeout: 180000,
}, async () => {
  const {
    report,
    reportFilePath,
    token,
  } = await runClusterProbeIntegration({
    maxFrameDeltaThreshold: GATES.maxFrameDeltaPx,
    throwOnThresholdExceeded: false,
  });

  assert.equal(report.status, 'completed', `Expected completed probe report. token=${token} file=${reportFilePath}`);
  assert.ok(Array.isArray(report.samples), `Expected samples array in probe report. token=${token} file=${reportFilePath}`);
  assert.ok(Array.isArray(report.transitionEvents), `Expected transitionEvents array in probe report. token=${token} file=${reportFilePath}`);

  const smoothness = computeSmoothness(report);
  const failures = collectFailures(report, smoothness);

  test.diagnostic(`probe token=${token}`);
  test.diagnostic(`probe report file=${reportFilePath}`);
  test.diagnostic(`samples=${report.sampleCount} transitions=${report.transitionCount} maxFrameDelta=${formatMetric(report.maxFrameDelta, 3)}px`);
  test.diagnostic(`visible p95=${formatMetric(smoothness.visibleP95, 3)}px p99=${formatMetric(smoothness.visibleP99, 3)}px max=${formatMetric(smoothness.maxVisibleDelta, 3)}px`);
  test.diagnostic(`mode coverage: ${JSON.stringify(smoothness.modeCounts)}`);
  test.diagnostic(`phase coverage: ${JSON.stringify(smoothness.phaseCounts)}`);
  test.diagnostic(`transition coverage: ${JSON.stringify(smoothness.transitionCounts)}`);
  test.diagnostic(`layer coverage: ${JSON.stringify(smoothness.visibleByLayer)}`);
  test.diagnostic(`layer travel: ${JSON.stringify(smoothness.travelByLayer)}`);

  if (failures.length > 0) {
    assert.fail(`Cluster probe quality gates failed:\n${failures.map((failure, index) => `${index + 1}. ${failure}`).join('\n')}`);
  }
});
