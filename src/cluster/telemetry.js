import { CLUSTER_LAYER_KEYS } from './constants';

export function isVisibleLayer(sample, layerKey) {
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

export function getVisibleLayers(sample) {
  return CLUSTER_LAYER_KEYS.filter(layerKey => isVisibleLayer(sample, layerKey));
}

export function computeLayerDelta(previousSample, nextSample, layerKey) {
  if (!previousSample || !nextSample) {
    return 0;
  }

  if (!isVisibleLayer(nextSample, layerKey)) {
    return 0;
  }

  const previousX = Number.isFinite(previousSample[`${layerKey}X`]) ? previousSample[`${layerKey}X`] : 0;
  const previousY = Number.isFinite(previousSample[`${layerKey}Y`]) ? previousSample[`${layerKey}Y`] : 0;
  const nextX = Number.isFinite(nextSample[`${layerKey}X`]) ? nextSample[`${layerKey}X`] : 0;
  const nextY = Number.isFinite(nextSample[`${layerKey}Y`]) ? nextSample[`${layerKey}Y`] : 0;

  return Math.hypot(nextX - previousX, nextY - previousY);
}

export function buildRenderSummary(sample) {
  if (!sample) {
    return 'No sample';
  }

  const visibleLayers = getVisibleLayers(sample);
  const layerLabel = visibleLayers.length > 0 ? visibleLayers.join('+') : 'primary-only';
  const toLabel = sample.toClusterKey ? ` to=[${sample.toClusterKey}]` : '';

  return `${sample.runtimePhase || 'live'} ${layerLabel} from=[${sample.fromClusterKey || ''}]${toLabel}`;
}

export function finalizeDebugSample(frame, previousSample, probeMode = 'idle') {
  const outsideFrameDelta = computeLayerDelta(previousSample, frame, 'outside');
  const accumulatorFrameDelta = computeLayerDelta(previousSample, frame, 'accumulator');
  const mergeMoverFrameDelta = computeLayerDelta(previousSample, frame, 'mergeMover');
  const splitMoverFrameDelta = computeLayerDelta(previousSample, frame, 'splitMover');
  const maxFrameDelta = Math.max(
    outsideFrameDelta,
    accumulatorFrameDelta,
    mergeMoverFrameDelta,
    splitMoverFrameDelta
  );

  const visibleLayers = getVisibleLayers(frame);
  const sampleTimestamp = Number.isFinite(frame.frameTimestamp)
    ? frame.frameTimestamp
    : Date.now();
  const previousTimestamp = previousSample?.timestamp;
  const timestamp = Number.isFinite(previousTimestamp)
    ? Math.max(
      previousTimestamp + 1,
      Math.min(sampleTimestamp, previousTimestamp + 33)
    )
    : sampleTimestamp;

  return {
    ...frame,
    timestamp,
    probeMode,
    summary: buildRenderSummary(frame),
    visibleLayers: visibleLayers.join(','),
    visibleLayerCount: visibleLayers.length,
    outsideFrameDelta,
    accumulatorFrameDelta,
    mergeMoverFrameDelta,
    splitMoverFrameDelta,
    maxFrameDelta,
  };
}
