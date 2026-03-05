const test = require('node:test');
const assert = require('node:assert/strict');

const {
    runClusterProbeIntegration,
} = require('../scripts/clusterProbeIntegration.cjs');

const LAYER_KEYS = ['breakout', 'remainder', 'carry', 'bridge'];
const LAYER_PAIR_KEYS = [
    ['breakout', 'remainder'],
    ['breakout', 'carry'],
    ['breakout', 'bridge'],
    ['remainder', 'carry'],
    ['remainder', 'bridge'],
    ['carry', 'bridge'],
];
const NUMERIC_SAMPLE_FIELDS = [
    'maxFrameDelta',
    'spreadProgress',
    'morphProgress',
    'bridgeProgress',
    'visibleLayerCount',
    'clusterSize',
    'maxSecondaryRadius',
    'secondaryShellWidth',
    'breakoutOpacity',
    'breakoutX',
    'breakoutY',
    'breakoutShellWidth',
    'breakoutPlusOpacity',
    'breakoutPriceOpacity',
    'remainderOpacity',
    'remainderX',
    'remainderY',
    'remainderShellWidth',
    'remainderPlusOpacity',
    'remainderPriceOpacity',
    'carryOpacity',
    'carryX',
    'carryY',
    'carryShellWidth',
    'carryPlusOpacity',
    'carryPriceOpacity',
    'bridgeOpacity',
    'bridgeX',
    'bridgeY',
    'bridgeShellWidth',
    'bridgePlusOpacity',
    'bridgePriceOpacity',
    'containerLogicalX',
    'containerLogicalY',
    'containerVisualX',
    'containerVisualY',
];
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
    maxContainerVisualTrackDeltaPx: 2,
    maxContainerLogicalVisualOffsetDeltaPx: 2,
    minIdleContinuousMovementTotalMs: 200,
    maxIdleContinuousMovementTotalMs: 700,
    maxDisconnectHandoffPositionDeltaPx: 2,
    maxDisconnectHandoffSizeDeltaPx: 2,
    maxDisconnectHandoffContentDelta: 0.05,
    minSteppedModeSamples: 80,
    minOneShotModeSamples: 20,
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
    const maxIndex = sortedValues.length - 1;
    const clampedPercentile = Math.max(0, Math.min(1, percentile));
    const index = Math.min(
        maxIndex,
        Math.max(0, Math.ceil((maxIndex + 1) * clampedPercentile) - 1)
    );

    return sortedValues[index];
}

