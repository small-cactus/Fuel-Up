import { CLUSTER_DEBUG_JUMP_THRESHOLD } from './constants.js';

export function formatDebugMetric(value, digits = 2) {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        return '--';
    }

    return value.toFixed(digits);
}

export function summarizeDebugSeries(samples, key) {
    const values = samples
        .map(sample => sample[key])
        .filter(value => typeof value === 'number' && Number.isFinite(value));

    if (values.length === 0) {
        return null;
    }

    const start = values[0];
    const end = values[values.length - 1];
    const min = Math.min(...values);
    const max = Math.max(...values);

    return {
        start,
        end,
        min,
        max,
        delta: end - start,
    };
}

export function formatSeriesLine(label, series, unit = '', digits = 2) {
    if (!series) {
        return `${label}=--`;
    }

    const deltaPrefix = series.delta > 0 ? '+' : '';

    return (
        `${label} ${formatDebugMetric(series.start, digits)} -> ${formatDebugMetric(series.end, digits)} ` +
        `(d ${deltaPrefix}${formatDebugMetric(series.delta, digits)}, min ${formatDebugMetric(series.min, digits)}, max ${formatDebugMetric(series.max, digits)})${unit}`
    );
}

export function formatDebugPoint(x, y, digits = 2) {
    return `(${formatDebugMetric(x, digits)}, ${formatDebugMetric(y, digits)})`;
}

export function getClusterDebugVisibleLayers(sample) {
    if (!sample) {
        return [];
    }

    const isVisible = (layerKey) => {
        const isRendered = Boolean(sample[`${layerKey}Visible`]);
        const rawOpacity = sample[`${layerKey}Opacity`];
        const resolvedOpacity = Number.isFinite(rawOpacity)
            ? rawOpacity
            : (isRendered ? 1 : 0);

        return isRendered && resolvedOpacity > 0.001;
    };

    const layers = [];

    if (isVisible('outside')) {
        layers.push('outside');
    }
    if (isVisible('accumulator')) {
        layers.push('accumulator');
    }
    if (isVisible('mergeMover')) {
        layers.push('mergeMover');
    }
    if (isVisible('splitMover')) {
        layers.push('splitMover');
    }

    return layers;
}

export function buildClusterDebugRenderSummary(sample) {
    if (!sample) {
        return 'No render sample';
    }

    const visibleLayers = getClusterDebugVisibleLayers(sample);
    const layerLabel = visibleLayers.length > 0 ? visibleLayers.join('+') : 'primary-only';
    const toLabel = sample.toClusterKey ? ` to=[${sample.toClusterKey}]` : '';

    return `${sample.runtimePhase} ${layerLabel} from=[${sample.fromClusterKey}]${toLabel}`;
}

export function computeClusterDebugLayerMotion(previousSample, nextSample, layerKey) {
    if (!previousSample || !nextSample) {
        return 0;
    }

    const visibleKey = `${layerKey}Visible`;
    const opacityKey = `${layerKey}Opacity`;
    const xKey = `${layerKey}X`;
    const yKey = `${layerKey}Y`;
    const nextVisible = Boolean(nextSample[visibleKey]);
    const nextOpacityRaw = nextSample[opacityKey];
    const nextOpacity = Number.isFinite(nextOpacityRaw)
        ? nextOpacityRaw
        : (nextVisible ? 1 : 0);

    if (!nextVisible || nextOpacity <= 0.001) {
        return 0;
    }

    return Math.hypot(
        (nextSample[xKey] || 0) - (previousSample[xKey] || 0),
        (nextSample[yKey] || 0) - (previousSample[yKey] || 0)
    );
}

