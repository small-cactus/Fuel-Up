const test = require('node:test');
const assert = require('node:assert/strict');

const {
    runClusterProbeIntegration,
} = require('../scripts/clusterProbeIntegration.cjs');

const LAYER_KEYS = ['breakout', 'remainder', 'carry', 'bridge'];
const MOTION_EPSILON_PX = 0.05;

// Thresholds are intentionally strict so visual regressions cannot hide behind one passing metric.
// For frame pacing we gate on animated-step timing and very long frame gaps.
const GATES = {
    maxFrameDeltaPx: 2,
    visibleP95Px: 1.25,
    visibleP99Px: 1.75,
    animatedStepP95Ms: 34,
    animatedStepMaxMs: 67,
    veryLongAnimatedStepCount: 0,
    activationJumpPx: 2,
    stageSwitchJumpPx: 2,
    minSampleCount: 250,
    minVisibleDeltaSamples: 250,
    minTransitionEvents: 12,
    minBreakoutVisibleSamples: 100,
    minRemainderVisibleSamples: 60,
    minBridgeVisibleSamples: 30,
    minBreakoutDistancePx: 25,
    minRemainderDistancePx: 15,
    minBridgeDistancePx: 20,
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

function getLayerPosition(sample, layerKey) {
    return {
        x: sample?.[`${layerKey}X`] || 0,
        y: sample?.[`${layerKey}Y`] || 0,
    };
}

function computeLayerDelta(previousSample, currentSample, layerKey) {
    const previousPosition = getLayerPosition(previousSample, layerKey);
    const currentPosition = getLayerPosition(currentSample, layerKey);

    return Math.hypot(
        currentPosition.x - previousPosition.x,
        currentPosition.y - previousPosition.y
    );
}

function computeStageSwitchJump(previousSample, currentSample) {
    const previousVisibleLayers = LAYER_KEYS.filter(layerKey => isRenderedVisibleLayer(previousSample, layerKey));
    const currentVisibleLayers = LAYER_KEYS.filter(layerKey => isRenderedVisibleLayer(currentSample, layerKey));

    if (previousVisibleLayers.length === 0 || currentVisibleLayers.length === 0) {
        return 0;
    }

    let minimumDistance = Number.POSITIVE_INFINITY;

    previousVisibleLayers.forEach(previousLayer => {
        currentVisibleLayers.forEach(currentLayer => {
            const previousPosition = getLayerPosition(previousSample, previousLayer);
            const currentPosition = getLayerPosition(currentSample, currentLayer);
            const distance = Math.hypot(
                currentPosition.x - previousPosition.x,
                currentPosition.y - previousPosition.y
            );

            if (distance < minimumDistance) {
                minimumDistance = distance;
            }
        });
    });

    return Number.isFinite(minimumDistance) ? minimumDistance : 0;
}

function summarizeSmoothness(report) {
    const samples = Array.isArray(report?.samples) ? report.samples : [];
    const transitions = Array.isArray(report?.transitionEvents) ? report.transitionEvents : [];
    const samplesAfterFirst = samples.slice(1);
    const overallDeltas = samplesAfterFirst.map(sample => sample?.maxFrameDelta || 0);
    const visibleContainerDeltas = [];
    const phaseMaxima = new Map();
    const phaseCounts = new Map();
    const transitionTypeCounts = new Map();
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
    const visibleSampleCountsByLayer = {
        breakout: 0,
        remainder: 0,
        carry: 0,
        bridge: 0,
    };
    const movingSampleCountsByLayer = {
        breakout: 0,
        remainder: 0,
        carry: 0,
        bridge: 0,
    };
    const totalDistanceByLayer = {
        breakout: 0,
        remainder: 0,
        carry: 0,
        bridge: 0,
    };
    const topFrames = [];
    const topLayerFrames = [];
    const activationJumps = [];
    const stageSwitchJumps = [];
    const animatedStepDurationsMs = [];

    let veryLongAnimatedStepCount = 0;
    let nonSmoothFrameCount = 0;

    transitions.forEach(event => {
        if (!event?.type) {
            return;
        }

        transitionTypeCounts.set(event.type, (transitionTypeCounts.get(event.type) || 0) + 1);
    });

    for (let index = 1; index < samples.length; index += 1) {
        const previousSample = samples[index - 1];
        const currentSample = samples[index];
        const delta = currentSample?.maxFrameDelta || 0;
        const phase = currentSample?.runtimePhase || 'unknown';
        const phaseMax = phaseMaxima.get(phase) || 0;
        let frameVisibleContainerMaxDelta = 0;
        const timestampDeltaMs = Math.max(
            0,
            (currentSample?.timestamp || 0) - (previousSample?.timestamp || 0)
        );

        phaseMaxima.set(phase, Math.max(phaseMax, delta));
        phaseCounts.set(phase, (phaseCounts.get(phase) || 0) + 1);
        reportedLayerMaxima.breakout = Math.max(reportedLayerMaxima.breakout, currentSample?.breakoutFrameDelta || 0);
        reportedLayerMaxima.remainder = Math.max(reportedLayerMaxima.remainder, currentSample?.remainderFrameDelta || 0);
        reportedLayerMaxima.carry = Math.max(reportedLayerMaxima.carry, currentSample?.carryFrameDelta || 0);
        reportedLayerMaxima.bridge = Math.max(reportedLayerMaxima.bridge, currentSample?.bridgeFrameDelta || 0);

        LAYER_KEYS.forEach(layerKey => {
            const wasVisible = isRenderedVisibleLayer(previousSample, layerKey);
            const isVisible = isRenderedVisibleLayer(currentSample, layerKey);
            const deltaForLayer = computeLayerDelta(previousSample, currentSample, layerKey);

            if (isVisible) {
                visibleSampleCountsByLayer[layerKey] += 1;
                visibleContainerDeltas.push(deltaForLayer);
                visibleLayerMaxima[layerKey] = Math.max(visibleLayerMaxima[layerKey], deltaForLayer);
                frameVisibleContainerMaxDelta = Math.max(frameVisibleContainerMaxDelta, deltaForLayer);
                totalDistanceByLayer[layerKey] += deltaForLayer;

                if (deltaForLayer > MOTION_EPSILON_PX) {
                    movingSampleCountsByLayer[layerKey] += 1;
                }

                if (!wasVisible) {
                    activationJumps.push({
                        index,
                        layer: layerKey,
                        jump: deltaForLayer,
                        phase,
                        stageSignature: currentSample?.stageSignature || '',
                    });
                }

                const layerOpacity = Number.isFinite(currentSample?.[`${layerKey}Opacity`])
                    ? currentSample[`${layerKey}Opacity`]
                    : 1;

                topLayerFrames.push({
                    index,
                    layer: layerKey,
                    delta: deltaForLayer,
                    phase,
                    stageSignature: currentSample?.stageSignature || '',
                    opacity: layerOpacity,
                });
            }
        });

        if (frameVisibleContainerMaxDelta > GATES.maxFrameDeltaPx) {
            nonSmoothFrameCount += 1;
        }

        if (frameVisibleContainerMaxDelta > MOTION_EPSILON_PX && timestampDeltaMs > 0) {
            animatedStepDurationsMs.push(timestampDeltaMs);
            if (timestampDeltaMs > GATES.animatedStepMaxMs) {
                veryLongAnimatedStepCount += 1;
            }
        }

        if (
            currentSample?.stageSignature !== previousSample?.stageSignature ||
            currentSample?.runtimePhase !== previousSample?.runtimePhase
        ) {
            stageSwitchJumps.push({
                index,
                jump: computeStageSwitchJump(previousSample, currentSample),
                phase: `${previousSample?.runtimePhase || 'unknown'}->${currentSample?.runtimePhase || 'unknown'}`,
                stageSignature: `${previousSample?.stageSignature || ''}->${currentSample?.stageSignature || ''}`,
            });
        }

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
    activationJumps.sort((left, right) => right.jump - left.jump);
    stageSwitchJumps.sort((left, right) => right.jump - left.jump);

    return {
        sampleCount: samples.length,
        transitionCount: transitions.length,
        transitionTypeCounts: Object.fromEntries(transitionTypeCounts.entries()),
        overall: {
            max: overallDeltas.length > 0 ? Math.max(...overallDeltas) : 0,
            mean: overallDeltas.length > 0
                ? overallDeltas.reduce((sum, value) => sum + value, 0) / overallDeltas.length
                : 0,
            p95: computePercentile(overallDeltas, 0.95),
            p99: computePercentile(overallDeltas, 0.99),
        },
        visibleContainers: {
            count: visibleContainerDeltas.length,
            max: visibleContainerDeltas.length > 0 ? Math.max(...visibleContainerDeltas) : 0,
            mean: visibleContainerDeltas.length > 0
                ? visibleContainerDeltas.reduce((sum, value) => sum + value, 0) / visibleContainerDeltas.length
                : 0,
            p95: computePercentile(visibleContainerDeltas, 0.95),
            p99: computePercentile(visibleContainerDeltas, 0.99),
        },
        pacing: {
            animatedStepCount: animatedStepDurationsMs.length,
            maxStepMs: animatedStepDurationsMs.length > 0 ? Math.max(...animatedStepDurationsMs) : 0,
            p95StepMs: computePercentile(animatedStepDurationsMs, 0.95),
            p99StepMs: computePercentile(animatedStepDurationsMs, 0.99),
            veryLongAnimatedStepCount,
        },
        continuity: {
            maxActivationJumpPx: activationJumps.length > 0 ? activationJumps[0].jump : 0,
            maxStageSwitchJumpPx: stageSwitchJumps.length > 0 ? stageSwitchJumps[0].jump : 0,
            topActivationJumps: activationJumps.slice(0, 6),
            topStageSwitchJumps: stageSwitchJumps.slice(0, 6),
        },
        motionCoverage: {
            nonSmoothFrameCount,
            visibleSampleCountsByLayer,
            movingSampleCountsByLayer,
            totalDistanceByLayer,
            phaseCounts: Object.fromEntries(phaseCounts.entries()),
        },
        reportedLayerMaxima,
        visibleLayerMaxima,
        phaseMaxima: Array.from(phaseMaxima.entries())
            .sort((left, right) => right[1] - left[1])
            .map(([phase, max]) => ({ phase, max })),
        topFrames: topFrames.slice(0, 8),
        topLayerFrames: topLayerFrames.slice(0, 12),
    };
}

function validateProbeStrictness({
    report,
    reportFilePath,
    token,
    smoothness,
    exceededThreshold,
    maxFrameDeltaThreshold,
}) {
    const failures = [];
    const transitionTypeCounts = smoothness.transitionTypeCounts || {};
    const phaseCounts = smoothness.motionCoverage.phaseCounts || {};
    const layerVisibility = smoothness.motionCoverage.visibleSampleCountsByLayer;
    const layerDistance = smoothness.motionCoverage.totalDistanceByLayer;

    if (report.status !== 'completed') {
        failures.push(`status must be completed, received "${report.status}".`);
    }

    if (report.trigger !== `automation:${token}`) {
        failures.push(`trigger mismatch: expected automation:${token}, received ${report.trigger}.`);
    }

    if (!Number.isFinite(report.sampleCount) || report.sampleCount < GATES.minSampleCount) {
        failures.push(`sampleCount too low: expected >= ${GATES.minSampleCount}, received ${report.sampleCount}.`);
    }

    if (smoothness.visibleContainers.count < GATES.minVisibleDeltaSamples) {
        failures.push(
            `visible delta sample count too low: expected >= ${GATES.minVisibleDeltaSamples}, ` +
            `received ${smoothness.visibleContainers.count}.`
        );
    }

    if (!Number.isFinite(report.transitionCount) || report.transitionCount < GATES.minTransitionEvents) {
        failures.push(`transitionCount too low: expected >= ${GATES.minTransitionEvents}, received ${report.transitionCount}.`);
    }

    if ((report.timedOutStages || []).length > 0) {
        failures.push(`probe timed out in stages: ${(report.timedOutStages || []).join(', ')}.`);
    }

    if ((phaseCounts.live || 0) <= 0) {
        failures.push('runtime phase coverage missing: live phase never recorded.');
    }

    if ((phaseCounts.split_bridge_active || 0) <= 0) {
        failures.push('runtime phase coverage missing: split_bridge_active phase never recorded.');
    }

    if ((transitionTypeCounts['split-held-created'] || 0) <= 0) {
        failures.push('transition coverage missing: no split-held-created events recorded.');
    }

    if ((transitionTypeCounts['split-bridge-start'] || 0) <= 0) {
        failures.push('transition coverage missing: no split-bridge-start events recorded.');
    }

    if ((layerVisibility.breakout || 0) < GATES.minBreakoutVisibleSamples) {
        failures.push(
            `breakout layer coverage too low: expected >= ${GATES.minBreakoutVisibleSamples}, ` +
            `received ${layerVisibility.breakout || 0}.`
        );
    }

    if ((layerVisibility.remainder || 0) < GATES.minRemainderVisibleSamples) {
        failures.push(
            `remainder layer coverage too low: expected >= ${GATES.minRemainderVisibleSamples}, ` +
            `received ${layerVisibility.remainder || 0}.`
        );
    }

    if ((layerVisibility.bridge || 0) < GATES.minBridgeVisibleSamples) {
        failures.push(
            `bridge layer coverage too low: expected >= ${GATES.minBridgeVisibleSamples}, ` +
            `received ${layerVisibility.bridge || 0}.`
        );
    }

    if ((layerDistance.breakout || 0) < GATES.minBreakoutDistancePx) {
        failures.push(
            `breakout travel distance too low: expected >= ${GATES.minBreakoutDistancePx}px, ` +
            `received ${formatMetric(layerDistance.breakout, 3)}px.`
        );
    }

    if ((layerDistance.remainder || 0) < GATES.minRemainderDistancePx) {
        failures.push(
            `remainder travel distance too low: expected >= ${GATES.minRemainderDistancePx}px, ` +
            `received ${formatMetric(layerDistance.remainder, 3)}px.`
        );
    }

    if ((layerDistance.bridge || 0) < GATES.minBridgeDistancePx) {
        failures.push(
            `bridge travel distance too low: expected >= ${GATES.minBridgeDistancePx}px, ` +
            `received ${formatMetric(layerDistance.bridge, 3)}px.`
        );
    }

    if (exceededThreshold || report.maxFrameDelta > maxFrameDeltaThreshold) {
        failures.push(
            `maxFrameDelta gate failed: expected <= ${maxFrameDeltaThreshold}px, ` +
            `received ${formatMetric(report.maxFrameDelta, 3)}px.`
        );
    }

    if (smoothness.visibleContainers.p95 > GATES.visibleP95Px) {
        failures.push(
            `visible frame delta p95 too high: expected <= ${GATES.visibleP95Px}px, ` +
            `received ${formatMetric(smoothness.visibleContainers.p95, 3)}px.`
        );
    }

    if (smoothness.visibleContainers.p99 > GATES.visibleP99Px) {
        failures.push(
            `visible frame delta p99 too high: expected <= ${GATES.visibleP99Px}px, ` +
            `received ${formatMetric(smoothness.visibleContainers.p99, 3)}px.`
        );
    }

    if (smoothness.pacing.p95StepMs > GATES.animatedStepP95Ms) {
        failures.push(
            `animated-step p95 duration too high: expected <= ${GATES.animatedStepP95Ms}ms, ` +
            `received ${formatMetric(smoothness.pacing.p95StepMs, 3)}ms.`
        );
    }

    if (smoothness.pacing.maxStepMs > GATES.animatedStepMaxMs) {
        failures.push(
            `animated-step max duration too high: expected <= ${GATES.animatedStepMaxMs}ms, ` +
            `received ${formatMetric(smoothness.pacing.maxStepMs, 3)}ms.`
        );
    }

    if (smoothness.pacing.veryLongAnimatedStepCount > GATES.veryLongAnimatedStepCount) {
        failures.push(
            `very long animated-step count too high: expected <= ${GATES.veryLongAnimatedStepCount}, ` +
            `received ${smoothness.pacing.veryLongAnimatedStepCount}.`
        );
    }

    if (smoothness.continuity.maxActivationJumpPx > GATES.activationJumpPx) {
        failures.push(
            `layer activation jump too high: expected <= ${GATES.activationJumpPx}px, ` +
            `received ${formatMetric(smoothness.continuity.maxActivationJumpPx, 3)}px.`
        );
    }

    if (smoothness.continuity.maxStageSwitchJumpPx > GATES.stageSwitchJumpPx) {
        failures.push(
            `stage switch continuity jump too high: expected <= ${GATES.stageSwitchJumpPx}px, ` +
            `received ${formatMetric(smoothness.continuity.maxStageSwitchJumpPx, 3)}px.`
        );
    }

    if (smoothness.motionCoverage.nonSmoothFrameCount > 0) {
        failures.push(
            `non-smooth frames detected: ${smoothness.motionCoverage.nonSmoothFrameCount} ` +
            `frames exceeded ${GATES.maxFrameDeltaPx}px.`
        );
    }

    return failures.map(message => `${message} Report: ${reportFilePath}`);
}

test('cluster probe integration enforces strict smoothness, continuity, and transition coverage', {
    timeout: 130000,
}, async (t) => {
    const {
        report,
        reportFilePath,
        token,
        exceededThreshold,
        maxFrameDeltaThreshold,
    } = await runClusterProbeIntegration({
        maxFrameDeltaThreshold: GATES.maxFrameDeltaPx,
        throwOnThresholdExceeded: false,
    });
    const smoothness = summarizeSmoothness(report);

    t.diagnostic(
        `probe smoothness: max=${formatMetric(smoothness.overall.max, 3)}px ` +
        `mean=${formatMetric(smoothness.overall.mean, 3)}px ` +
        `p95=${formatMetric(smoothness.overall.p95, 3)}px ` +
        `p99=${formatMetric(smoothness.overall.p99, 3)}px`
    );
    t.diagnostic(
        `visible frame-time smoothness: count=${smoothness.visibleContainers.count} ` +
        `max=${formatMetric(smoothness.visibleContainers.max, 3)}px ` +
        `mean=${formatMetric(smoothness.visibleContainers.mean, 3)}px ` +
        `p95=${formatMetric(smoothness.visibleContainers.p95, 3)}px ` +
        `p99=${formatMetric(smoothness.visibleContainers.p99, 3)}px`
    );
    t.diagnostic(
        `pacing: animatedSteps=${smoothness.pacing.animatedStepCount} ` +
        `p95=${formatMetric(smoothness.pacing.p95StepMs, 3)}ms ` +
        `p99=${formatMetric(smoothness.pacing.p99StepMs, 3)}ms ` +
        `max=${formatMetric(smoothness.pacing.maxStepMs, 3)}ms ` +
        `veryLong(>${GATES.animatedStepMaxMs}ms)=${smoothness.pacing.veryLongAnimatedStepCount}`
    );
    t.diagnostic(
        `continuity: activationMax=${formatMetric(smoothness.continuity.maxActivationJumpPx, 3)}px ` +
        `stageSwitchMax=${formatMetric(smoothness.continuity.maxStageSwitchJumpPx, 3)}px`
    );
    t.diagnostic(
        `layer coverage: breakout=${smoothness.motionCoverage.visibleSampleCountsByLayer.breakout} ` +
        `remainder=${smoothness.motionCoverage.visibleSampleCountsByLayer.remainder} ` +
        `carry=${smoothness.motionCoverage.visibleSampleCountsByLayer.carry} ` +
        `bridge=${smoothness.motionCoverage.visibleSampleCountsByLayer.bridge}`
    );
    t.diagnostic(
        `layer travel: breakout=${formatMetric(smoothness.motionCoverage.totalDistanceByLayer.breakout, 2)}px ` +
        `remainder=${formatMetric(smoothness.motionCoverage.totalDistanceByLayer.remainder, 2)}px ` +
        `carry=${formatMetric(smoothness.motionCoverage.totalDistanceByLayer.carry, 2)}px ` +
        `bridge=${formatMetric(smoothness.motionCoverage.totalDistanceByLayer.bridge, 2)}px`
    );
    t.diagnostic(
        `transition coverage: total=${smoothness.transitionCount} ` +
        `split-held-created=${smoothness.transitionTypeCounts['split-held-created'] || 0} ` +
        `split-bridge-start=${smoothness.transitionTypeCounts['split-bridge-start'] || 0} ` +
        `split-stage-ready=${smoothness.transitionTypeCounts['split-stage-ready'] || 0}`
    );
    t.diagnostic(
        `phase coverage: ${Object.entries(smoothness.motionCoverage.phaseCounts)
            .map(([phase, count]) => `${phase}:${count}`)
            .join(', ') || 'none'}`
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

    smoothness.continuity.topActivationJumps.forEach(event => {
        t.diagnostic(
            `activation jump #${event.index}: layer=${event.layer} jump=${formatMetric(event.jump, 3)}px ` +
            `phase=${event.phase} stage=${event.stageSignature || 'none'}`
        );
    });

    smoothness.continuity.topStageSwitchJumps.forEach(event => {
        t.diagnostic(
            `stage switch jump #${event.index}: jump=${formatMetric(event.jump, 3)}px ` +
            `phase=${event.phase} stage=${event.stageSignature}`
        );
    });

    const failures = validateProbeStrictness({
        report,
        reportFilePath,
        token,
        smoothness,
        exceededThreshold,
        maxFrameDeltaThreshold,
    });

    if (failures.length > 0) {
        assert.fail(
            `Strict cluster probe smoothness gates failed (${failures.length}):\n` +
            failures.map((failure, index) => `${index + 1}. ${failure}`).join('\n')
        );
    }
});