function computeMean(values) {
    if (!Array.isArray(values) || values.length === 0) {
        return 0;
    }

    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function summarizeSeries(values) {
    if (!Array.isArray(values) || values.length === 0) {
        return {
            count: 0,
            min: 0,
            max: 0,
            mean: 0,
            stdDev: 0,
            p01: 0,
            p05: 0,
            p50: 0,
            p95: 0,
            p99: 0,
            first: 0,
            last: 0,
            range: 0,
            drift: 0,
        };
    }

    const mean = computeMean(values);
    const variance = values.reduce((sum, value) => (
        sum + Math.pow(value - mean, 2)
    ), 0) / values.length;

    return {
        count: values.length,
        min: Math.min(...values),
        max: Math.max(...values),
        mean,
        stdDev: Math.sqrt(variance),
        p01: computePercentile(values, 0.01),
        p05: computePercentile(values, 0.05),
        p50: computePercentile(values, 0.50),
        p95: computePercentile(values, 0.95),
        p99: computePercentile(values, 0.99),
        first: values[0],
        last: values[values.length - 1],
        range: Math.max(...values) - Math.min(...values),
        drift: values[values.length - 1] - values[0],
    };
}

function sortCountsDescending(countMap) {
    return Array.from(countMap.entries())
        .sort((left, right) => right[1] - left[1]);
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

function getContainerTrackPosition(sample, prefix) {
    const x = sample?.[`${prefix}X`];
    const y = sample?.[`${prefix}Y`];

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return null;
    }

    return { x, y };
}

function computePointDelta(previousPoint, currentPoint) {
    if (!previousPoint || !currentPoint) {
        return null;
    }

    return Math.hypot(
        currentPoint.x - previousPoint.x,
        currentPoint.y - previousPoint.y
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
    const modeCounts = new Map();
    const stageSignatureCounts = new Map();
    const clusterKeyCounts = new Map();
    const visibleLayerPatternCounts = new Map();
    const clusterSizeCounts = new Map();
    const mapMotionCounts = new Map();
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
    const containerLogicalTrackDeltas = [];
    const containerVisualTrackDeltas = [];
    const containerLogicalVisualOffsetMagnitudes = [];
    const containerLogicalVisualOffsetDeltas = [];
    const topContainerOffsetFrames = [];
    const topContainerOffsetDeltaFrames = [];
    const idleMovementRuns = [];
    const disconnectHandoffEvents = [];
    const layerKinematicsByKey = Object.fromEntries(
        LAYER_KEYS.map(layerKey => [layerKey, {
            speed: [],
            acceleration: [],
            jerk: [],
            pathDistance: 0,
            movingFrames: 0,
            stationaryFrames: 0,
            directionFlipCount: 0,
            topDirectionFlips: [],
            previousSpeed: null,
            previousAcceleration: null,
            previousVector: null,
        }])
    );
    const pairDistanceSeriesByKey = Object.fromEntries(
        LAYER_PAIR_KEYS.map(([firstLayer, secondLayer]) => [`${firstLayer}-${secondLayer}`, {
            values: [],
            deltas: [],
            topDeltas: [],
            previousDistance: null,
        }])
    );
    const numericFieldTelemetry = Object.fromEntries(
        NUMERIC_SAMPLE_FIELDS.map(fieldName => [fieldName, {
            values: [],
            steps: [],
            topSteps: [],
            nonFiniteCount: 0,
        }])
    );
    const timestampDeltasMs = [];

    let veryLongAnimatedStepCount = 0;
    let nonSmoothFrameCount = 0;
    let activeIdleMovementRun = null;

    transitions.forEach(event => {
        if (!event?.type) {
            return;
        }

        transitionTypeCounts.set(event.type, (transitionTypeCounts.get(event.type) || 0) + 1);
    });

    samples.forEach(sample => {
        const mode = sample?.probeMode || 'unknown';
        const stageSignature = sample?.stageSignature || 'none';
        const clusterKey = sample?.clusterKey || 'none';
        const visibleLayers = sample?.visibleLayers || 'none';
        const clusterSize = Number.isFinite(sample?.clusterSize) ? sample.clusterSize : null;
        const mapMotionState = sample?.mapMoving === true
            ? 'moving'
            : (sample?.mapMoving === false ? 'idle' : 'unknown');

        modeCounts.set(mode, (modeCounts.get(mode) || 0) + 1);
        stageSignatureCounts.set(stageSignature, (stageSignatureCounts.get(stageSignature) || 0) + 1);
        clusterKeyCounts.set(clusterKey, (clusterKeyCounts.get(clusterKey) || 0) + 1);
        visibleLayerPatternCounts.set(visibleLayers, (visibleLayerPatternCounts.get(visibleLayers) || 0) + 1);
        mapMotionCounts.set(mapMotionState, (mapMotionCounts.get(mapMotionState) || 0) + 1);

        if (clusterSize !== null) {
            clusterSizeCounts.set(clusterSize, (clusterSizeCounts.get(clusterSize) || 0) + 1);
        }
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
        timestampDeltasMs.push(timestampDeltaMs);
        const previousContainerLogicalPosition = getContainerTrackPosition(previousSample, 'containerLogical');
        const currentContainerLogicalPosition = getContainerTrackPosition(currentSample, 'containerLogical');
        const previousContainerVisualPosition = getContainerTrackPosition(previousSample, 'containerVisual');
        const currentContainerVisualPosition = getContainerTrackPosition(currentSample, 'containerVisual');
        const containerLogicalDelta = computePointDelta(
            previousContainerLogicalPosition,
            currentContainerLogicalPosition
        );
        const containerVisualDelta = computePointDelta(
            previousContainerVisualPosition,
            currentContainerVisualPosition
        );
        const previousOffsetPosition = (
            previousContainerLogicalPosition &&
            previousContainerVisualPosition
        )
            ? {
                x: previousContainerVisualPosition.x - previousContainerLogicalPosition.x,
                y: previousContainerVisualPosition.y - previousContainerLogicalPosition.y,
            }
            : null;
        const currentOffsetPosition = (
            currentContainerLogicalPosition &&
            currentContainerVisualPosition
        )
            ? {
                x: currentContainerVisualPosition.x - currentContainerLogicalPosition.x,
                y: currentContainerVisualPosition.y - currentContainerLogicalPosition.y,
            }
            : null;
        const currentOffsetMagnitude = currentOffsetPosition
            ? Math.hypot(currentOffsetPosition.x, currentOffsetPosition.y)
            : null;
        const currentOffsetDelta = computePointDelta(previousOffsetPosition, currentOffsetPosition);

        phaseMaxima.set(phase, Math.max(phaseMax, delta));
        phaseCounts.set(phase, (phaseCounts.get(phase) || 0) + 1);
        reportedLayerMaxima.breakout = Math.max(reportedLayerMaxima.breakout, currentSample?.breakoutFrameDelta || 0);
        reportedLayerMaxima.remainder = Math.max(reportedLayerMaxima.remainder, currentSample?.remainderFrameDelta || 0);
        reportedLayerMaxima.carry = Math.max(reportedLayerMaxima.carry, currentSample?.carryFrameDelta || 0);
        reportedLayerMaxima.bridge = Math.max(reportedLayerMaxima.bridge, currentSample?.bridgeFrameDelta || 0);

        if (Number.isFinite(containerLogicalDelta)) {
            containerLogicalTrackDeltas.push(containerLogicalDelta);
        }

        if (Number.isFinite(containerVisualDelta)) {
            containerVisualTrackDeltas.push(containerVisualDelta);
        }

        if (Number.isFinite(currentOffsetMagnitude)) {
            containerLogicalVisualOffsetMagnitudes.push(currentOffsetMagnitude);
            topContainerOffsetFrames.push({
                index,
                offset: currentOffsetMagnitude,
                phase,
                stageSignature: currentSample?.stageSignature || '',
                logicalLayer: currentSample?.containerLogicalLayer || '',
                visualLayer: currentSample?.containerVisualLayer || '',
            });
        }

        if (Number.isFinite(currentOffsetDelta)) {
            containerLogicalVisualOffsetDeltas.push(currentOffsetDelta);
            topContainerOffsetDeltaFrames.push({
                index,
                delta: currentOffsetDelta,
                phase,
                stageSignature: currentSample?.stageSignature || '',
                logicalLayer: currentSample?.containerLogicalLayer || '',
                visualLayer: currentSample?.containerVisualLayer || '',
            });
        }

        NUMERIC_SAMPLE_FIELDS.forEach(fieldName => {
            const currentValue = currentSample?.[fieldName];
            const previousValue = previousSample?.[fieldName];
            const telemetry = numericFieldTelemetry[fieldName];

            if (!Number.isFinite(currentValue)) {
                telemetry.nonFiniteCount += 1;
                return;
            }

            telemetry.values.push(currentValue);
            if (Number.isFinite(previousValue)) {
                const stepDelta = Math.abs(currentValue - previousValue);
                telemetry.steps.push(stepDelta);
                telemetry.topSteps.push({
                    index,
                    fieldName,
                    delta: stepDelta,
                    from: previousValue,
                    to: currentValue,
                    phase,
                    stageSignature: currentSample?.stageSignature || '',
                    mode: currentSample?.probeMode || 'unknown',
                });
            }
        });

        const bridgeActivated = (
            !isRenderedVisibleLayer(previousSample, 'bridge') &&
            isRenderedVisibleLayer(currentSample, 'bridge')
        );

        if (bridgeActivated) {
            const breakoutWasVisible = isRenderedVisibleLayer(previousSample, 'breakout');
            const sourcePosition = breakoutWasVisible
                ? getLayerPosition(previousSample, 'breakout')
                : null;
            const targetPosition = getLayerPosition(currentSample, 'bridge');
            const positionDelta = sourcePosition
                ? Math.hypot(
                    targetPosition.x - sourcePosition.x,
                    targetPosition.y - sourcePosition.y
                )
                : Number.POSITIVE_INFINITY;
            const sourceWidth = Number.isFinite(previousSample?.breakoutShellWidth)
                ? previousSample.breakoutShellWidth
                : null;
            const targetWidth = Number.isFinite(currentSample?.bridgeShellWidth)
                ? currentSample.bridgeShellWidth
                : null;
            const sizeDelta = (
                Number.isFinite(sourceWidth) &&
                Number.isFinite(targetWidth)
            )
                ? Math.abs(targetWidth - sourceWidth)
                : Number.POSITIVE_INFINITY;
            const sourcePlusOpacity = Number.isFinite(previousSample?.breakoutPlusOpacity)
                ? previousSample.breakoutPlusOpacity
                : null;
            const sourcePriceOpacity = Number.isFinite(previousSample?.breakoutPriceOpacity)
                ? previousSample.breakoutPriceOpacity
                : null;
            const targetPlusOpacity = Number.isFinite(currentSample?.bridgePlusOpacity)
                ? currentSample.bridgePlusOpacity
                : null;
            const targetPriceOpacity = Number.isFinite(currentSample?.bridgePriceOpacity)
                ? currentSample.bridgePriceOpacity
                : null;
            const contentDelta = (
                Number.isFinite(sourcePlusOpacity) &&
                Number.isFinite(sourcePriceOpacity) &&
                Number.isFinite(targetPlusOpacity) &&
                Number.isFinite(targetPriceOpacity)
            )
                ? Math.max(
                    Math.abs(targetPlusOpacity - sourcePlusOpacity),
                    Math.abs(targetPriceOpacity - sourcePriceOpacity)
                )
                : Number.POSITIVE_INFINITY;

            disconnectHandoffEvents.push({
                index,
                phase,
                stageSignature: currentSample?.stageSignature || '',
                sourceVisible: breakoutWasVisible,
                positionDelta,
                sizeDelta,
                contentDelta,
                sourcePlusOpacity,
                sourcePriceOpacity,
                targetPlusOpacity,
                targetPriceOpacity,
            });
        }

        LAYER_KEYS.forEach(layerKey => {
            const wasVisible = isRenderedVisibleLayer(previousSample, layerKey);
            const isVisible = isRenderedVisibleLayer(currentSample, layerKey);
            const deltaForLayer = computeLayerDelta(previousSample, currentSample, layerKey);
            const layerKinematics = layerKinematicsByKey[layerKey];

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

            if (wasVisible && isVisible && timestampDeltaMs > 0) {
                const previousPosition = getLayerPosition(previousSample, layerKey);
                const currentPosition = getLayerPosition(currentSample, layerKey);
                const vectorX = currentPosition.x - previousPosition.x;
                const vectorY = currentPosition.y - previousPosition.y;
                const vectorMagnitude = Math.hypot(vectorX, vectorY);
                const velocity = vectorMagnitude / (timestampDeltaMs / 1000);

                layerKinematics.speed.push(velocity);
                layerKinematics.pathDistance += vectorMagnitude;

                if (vectorMagnitude > MOTION_EPSILON_PX) {
                    layerKinematics.movingFrames += 1;
                } else {
                    layerKinematics.stationaryFrames += 1;
                }

                if (Number.isFinite(layerKinematics.previousSpeed)) {
                    const acceleration = (velocity - layerKinematics.previousSpeed) / (timestampDeltaMs / 1000);
                    layerKinematics.acceleration.push(acceleration);

                    if (Number.isFinite(layerKinematics.previousAcceleration)) {
                        const jerk = (acceleration - layerKinematics.previousAcceleration) / (timestampDeltaMs / 1000);
                        layerKinematics.jerk.push(jerk);
                    }

                    layerKinematics.previousAcceleration = acceleration;
                }

                if (
                    layerKinematics.previousVector &&
                    layerKinematics.previousVector.magnitude > MOTION_EPSILON_PX &&
                    vectorMagnitude > MOTION_EPSILON_PX
                ) {
                    const dotProduct = (
                        layerKinematics.previousVector.x * vectorX +
                        layerKinematics.previousVector.y * vectorY
                    );
                    if (dotProduct < 0) {
                        layerKinematics.directionFlipCount += 1;
                        layerKinematics.topDirectionFlips.push({
                            index,
                            layer: layerKey,
                            previousMagnitude: layerKinematics.previousVector.magnitude,
                            currentMagnitude: vectorMagnitude,
                            phase,
                            stageSignature: currentSample?.stageSignature || '',
                            mode: currentSample?.probeMode || 'unknown',
                        });
                    }
                }

                layerKinematics.previousVector = {
                    x: vectorX,
                    y: vectorY,
                    magnitude: vectorMagnitude,
                };
                layerKinematics.previousSpeed = velocity;
            } else {
                layerKinematics.previousVector = null;
                layerKinematics.previousSpeed = null;
                layerKinematics.previousAcceleration = null;
            }
        });

        LAYER_PAIR_KEYS.forEach(([firstLayer, secondLayer]) => {
            const firstVisible = isRenderedVisibleLayer(currentSample, firstLayer);
            const secondVisible = isRenderedVisibleLayer(currentSample, secondLayer);
            const pairKey = `${firstLayer}-${secondLayer}`;
            const pairSeries = pairDistanceSeriesByKey[pairKey];

            if (!firstVisible || !secondVisible) {
                pairSeries.previousDistance = null;
                return;
            }

            const firstPosition = getLayerPosition(currentSample, firstLayer);
            const secondPosition = getLayerPosition(currentSample, secondLayer);
            const pairDistance = Math.hypot(
                secondPosition.x - firstPosition.x,
                secondPosition.y - firstPosition.y
            );

            pairSeries.values.push(pairDistance);
            if (Number.isFinite(pairSeries.previousDistance)) {
                const pairDelta = Math.abs(pairDistance - pairSeries.previousDistance);
                pairSeries.deltas.push(pairDelta);
                pairSeries.topDeltas.push({
                    index,
                    pairKey,
                    delta: pairDelta,
                    previousDistance: pairSeries.previousDistance,
                    currentDistance: pairDistance,
                    phase,
                    stageSignature: currentSample?.stageSignature || '',
                    mode: currentSample?.probeMode || 'unknown',
                });
            }
            pairSeries.previousDistance = pairDistance;
        });

        const isIdleMap = currentSample?.mapMoving === false;
        const trackedContainerDelta = Number.isFinite(containerVisualDelta)
            ? containerVisualDelta
            : frameVisibleContainerMaxDelta;
        const isContainerMovingOnIdleMap = isIdleMap && trackedContainerDelta > MOTION_EPSILON_PX;

        if (isContainerMovingOnIdleMap) {
            if (!activeIdleMovementRun) {
                activeIdleMovementRun = {
                    startIndex: index,
                    endIndex: index,
                    startTimestamp: previousSample?.timestamp || currentSample?.timestamp || 0,
                    endTimestamp: currentSample?.timestamp || previousSample?.timestamp || 0,
                    maxDelta: trackedContainerDelta,
                    maxDeltaIndex: index,
                    phase: currentSample?.runtimePhase || 'unknown',
                    stageSignature: currentSample?.stageSignature || '',
                };
            } else {
                activeIdleMovementRun.endIndex = index;
                activeIdleMovementRun.endTimestamp = currentSample?.timestamp || activeIdleMovementRun.endTimestamp;
                if (trackedContainerDelta > activeIdleMovementRun.maxDelta) {
                    activeIdleMovementRun.maxDelta = trackedContainerDelta;
                    activeIdleMovementRun.maxDeltaIndex = index;
                }
            }
        } else if (activeIdleMovementRun) {
            idleMovementRuns.push({
                ...activeIdleMovementRun,
                durationMs: Math.max(
                    0,
                    (activeIdleMovementRun.endTimestamp || 0) - (activeIdleMovementRun.startTimestamp || 0)
                ),
            });
            activeIdleMovementRun = null;
        }

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

    if (activeIdleMovementRun) {
        idleMovementRuns.push({
            ...activeIdleMovementRun,
            durationMs: Math.max(
                0,
                (activeIdleMovementRun.endTimestamp || 0) - (activeIdleMovementRun.startTimestamp || 0)
            ),
        });
        activeIdleMovementRun = null;
    }

    topFrames.sort((left, right) => right.delta - left.delta);
    topLayerFrames.sort((left, right) => right.delta - left.delta);
    activationJumps.sort((left, right) => right.jump - left.jump);
    stageSwitchJumps.sort((left, right) => right.jump - left.jump);
    topContainerOffsetFrames.sort((left, right) => right.offset - left.offset);
    topContainerOffsetDeltaFrames.sort((left, right) => right.delta - left.delta);
    idleMovementRuns.sort((left, right) => right.durationMs - left.durationMs);
    disconnectHandoffEvents.sort((left, right) => {
        const leftWorst = Math.max(left.positionDelta || 0, left.sizeDelta || 0, left.contentDelta || 0);
        const rightWorst = Math.max(right.positionDelta || 0, right.sizeDelta || 0, right.contentDelta || 0);
        return rightWorst - leftWorst;
    });
    const numericFieldSummary = Object.fromEntries(
        Object.entries(numericFieldTelemetry).map(([fieldName, telemetry]) => {
            telemetry.topSteps.sort((left, right) => right.delta - left.delta);
            return [fieldName, {
                series: summarizeSeries(telemetry.values),
                stepSeries: summarizeSeries(telemetry.steps),
                nonFiniteCount: telemetry.nonFiniteCount,
                topSteps: telemetry.topSteps.slice(0, 6),
            }];
        })
    );
    const layerKinematics = Object.fromEntries(
        Object.entries(layerKinematicsByKey).map(([layerKey, telemetry]) => {
            telemetry.topDirectionFlips.sort((left, right) => (
                (right.previousMagnitude + right.currentMagnitude) -
                (left.previousMagnitude + left.currentMagnitude)
            ));
            return [layerKey, {
                speed: summarizeSeries(telemetry.speed),
                acceleration: summarizeSeries(telemetry.acceleration),
                jerk: summarizeSeries(telemetry.jerk),
                pathDistance: telemetry.pathDistance,
                movingFrames: telemetry.movingFrames,
                stationaryFrames: telemetry.stationaryFrames,
                directionFlipCount: telemetry.directionFlipCount,
                topDirectionFlips: telemetry.topDirectionFlips.slice(0, 6),
            }];
        })
    );
    const pairDistanceTelemetry = Object.fromEntries(
        Object.entries(pairDistanceSeriesByKey).map(([pairKey, telemetry]) => {
            telemetry.topDeltas.sort((left, right) => right.delta - left.delta);
            return [pairKey, {
                distanceSeries: summarizeSeries(telemetry.values),
                deltaSeries: summarizeSeries(telemetry.deltas),
                topDeltas: telemetry.topDeltas.slice(0, 6),
            }];
        })
    );

    const totalIdleMovementDurationMs = idleMovementRuns.reduce((sum, run) => (
        sum + (run.durationMs || 0)
    ), 0);

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
        containerTracks: {
            logical: {
                count: containerLogicalTrackDeltas.length,
                max: containerLogicalTrackDeltas.length > 0 ? Math.max(...containerLogicalTrackDeltas) : 0,
                mean: containerLogicalTrackDeltas.length > 0
                    ? containerLogicalTrackDeltas.reduce((sum, value) => sum + value, 0) / containerLogicalTrackDeltas.length
                    : 0,
                p95: computePercentile(containerLogicalTrackDeltas, 0.95),
                p99: computePercentile(containerLogicalTrackDeltas, 0.99),
            },
            visual: {
                count: containerVisualTrackDeltas.length,
                max: containerVisualTrackDeltas.length > 0 ? Math.max(...containerVisualTrackDeltas) : 0,
                mean: containerVisualTrackDeltas.length > 0
                    ? containerVisualTrackDeltas.reduce((sum, value) => sum + value, 0) / containerVisualTrackDeltas.length
                    : 0,
                p95: computePercentile(containerVisualTrackDeltas, 0.95),
                p99: computePercentile(containerVisualTrackDeltas, 0.99),
            },
            logicalVsVisualOffset: {
                count: containerLogicalVisualOffsetMagnitudes.length,
                max: containerLogicalVisualOffsetMagnitudes.length > 0 ? Math.max(...containerLogicalVisualOffsetMagnitudes) : 0,
                mean: containerLogicalVisualOffsetMagnitudes.length > 0
                    ? containerLogicalVisualOffsetMagnitudes.reduce((sum, value) => sum + value, 0) / containerLogicalVisualOffsetMagnitudes.length
                    : 0,
                p95: computePercentile(containerLogicalVisualOffsetMagnitudes, 0.95),
                p99: computePercentile(containerLogicalVisualOffsetMagnitudes, 0.99),
            },
            logicalVsVisualOffsetDelta: {
                count: containerLogicalVisualOffsetDeltas.length,
                max: containerLogicalVisualOffsetDeltas.length > 0 ? Math.max(...containerLogicalVisualOffsetDeltas) : 0,
                mean: containerLogicalVisualOffsetDeltas.length > 0
                    ? containerLogicalVisualOffsetDeltas.reduce((sum, value) => sum + value, 0) / containerLogicalVisualOffsetDeltas.length
                    : 0,
                p95: computePercentile(containerLogicalVisualOffsetDeltas, 0.95),
                p99: computePercentile(containerLogicalVisualOffsetDeltas, 0.99),
            },
            topOffsetFrames: topContainerOffsetFrames.slice(0, 8),
            topOffsetDeltaFrames: topContainerOffsetDeltaFrames.slice(0, 8),
        },
        pacing: {
            animatedStepCount: animatedStepDurationsMs.length,
            maxStepMs: animatedStepDurationsMs.length > 0 ? Math.max(...animatedStepDurationsMs) : 0,
            p95StepMs: computePercentile(animatedStepDurationsMs, 0.95),
            p99StepMs: computePercentile(animatedStepDurationsMs, 0.99),
            veryLongAnimatedStepCount,
        },
        idleMovement: {
            runCount: idleMovementRuns.length,
            totalDurationMs: totalIdleMovementDurationMs,
            longestRunMs: idleMovementRuns.length > 0 ? idleMovementRuns[0].durationMs : 0,
            topRuns: idleMovementRuns.slice(0, 6),
        },
        disconnectHandoff: {
            eventCount: disconnectHandoffEvents.length,
            maxPositionDelta: disconnectHandoffEvents.length > 0
                ? Math.max(...disconnectHandoffEvents.map(event => event.positionDelta || 0))
                : 0,
            maxSizeDelta: disconnectHandoffEvents.length > 0
                ? Math.max(...disconnectHandoffEvents.map(event => event.sizeDelta || 0))
                : 0,
            maxContentDelta: disconnectHandoffEvents.length > 0
                ? Math.max(...disconnectHandoffEvents.map(event => event.contentDelta || 0))
                : 0,
            topEvents: disconnectHandoffEvents.slice(0, 8),
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
        stateCoverage: {
            modeCounts: Object.fromEntries(modeCounts.entries()),
            stageSignatureCounts: Object.fromEntries(stageSignatureCounts.entries()),
            clusterKeyCounts: Object.fromEntries(clusterKeyCounts.entries()),
            visibleLayerPatternCounts: Object.fromEntries(visibleLayerPatternCounts.entries()),
            clusterSizeCounts: Object.fromEntries(clusterSizeCounts.entries()),
            mapMotionCounts: Object.fromEntries(mapMotionCounts.entries()),
        },
        telemetry: {
            timestampDeltasMs: summarizeSeries(timestampDeltasMs),
            numericFields: numericFieldSummary,
            layerKinematics,
            layerPairDistances: pairDistanceTelemetry,
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

    const modeCounts = smoothness.stateCoverage?.modeCounts || {};
    if ((modeCounts.stepped || 0) < GATES.minSteppedModeSamples) {
        failures.push(
            `probe mode coverage too low for stepped: expected >= ${GATES.minSteppedModeSamples}, ` +
            `received ${modeCounts.stepped || 0}.`
        );
    }

    if ((modeCounts['one-shot'] || 0) < GATES.minOneShotModeSamples) {
        failures.push(
            `probe mode coverage too low for one-shot: expected >= ${GATES.minOneShotModeSamples}, ` +
            `received ${modeCounts['one-shot'] || 0}.`
        );
    }

    const resetInvariant = report?.resetInvariant || {};
    if (resetInvariant.signaturesMatch === false) {
        failures.push(
            `map reset cluster signature mismatch: start=${resetInvariant.startClusterSignature || 'none'} ` +
            `end=${resetInvariant.endClusterSignature || 'none'}.`
        );
    }

    if ((resetInvariant.stationCountDelta || 0) !== 0) {
        failures.push(
            `map reset station count mismatch: expected 0 delta, ` +
            `received ${resetInvariant.stationCountDelta}.`
        );
    }

    if ((resetInvariant.pairCountDelta || 0) !== 0) {
        failures.push(
            `map reset pair-count mismatch: expected 0 delta, ` +
            `received ${resetInvariant.pairCountDelta}.`
        );
    }

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

    if (smoothness.containerTracks.visual.max > GATES.maxContainerVisualTrackDeltaPx) {
        failures.push(
            `visible container track delta too high: expected <= ${GATES.maxContainerVisualTrackDeltaPx}px, ` +
            `received ${formatMetric(smoothness.containerTracks.visual.max, 3)}px.`
        );
    }

    if (smoothness.containerTracks.logicalVsVisualOffsetDelta.max > GATES.maxContainerLogicalVisualOffsetDeltaPx) {
        failures.push(
            `logical vs visible offset delta track too high: expected <= ${GATES.maxContainerLogicalVisualOffsetDeltaPx}px, ` +
            `received ${formatMetric(smoothness.containerTracks.logicalVsVisualOffsetDelta.max, 3)}px.`
        );
    }

    if (smoothness.idleMovement.totalDurationMs < GATES.minIdleContinuousMovementTotalMs) {
        failures.push(
            `idle-map total moving duration too low: expected >= ${GATES.minIdleContinuousMovementTotalMs}ms, ` +
            `received ${formatMetric(smoothness.idleMovement.totalDurationMs, 0)}ms.`
        );
    }

    if (smoothness.idleMovement.totalDurationMs > GATES.maxIdleContinuousMovementTotalMs) {
        failures.push(
            `idle-map total moving duration too high: expected <= ${GATES.maxIdleContinuousMovementTotalMs}ms, ` +
            `received ${formatMetric(smoothness.idleMovement.totalDurationMs, 0)}ms.`
        );
    }

    if (smoothness.disconnectHandoff.eventCount <= 0) {
        failures.push('disconnect handoff coverage missing: no +N -> price handoff events captured.');
    }

    if (smoothness.disconnectHandoff.maxPositionDelta > GATES.maxDisconnectHandoffPositionDeltaPx) {
        failures.push(
            `disconnect handoff position delta too high: expected <= ${GATES.maxDisconnectHandoffPositionDeltaPx}px, ` +
            `received ${formatMetric(smoothness.disconnectHandoff.maxPositionDelta, 3)}px.`
        );
    }

    if (smoothness.disconnectHandoff.maxSizeDelta > GATES.maxDisconnectHandoffSizeDeltaPx) {
        failures.push(
            `disconnect handoff size delta too high: expected <= ${GATES.maxDisconnectHandoffSizeDeltaPx}px, ` +
            `received ${formatMetric(smoothness.disconnectHandoff.maxSizeDelta, 3)}px.`
        );
    }

    if (smoothness.disconnectHandoff.maxContentDelta > GATES.maxDisconnectHandoffContentDelta) {
        failures.push(
            `disconnect handoff content delta too high: expected <= ${GATES.maxDisconnectHandoffContentDelta}, ` +
            `received ${formatMetric(smoothness.disconnectHandoff.maxContentDelta, 3)}.`
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
        reloadAppBeforeProbe: true,
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
        `container track(logical): count=${smoothness.containerTracks.logical.count} ` +
        `max=${formatMetric(smoothness.containerTracks.logical.max, 3)}px ` +
        `mean=${formatMetric(smoothness.containerTracks.logical.mean, 3)}px ` +
        `p95=${formatMetric(smoothness.containerTracks.logical.p95, 3)}px ` +
        `p99=${formatMetric(smoothness.containerTracks.logical.p99, 3)}px`
    );
    t.diagnostic(
        `container track(visible): count=${smoothness.containerTracks.visual.count} ` +
        `max=${formatMetric(smoothness.containerTracks.visual.max, 3)}px ` +
        `mean=${formatMetric(smoothness.containerTracks.visual.mean, 3)}px ` +
        `p95=${formatMetric(smoothness.containerTracks.visual.p95, 3)}px ` +
        `p99=${formatMetric(smoothness.containerTracks.visual.p99, 3)}px`
    );
    t.diagnostic(
        `container logical->visible offset: count=${smoothness.containerTracks.logicalVsVisualOffset.count} ` +
        `max=${formatMetric(smoothness.containerTracks.logicalVsVisualOffset.max, 3)}px ` +
        `mean=${formatMetric(smoothness.containerTracks.logicalVsVisualOffset.mean, 3)}px ` +
        `p95=${formatMetric(smoothness.containerTracks.logicalVsVisualOffset.p95, 3)}px ` +
        `p99=${formatMetric(smoothness.containerTracks.logicalVsVisualOffset.p99, 3)}px`
    );
    t.diagnostic(
        `container logical->visible offset delta track: count=${smoothness.containerTracks.logicalVsVisualOffsetDelta.count} ` +
        `max=${formatMetric(smoothness.containerTracks.logicalVsVisualOffsetDelta.max, 3)}px ` +
        `mean=${formatMetric(smoothness.containerTracks.logicalVsVisualOffsetDelta.mean, 3)}px ` +
        `p95=${formatMetric(smoothness.containerTracks.logicalVsVisualOffsetDelta.p95, 3)}px ` +
        `p99=${formatMetric(smoothness.containerTracks.logicalVsVisualOffsetDelta.p99, 3)}px`
    );
    t.diagnostic(
        `pacing: animatedSteps=${smoothness.pacing.animatedStepCount} ` +
        `p95=${formatMetric(smoothness.pacing.p95StepMs, 3)}ms ` +
        `p99=${formatMetric(smoothness.pacing.p99StepMs, 3)}ms ` +
        `max=${formatMetric(smoothness.pacing.maxStepMs, 3)}ms ` +
        `veryLong(>${GATES.animatedStepMaxMs}ms)=${smoothness.pacing.veryLongAnimatedStepCount}`
    );
    t.diagnostic(
        `idle-map continuous movement: runs=${smoothness.idleMovement.runCount} ` +
        `total=${formatMetric(smoothness.idleMovement.totalDurationMs, 0)}ms ` +
        `longest=${formatMetric(smoothness.idleMovement.longestRunMs, 0)}ms ` +
        `target=[${GATES.minIdleContinuousMovementTotalMs},${GATES.maxIdleContinuousMovementTotalMs}]ms`
    );
    t.diagnostic(
        `disconnect handoff(+N->price): events=${smoothness.disconnectHandoff.eventCount} ` +
        `maxPosition=${formatMetric(smoothness.disconnectHandoff.maxPositionDelta, 3)}px ` +
        `maxSize=${formatMetric(smoothness.disconnectHandoff.maxSizeDelta, 3)}px ` +
        `maxContent=${formatMetric(smoothness.disconnectHandoff.maxContentDelta, 3)}`
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
    t.diagnostic(
        `probe mode coverage: ${Object.entries(smoothness.stateCoverage.modeCounts)
            .map(([mode, count]) => `${mode}:${count}`)
            .join(', ') || 'none'}`
    );
    t.diagnostic(
        `probe modes captured in report: ${(report?.modesCaptured || []).join(', ') || 'none'}`
    );
    t.diagnostic(
        `map motion coverage: ${Object.entries(smoothness.stateCoverage.mapMotionCounts)
            .map(([state, count]) => `${state}:${count}`)
            .join(', ') || 'none'}`
    );
    t.diagnostic(
        `cluster-key coverage: ${Object.entries(smoothness.stateCoverage.clusterKeyCounts)
            .map(([key, count]) => `${key}:${count}`)
            .join(' | ') || 'none'}`
    );
    t.diagnostic(
        `stage-signature coverage: ${Object.entries(smoothness.stateCoverage.stageSignatureCounts)
            .map(([key, count]) => `${key}:${count}`)
            .join(' | ') || 'none'}`
    );
    t.diagnostic(
        `visible-layer-pattern coverage: ${Object.entries(smoothness.stateCoverage.visibleLayerPatternCounts)
            .map(([pattern, count]) => `${pattern}:${count}`)
            .join(' | ') || 'none'}`
    );
    t.diagnostic(
        `cluster-size coverage: ${Object.entries(smoothness.stateCoverage.clusterSizeCounts)
            .map(([size, count]) => `${size}:${count}`)
            .join(', ') || 'none'}`
    );
    t.diagnostic(
        `timestamp deltas: count=${smoothness.telemetry.timestampDeltasMs.count} ` +
        `min=${formatMetric(smoothness.telemetry.timestampDeltasMs.min, 3)}ms ` +
        `max=${formatMetric(smoothness.telemetry.timestampDeltasMs.max, 3)}ms ` +
        `mean=${formatMetric(smoothness.telemetry.timestampDeltasMs.mean, 3)}ms ` +
        `p95=${formatMetric(smoothness.telemetry.timestampDeltasMs.p95, 3)}ms ` +
        `p99=${formatMetric(smoothness.telemetry.timestampDeltasMs.p99, 3)}ms`
    );
    const resetInvariant = report?.resetInvariant || {};
    t.diagnostic(
        `map reset invariant: signaturesMatch=${resetInvariant.signaturesMatch ? 'yes' : 'no'} ` +
        `stationDelta=${formatMetric(resetInvariant.stationCountDelta, 0)} ` +
        `pairDelta=${formatMetric(resetInvariant.pairCountDelta, 0)} ` +
        `maxPairDistanceDelta=${formatMetric(resetInvariant.maxPairDistanceDelta, 3)}px ` +
        `meanPairDistanceDelta=${formatMetric(resetInvariant.meanPairDistanceDelta, 3)}px`
    );
    if (resetInvariant.startStationScreenSnapshot || resetInvariant.endStationScreenSnapshot) {
        const startSnapshot = resetInvariant.startStationScreenSnapshot || {};
        const endSnapshot = resetInvariant.endStationScreenSnapshot || {};
        t.diagnostic(
            `map reset start snapshot: stations=${startSnapshot.stationCount || 0} pairs=${startSnapshot.pairCount || 0} ` +
            `pair[min=${formatMetric(startSnapshot.pairDistanceMin, 3)}px max=${formatMetric(startSnapshot.pairDistanceMax, 3)}px ` +
            `mean=${formatMetric(startSnapshot.pairDistanceMean, 3)}px p95=${formatMetric(startSnapshot.pairDistanceP95, 3)}px]`
        );
        t.diagnostic(
            `map reset end snapshot: stations=${endSnapshot.stationCount || 0} pairs=${endSnapshot.pairCount || 0} ` +
            `pair[min=${formatMetric(endSnapshot.pairDistanceMin, 3)}px max=${formatMetric(endSnapshot.pairDistanceMax, 3)}px ` +
            `mean=${formatMetric(endSnapshot.pairDistanceMean, 3)}px p95=${formatMetric(endSnapshot.pairDistanceP95, 3)}px]`
        );
    }

    Object.entries(smoothness.telemetry.layerKinematics).forEach(([layerKey, telemetry]) => {
        t.diagnostic(
            `layer kinematics ${layerKey}: path=${formatMetric(telemetry.pathDistance, 3)}px ` +
            `moving=${telemetry.movingFrames} stationary=${telemetry.stationaryFrames} flips=${telemetry.directionFlipCount} ` +
            `speed[max=${formatMetric(telemetry.speed.max, 3)}px/s p95=${formatMetric(telemetry.speed.p95, 3)}px/s p99=${formatMetric(telemetry.speed.p99, 3)}px/s] ` +
            `accel[max=${formatMetric(telemetry.acceleration.max, 3)}px/s^2 p95=${formatMetric(telemetry.acceleration.p95, 3)}px/s^2 p99=${formatMetric(telemetry.acceleration.p99, 3)}px/s^2] ` +
            `jerk[max=${formatMetric(telemetry.jerk.max, 3)}px/s^3 p95=${formatMetric(telemetry.jerk.p95, 3)}px/s^3 p99=${formatMetric(telemetry.jerk.p99, 3)}px/s^3]`
        );
    });

    Object.entries(smoothness.telemetry.layerPairDistances).forEach(([pairKey, telemetry]) => {
        t.diagnostic(
            `layer pair ${pairKey}: distance[count=${telemetry.distanceSeries.count} min=${formatMetric(telemetry.distanceSeries.min, 3)}px ` +
            `max=${formatMetric(telemetry.distanceSeries.max, 3)}px mean=${formatMetric(telemetry.distanceSeries.mean, 3)}px ` +
            `p95=${formatMetric(telemetry.distanceSeries.p95, 3)}px p99=${formatMetric(telemetry.distanceSeries.p99, 3)}px] ` +
            `delta[max=${formatMetric(telemetry.deltaSeries.max, 3)}px p95=${formatMetric(telemetry.deltaSeries.p95, 3)}px ` +
            `p99=${formatMetric(telemetry.deltaSeries.p99, 3)}px]`
        );
    });

    Object.entries(smoothness.telemetry.numericFields).forEach(([fieldName, telemetry]) => {
        t.diagnostic(
            `numeric field ${fieldName}: count=${telemetry.series.count} nonFinite=${telemetry.nonFiniteCount} ` +
            `value[min=${formatMetric(telemetry.series.min, 3)} max=${formatMetric(telemetry.series.max, 3)} ` +
            `mean=${formatMetric(telemetry.series.mean, 3)} std=${formatMetric(telemetry.series.stdDev, 3)} ` +
            `p01=${formatMetric(telemetry.series.p01, 3)} p05=${formatMetric(telemetry.series.p05, 3)} ` +
            `p50=${formatMetric(telemetry.series.p50, 3)} p95=${formatMetric(telemetry.series.p95, 3)} p99=${formatMetric(telemetry.series.p99, 3)} ` +
            `first=${formatMetric(telemetry.series.first, 3)} last=${formatMetric(telemetry.series.last, 3)} drift=${formatMetric(telemetry.series.drift, 3)}] ` +
            `step[max=${formatMetric(telemetry.stepSeries.max, 3)} mean=${formatMetric(telemetry.stepSeries.mean, 3)} ` +
            `p95=${formatMetric(telemetry.stepSeries.p95, 3)} p99=${formatMetric(telemetry.stepSeries.p99, 3)}]`
        );
    });

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

    smoothness.containerTracks.topOffsetFrames.forEach(frame => {
        t.diagnostic(
            `container offset #${frame.index}: offset=${formatMetric(frame.offset, 3)}px ` +
            `phase=${frame.phase} stage=${frame.stageSignature || 'none'} ` +
            `logical=${frame.logicalLayer || 'none'} visual=${frame.visualLayer || 'none'}`
        );
    });

    smoothness.containerTracks.topOffsetDeltaFrames.forEach(frame => {
        t.diagnostic(
            `container offset delta #${frame.index}: delta=${formatMetric(frame.delta, 3)}px ` +
            `phase=${frame.phase} stage=${frame.stageSignature || 'none'} ` +
            `logical=${frame.logicalLayer || 'none'} visual=${frame.visualLayer || 'none'}`
        );
    });

    smoothness.idleMovement.topRuns.forEach(run => {
        t.diagnostic(
            `idle movement run #${run.startIndex}-${run.endIndex}: duration=${formatMetric(run.durationMs, 0)}ms ` +
            `maxDelta=${formatMetric(run.maxDelta, 3)}px@${run.maxDeltaIndex} ` +
            `phase=${run.phase} stage=${run.stageSignature || 'none'}`
        );
    });

    smoothness.disconnectHandoff.topEvents.forEach(event => {
        t.diagnostic(
            `disconnect handoff #${event.index}: position=${formatMetric(event.positionDelta, 3)}px ` +
            `size=${formatMetric(event.sizeDelta, 3)}px content=${formatMetric(event.contentDelta, 3)} ` +
            `srcVisible=${event.sourceVisible ? 'yes' : 'no'} phase=${event.phase} ` +
            `stage=${event.stageSignature || 'none'} ` +
            `+ ${formatMetric(event.sourcePlusOpacity, 3)} -> ${formatMetric(event.targetPlusOpacity, 3)} ` +
            `price ${formatMetric(event.sourcePriceOpacity, 3)} -> ${formatMetric(event.targetPriceOpacity, 3)}`
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

    Object.entries(smoothness.telemetry.layerKinematics).forEach(([layerKey, telemetry]) => {
        telemetry.topDirectionFlips.forEach(event => {
            t.diagnostic(
                `direction flip #${event.index}: layer=${layerKey} ` +
                `prev=${formatMetric(event.previousMagnitude, 3)}px cur=${formatMetric(event.currentMagnitude, 3)}px ` +
                `phase=${event.phase} stage=${event.stageSignature || 'none'} mode=${event.mode}`
            );
        });
    });

    Object.entries(smoothness.telemetry.layerPairDistances).forEach(([pairKey, telemetry]) => {
        telemetry.topDeltas.forEach(event => {
            t.diagnostic(
                `layer pair delta #${event.index}: pair=${pairKey} delta=${formatMetric(event.delta, 3)}px ` +
                `distance ${formatMetric(event.previousDistance, 3)} -> ${formatMetric(event.currentDistance, 3)} ` +
                `phase=${event.phase} stage=${event.stageSignature || 'none'} mode=${event.mode}`
            );
        });
    });

    Object.entries(smoothness.telemetry.numericFields).forEach(([fieldName, telemetry]) => {
        telemetry.topSteps.forEach(event => {
            t.diagnostic(
                `field step #${event.index}: ${fieldName} delta=${formatMetric(event.delta, 3)} ` +
                `${formatMetric(event.from, 3)} -> ${formatMetric(event.to, 3)} ` +
                `phase=${event.phase} stage=${event.stageSignature || 'none'} mode=${event.mode}`
            );
        });
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