export function buildClusterDebugTransitionTimeline(events, startedAt) {
    if (!events || events.length === 0) {
        return ['Runtime transitions: none'];
    }

    return [
        'Runtime transitions:',
        ...events.map(event => {
            const offsetMs = Math.max(0, Math.round((event.timestamp || startedAt) - startedAt));
            const prefix = `- t+${offsetMs}ms ${event.type}`;

            return (
                `${prefix} primary=${event.primaryStationId || 'n/a'} ` +
                `from=[${event.fromClusterKey || ''}] to=[${event.toClusterKey || ''}] ` +
                `transition=[${event.transitionKey || ''}]`
            ).trim();
        }),
    ];
}

export function buildClusterDebugJumpEvents(samples) {
    const trackedMetrics = [
        ['outsideFrameDelta', 'move(outside)'],
        ['accumulatorFrameDelta', 'move(accumulator)'],
        ['mergeMoverFrameDelta', 'move(mergeMover)'],
        ['splitMoverFrameDelta', 'move(splitMover)'],
        ['maxFrameDelta', 'move(max)'],
    ];
    const events = [];

    for (let index = 1; index < samples.length; index += 1) {
        const previousSample = samples[index - 1];
        const nextSample = samples[index];

        for (const [metricKey, label] of trackedMetrics) {
            const previousValue = previousSample[metricKey];
            const nextValue = nextSample[metricKey];

            if (!Number.isFinite(previousValue) || !Number.isFinite(nextValue)) {
                continue;
            }

            const delta = nextValue - previousValue;
            if (Math.abs(delta) <= CLUSTER_DEBUG_JUMP_THRESHOLD) {
                continue;
            }

            const causes = [];
            const rules = [];

            if (previousSample.clusterKey !== nextSample.clusterKey) {
                causes.push(`rendered cluster changed (${previousSample.clusterKey} -> ${nextSample.clusterKey})`);
            }
            if (previousSample.summary !== nextSample.summary) {
                causes.push(`summary changed ("${previousSample.summary}" -> "${nextSample.summary}")`);
            }
            if (previousSample.runtimePhase !== nextSample.runtimePhase) {
                causes.push(`runtime phase changed (${previousSample.runtimePhase} -> ${nextSample.runtimePhase})`);
            }
            if (previousSample.stageSignature !== nextSample.stageSignature) {
                causes.push(`stage changed (${previousSample.stageSignature} -> ${nextSample.stageSignature})`);
            }
            if (previousSample.visibleLayers !== nextSample.visibleLayers) {
                causes.push(`visible layers changed (${previousSample.visibleLayers || 'none'} -> ${nextSample.visibleLayers || 'none'})`);
            }
            rules.push('Runtime render rule: motion is measured from consecutive on-screen layer positions only.');

            const deltaPrefix = delta > 0 ? '+' : '';
            events.push(
                [
                    `- ${label} jumped ${deltaPrefix}${formatDebugMetric(delta)}pt (${formatDebugMetric(previousValue)} -> ${formatDebugMetric(nextValue)})`,
                    `  causes: ${causes.length > 0 ? causes.join('; ') : 'same watched overlay, layer moved on screen'}`,
                    `  rules: ${Array.from(new Set(rules)).join(' | ')}`,
                    `  factors: spread ${formatDebugMetric(previousSample.spreadProgress)} -> ${formatDebugMetric(nextSample.spreadProgress)}, morph ${formatDebugMetric(previousSample.morphProgress)} -> ${formatDebugMetric(nextSample.morphProgress)}, bridge ${formatDebugMetric(previousSample.bridgeProgress)} -> ${formatDebugMetric(nextSample.bridgeProgress)}, layers ${previousSample.visibleLayers || 'none'} -> ${nextSample.visibleLayers || 'none'}, reach ${formatDebugMetric(previousSample.maxSecondaryRadius)} -> ${formatDebugMetric(nextSample.maxSecondaryRadius)}, shell ${formatDebugMetric(previousSample.secondaryShellWidth)} -> ${formatDebugMetric(nextSample.secondaryShellWidth)}`
                ].join('\n')
            );
        }
    }

    return events;
}

