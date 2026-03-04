const test = require('node:test');
const assert = require('node:assert/strict');

const {
    runClusterProbeIntegration,
} = require('../scripts/clusterProbeIntegration.cjs');

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
    const maxIndex = sortedValues.length - 1;
    const clampedPercentile = Math.max(0, Math.min(1, percentile));
    const index = Math.min(
        maxIndex,
        Math.max(0, Math.ceil((maxIndex + 1) * clampedPercentile) - 1)
    );

    return sortedValues[index];
}

function isRenderedVisibleLayer(sample, layerKey) {
    if (!sample) {
        return false;
    }

    const visible = Boolean(sample[`${layerKey}Visible`]);
    const rawOpacity = sample[`${layerKey}Opacity`];
    const opacity = Number.isFinite(rawOpacity)
        ? rawOpacity
        : (visible ? 1 : 0);

    return visible && opacity > 0.001;
}

function summarizeSmoothness(report) {
    const LAYER_KEYS = ['breakout', 'remainder', 'carry', 'bridge'];
    const samples = Array.isArray(report?.samples) ? report.samples : [];
    const samplesAfterFirst = samples.slice(1);
    const overallDeltas = samplesAfterFirst.map(sample => sample?.maxFrameDelta || 0);
    const visibleContainerDeltas = [];
    const phaseMaxima = new Map();
    const reportedLayerMaxima = {
        breakout: 0,
        remainder: 0,
        carry: 0,
        bridge: 0,
    };
    const visibleLayerMaxima = {
        breakout: 0,
        remainder: 0,
        carry: 0,
        bridge: 0,
    };
    const topFrames = [];
    const topLayerFrames = [];

    for (let index = 1; index < samples.length; index += 1) {
        const previousSample = samples[index - 1];
        const currentSample = samples[index];
        const delta = currentSample?.maxFrameDelta || 0;
        const phase = currentSample?.runtimePhase || 'unknown';
        const phaseMax = phaseMaxima.get(phase) || 0;
        let frameVisibleContainerMaxDelta = 0;

        phaseMaxima.set(phase, Math.max(phaseMax, delta));
        reportedLayerMaxima.breakout = Math.max(reportedLayerMaxima.breakout, currentSample?.breakoutFrameDelta || 0);
        reportedLayerMaxima.remainder = Math.max(reportedLayerMaxima.remainder, currentSample?.remainderFrameDelta || 0);
        reportedLayerMaxima.carry = Math.max(reportedLayerMaxima.carry, currentSample?.carryFrameDelta || 0);
        reportedLayerMaxima.bridge = Math.max(reportedLayerMaxima.bridge, currentSample?.bridgeFrameDelta || 0);

        LAYER_KEYS.forEach(layerKey => {
            if (!isRenderedVisibleLayer(currentSample, layerKey)) {
                return;
            }

            const deltaForLayer = Math.hypot(
                (currentSample[`${layerKey}X`] || 0) - (previousSample?.[`${layerKey}X`] || 0),
                (currentSample[`${layerKey}Y`] || 0) - (previousSample?.[`${layerKey}Y`] || 0)
            );
            const layerOpacity = Number.isFinite(currentSample[`${layerKey}Opacity`])
                ? currentSample[`${layerKey}Opacity`]
                : 1;

            visibleContainerDeltas.push(deltaForLayer);
            visibleLayerMaxima[layerKey] = Math.max(visibleLayerMaxima[layerKey], deltaForLayer);
            frameVisibleContainerMaxDelta = Math.max(frameVisibleContainerMaxDelta, deltaForLayer);
            topLayerFrames.push({
                index,
                layer: layerKey,
                delta: deltaForLayer,
                phase,
                stageSignature: currentSample?.stageSignature || '',
                opacity: layerOpacity,
            });
        });

        topFrames.push({
            index,
            delta: frameVisibleContainerMaxDelta,
            phase,
            stageSignature: currentSample?.stageSignature || '',
            visibleLayers: currentSample?.visibleLayers || 'none',
        });
    }

    topFrames.sort((left, right) => right.delta - left.delta);
    topLayerFrames.sort((left, right) => right.delta - left.delta);

    return {
        sampleCount: samples.length,
        overall: {
            max: overallDeltas.length > 0 ? Math.max(...overallDeltas) : 0,
            mean: overallDeltas.length > 0
                ? overallDeltas.reduce((sum, value) => sum + value, 0) / overallDeltas.length
                : 0,
            p95: computePercentile(overallDeltas, 0.95),
        },
        visibleContainers: {
            count: visibleContainerDeltas.length,
            max: visibleContainerDeltas.length > 0 ? Math.max(...visibleContainerDeltas) : 0,
            mean: visibleContainerDeltas.length > 0
                ? visibleContainerDeltas.reduce((sum, value) => sum + value, 0) / visibleContainerDeltas.length
                : 0,
            p95: computePercentile(visibleContainerDeltas, 0.95),
        },
        reportedLayerMaxima,
        visibleLayerMaxima,
        phaseMaxima: Array.from(phaseMaxima.entries())
            .sort((left, right) => right[1] - left[1])
            .map(([phase, max]) => ({ phase, max })),
        topFrames: topFrames.slice(0, 5),
        topLayerFrames: topLayerFrames.slice(0, 8),
    };
}

