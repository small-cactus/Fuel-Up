import {
  CLUSTER_MERGE_ANIMATION_BASE_MS,
  CLUSTER_MERGE_ANIMATION_MAX_MS,
  CLUSTER_MERGE_ANIMATION_PER_POINT_MS,
  CLUSTER_PROBE_TRANSITION_TYPES,
  CLUSTER_RUNTIME_PHASE,
  CLUSTER_SPLIT_ANIMATION_BASE_MS,
  CLUSTER_SPLIT_ANIMATION_MAX_MS,
  CLUSTER_SPLIT_ANIMATION_PER_POINT_MS,
} from './constants';
import {
  buildClusterMembershipKey,
  buildMapProjection,
  buildOutsideTargets,
  computeAccumulatorAnchor,
  resolveAnimationDuration,
} from './layout';

function buildQuoteMap(quotes) {
  return new Map((quotes || []).map(quote => [String(quote.stationId), quote]));
}

export function detectClusterTransition(previousCluster, nextCluster) {
  const previousQuotes = previousCluster?.quotes || [];
  const nextQuotes = nextCluster?.quotes || [];
  const previousPrimary = previousQuotes[0]?.stationId;
  const nextPrimary = nextQuotes[0]?.stationId;

  if (!previousPrimary || !nextPrimary || String(previousPrimary) !== String(nextPrimary)) {
    return {
      type: 'none',
      addedQuotes: [],
      removedQuotes: [],
      previousKey: buildClusterMembershipKey(previousCluster),
      nextKey: buildClusterMembershipKey(nextCluster),
    };
  }

  const previousMap = buildQuoteMap(previousQuotes);
  const nextMap = buildQuoteMap(nextQuotes);

  const addedQuotes = nextQuotes.filter(quote => !previousMap.has(String(quote.stationId)));
  const removedQuotes = previousQuotes.filter(quote => !nextMap.has(String(quote.stationId)));

  if (addedQuotes.length > 0) {
    return {
      type: 'merge',
      addedQuotes,
      removedQuotes: [],
      previousKey: buildClusterMembershipKey(previousCluster),
      nextKey: buildClusterMembershipKey(nextCluster),
    };
  }

  if (removedQuotes.length > 0) {
    return {
      type: 'split',
      addedQuotes: [],
      removedQuotes,
      previousKey: buildClusterMembershipKey(previousCluster),
      nextKey: buildClusterMembershipKey(nextCluster),
    };
  }

  return {
    type: 'none',
    addedQuotes: [],
    removedQuotes: [],
    previousKey: buildClusterMembershipKey(previousCluster),
    nextKey: buildClusterMembershipKey(nextCluster),
  };
}

function buildMergeQueue({ previousCluster, nextCluster, mapRegion, screenWidth, screenHeight }) {
  const projection = buildMapProjection(mapRegion, screenWidth, screenHeight);
  const nextOutsideTargets = buildOutsideTargets(nextCluster.quotes, projection);
  const nextOutsideById = new Map(nextOutsideTargets.map(target => [String(target.stationId), target]));
  const accumulator = computeAccumulatorAnchor();

  return nextCluster.quotes
    .filter((quote, index) => index > 0)
    .filter(quote => {
      const previousIds = new Set((previousCluster?.quotes || []).map(item => String(item.stationId)));
      return !previousIds.has(String(quote.stationId));
    })
    .map((quote, index) => {
      const outside = nextOutsideById.get(String(quote.stationId));
      const startX = outside?.x ?? accumulator.x;
      const startY = outside?.y ?? accumulator.y;
      const distance = Math.hypot(accumulator.x - startX, accumulator.y - startY);

      return {
        stationId: quote.stationId,
        quote,
        startX,
        startY,
        endX: accumulator.x,
        endY: accumulator.y,
        durationMs: resolveAnimationDuration(distance, {
          baseMs: CLUSTER_MERGE_ANIMATION_BASE_MS,
          perPointMs: CLUSTER_MERGE_ANIMATION_PER_POINT_MS,
          maxMs: CLUSTER_MERGE_ANIMATION_MAX_MS,
        }),
        sequenceIndex: index,
      };
    })
    .sort((left, right) => left.sequenceIndex - right.sequenceIndex);
}

function buildSplitQueue({ previousCluster, nextCluster, mapRegion, screenWidth, screenHeight }) {
  const projection = buildMapProjection(mapRegion, screenWidth, screenHeight);
  const primaryQuote = nextCluster?.quotes?.[0] || previousCluster?.quotes?.[0];
  const accumulator = computeAccumulatorAnchor();

  if (!primaryQuote) {
    return [];
  }

  const nextIds = new Set((nextCluster?.quotes || []).map(quote => String(quote.stationId)));

  return (previousCluster?.quotes || [])
    .filter((quote, index) => index > 0)
    .filter(quote => !nextIds.has(String(quote.stationId)))
    .map((quote, index) => {
      const endX = (quote.longitude - primaryQuote.longitude) * projection.ptPerLng;
      const endY = -(quote.latitude - primaryQuote.latitude) * projection.ptPerLat;
      const distance = Math.hypot(endX - accumulator.x, endY - accumulator.y);

      return {
        stationId: quote.stationId,
        quote,
        startX: accumulator.x,
        startY: accumulator.y,
        endX,
        endY,
        durationMs: resolveAnimationDuration(distance, {
          baseMs: CLUSTER_SPLIT_ANIMATION_BASE_MS,
          perPointMs: CLUSTER_SPLIT_ANIMATION_PER_POINT_MS,
          maxMs: CLUSTER_SPLIT_ANIMATION_MAX_MS,
        }),
        sequenceIndex: index,
      };
    })
    .sort((left, right) => left.sequenceIndex - right.sequenceIndex);
}

export function buildTransitionPlan({
  previousCluster,
  nextCluster,
  mapRegion,
  screenWidth,
  screenHeight,
}) {
  const transition = detectClusterTransition(previousCluster, nextCluster);

  if (transition.type === 'merge') {
    return {
      type: 'merge',
      runtimePhase: CLUSTER_RUNTIME_PHASE.MERGE_PREP,
      transitionKey: `${transition.previousKey}->${transition.nextKey}`,
      queue: buildMergeQueue({ previousCluster, nextCluster, mapRegion, screenWidth, screenHeight }),
      events: [
        {
          type: CLUSTER_PROBE_TRANSITION_TYPES.MERGE_SEQUENCE_START,
          fromClusterKey: transition.previousKey,
          toClusterKey: transition.nextKey,
        },
      ],
    };
  }

  if (transition.type === 'split') {
    return {
      type: 'split',
      runtimePhase: CLUSTER_RUNTIME_PHASE.SPLIT_PREP,
      transitionKey: `${transition.previousKey}->${transition.nextKey}`,
      queue: buildSplitQueue({ previousCluster, nextCluster, mapRegion, screenWidth, screenHeight }),
      events: [
        {
          type: CLUSTER_PROBE_TRANSITION_TYPES.SPLIT_SEQUENCE_START,
          fromClusterKey: transition.previousKey,
          toClusterKey: transition.nextKey,
        },
      ],
    };
  }

  return {
    type: 'none',
    runtimePhase: CLUSTER_RUNTIME_PHASE.LIVE,
    transitionKey: transition.nextKey,
    queue: [],
    events: [],
  };
}