export function buildClusterDebugRecordingLog(samples, transitionEvents = []) {
    if (!samples || samples.length === 0) {
        return '[ClusterDebug Recording]\nNo samples captured.';
    }

    const startedAt = samples[0].timestamp;
    const endedAt = samples[samples.length - 1].timestamp;
    const durationMs = Math.max(0, endedAt - startedAt);
    const clusterTransitions = samples.reduce((count, sample, index) => {
        if (index === 0) {
            return 0;
        }

        return count + (sample.clusterKey !== samples[index - 1].clusterKey ? 1 : 0);
    }, 0);
    const runtimePhaseTransitions = samples.reduce((count, sample, index) => {
        if (index === 0) {
            return 0;
        }

        return count + (sample.runtimePhase !== samples[index - 1].runtimePhase ? 1 : 0);
    }, 0);
    const spreadSeries = summarizeDebugSeries(samples, 'spreadProgress');
    const morphSeries = summarizeDebugSeries(samples, 'morphProgress');
    const bridgeProgressSeries = summarizeDebugSeries(samples, 'bridgeProgress');
    const visibleLayerCountSeries = summarizeDebugSeries(samples, 'visibleLayerCount');
    const maxReachSeries = summarizeDebugSeries(samples, 'maxSecondaryRadius');
    const shellWidthSeries = summarizeDebugSeries(samples, 'secondaryShellWidth');
    const outsideMoveSeries = summarizeDebugSeries(samples, 'outsideFrameDelta');
    const accumulatorMoveSeries = summarizeDebugSeries(samples, 'accumulatorFrameDelta');
    const mergeMoverMoveSeries = summarizeDebugSeries(samples, 'mergeMoverFrameDelta');
    const splitMoverMoveSeries = summarizeDebugSeries(samples, 'splitMoverFrameDelta');
    const maxMoveSeries = summarizeDebugSeries(samples, 'maxFrameDelta');
    const jumpEvents = buildClusterDebugJumpEvents(samples);

    return [
        '[ClusterDebug Recording]',
        `samples=${samples.length} duration=${durationMs}ms clusterChanges=${clusterTransitions}`,
        `renderedStart=${samples[0].clusterKey}`,
        `renderedEnd=${samples[samples.length - 1].clusterKey}`,
        `runtimeStart=${samples[0].runtimePhase || 'live'}`,
        `runtimeEnd=${samples[samples.length - 1].runtimePhase || 'live'}`,
        `runtimePhaseChanges=${runtimePhaseTransitions}`,
        formatSeriesLine('spread(render)', spreadSeries),
        formatSeriesLine('morph(render)', morphSeries),
        formatSeriesLine('bridge(progress)', bridgeProgressSeries),
        formatSeriesLine('layers(visible)', visibleLayerCountSeries),
        formatSeriesLine('reach(max)', maxReachSeries, 'pt'),
        formatSeriesLine('shellWidth', shellWidthSeries, 'pt'),
        formatSeriesLine('move(outside)', outsideMoveSeries, 'pt'),
        formatSeriesLine('move(accumulator)', accumulatorMoveSeries, 'pt'),
        formatSeriesLine('move(mergeMover)', mergeMoverMoveSeries, 'pt'),
        formatSeriesLine('move(splitMover)', splitMoverMoveSeries, 'pt'),
        formatSeriesLine('move(max)', maxMoveSeries, 'pt'),
        `summaryStart=${samples[0].summary}`,
        `summaryEnd=${samples[samples.length - 1].summary}`,
        `largeStepChanges>${CLUSTER_DEBUG_JUMP_THRESHOLD}pt=${jumpEvents.length}`,
        ...buildClusterDebugTransitionTimeline(transitionEvents, startedAt),
        ...(jumpEvents.length > 0
            ? ['Large step changes:', ...jumpEvents]
            : ['Large step changes: none']),
    ].join('\n');
}