test('cluster probe integration keeps max frame movement at or below 2px', {
    timeout: 130000,
}, async (t) => {
    const {
        report,
        reportFilePath,
        token,
        exceededThreshold,
        maxFrameDeltaThreshold,
    } = await runClusterProbeIntegration({
        maxFrameDeltaThreshold: 2,
        throwOnThresholdExceeded: false,
    });
    const smoothness = summarizeSmoothness(report);

    t.diagnostic(
        `probe smoothness: max=${formatMetric(smoothness.overall.max, 3)}px ` +
        `mean=${formatMetric(smoothness.overall.mean, 3)}px ` +
        `p95=${formatMetric(smoothness.overall.p95, 3)}px`
    );
    t.diagnostic(
        `visible container frame-time smoothness: count=${smoothness.visibleContainers.count} ` +
        `max=${formatMetric(smoothness.visibleContainers.max, 3)}px ` +
        `mean=${formatMetric(smoothness.visibleContainers.mean, 3)}px ` +
        `p95=${formatMetric(smoothness.visibleContainers.p95, 3)}px`
    );
    t.diagnostic(
        `reported layer maxima: breakout=${formatMetric(smoothness.reportedLayerMaxima.breakout, 3)}px ` +
        `remainder=${formatMetric(smoothness.reportedLayerMaxima.remainder, 3)}px ` +
        `carry=${formatMetric(smoothness.reportedLayerMaxima.carry, 3)}px ` +
        `bridge=${formatMetric(smoothness.reportedLayerMaxima.bridge, 3)}px`
    );
    t.diagnostic(
        `visible container layer maxima: breakout=${formatMetric(smoothness.visibleLayerMaxima.breakout, 3)}px ` +
        `remainder=${formatMetric(smoothness.visibleLayerMaxima.remainder, 3)}px ` +
        `carry=${formatMetric(smoothness.visibleLayerMaxima.carry, 3)}px ` +
        `bridge=${formatMetric(smoothness.visibleLayerMaxima.bridge, 3)}px`
    );

    smoothness.phaseMaxima.forEach(({ phase, max }) => {
        t.diagnostic(`phase max: ${phase}=${formatMetric(max, 3)}px`);
    });

    smoothness.topFrames.forEach(frame => {
        t.diagnostic(
            `top frame #${frame.index}: delta=${formatMetric(frame.delta, 3)}px ` +
            `phase=${frame.phase} stage=${frame.stageSignature || 'none'} ` +
            `layers=${frame.visibleLayers}`
        );
    });

    smoothness.topLayerFrames.forEach(frame => {
        t.diagnostic(
            `top layer frame #${frame.index}: layer=${frame.layer} delta=${formatMetric(frame.delta, 3)}px ` +
            `phase=${frame.phase} stage=${frame.stageSignature || 'none'} opacity=${formatMetric(frame.opacity, 3)}`
        );
    });

    assert.equal(report.status, 'completed');
    assert.equal(report.trigger, `automation:${token}`);
    assert.ok(
        Number.isFinite(report.sampleCount) && report.sampleCount > 0,
        `Probe reported no recorded samples (sampleCount=${report.sampleCount}). Report: ${reportFilePath}`
    );
    assert.ok(
        !exceededThreshold && report.maxFrameDelta <= maxFrameDeltaThreshold,
        `Expected maxFrameDelta <= ${maxFrameDeltaThreshold}px but received ${report.maxFrameDelta}px. ` +
        `Visible container max ${smoothness.visibleContainers.max}px. ` +
        `Report: ${reportFilePath}`
    );
});
