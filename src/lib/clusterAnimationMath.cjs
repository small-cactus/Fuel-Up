const CLUSTER_MERGE_LAT_FACTOR = 0.040;
const CLUSTER_MERGE_LNG_FACTOR = 0.16;
const CLUSTER_SPLIT_MULTIPLIER = 1.5;

const PRIMARY_PILL_WIDTH = 84;
const PRIMARY_PILL_HEIGHT = 32;
const COLLAPSED_OVERLAP = 8;
const COLLAPSED_OFFSET = ((84 + 44) / 2) - COLLAPSED_OVERLAP;

const SPLIT_HANDOFF_POSITION_EPSILON = 0.5;
const SPLIT_HANDOFF_SIZE_EPSILON = 0.5;
const SPLIT_HANDOFF_CONTENT_EPSILON = 0.01;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function buildProjection(mapRegion, screenWidth, screenHeight) {
  return {
    ptPerLng: mapRegion?.longitudeDelta ? screenWidth / mapRegion.longitudeDelta : 0,
    ptPerLat: mapRegion?.latitudeDelta ? screenHeight / mapRegion.latitudeDelta : 0,
  };
}

function projectQuote(quote, anchorQuote, projection) {
  return {
    x: (quote.longitude - anchorQuote.longitude) * projection.ptPerLng,
    y: -(quote.latitude - anchorQuote.latitude) * projection.ptPerLat,
  };
}

function buildClusterMembershipKey(cluster) {
  if (!cluster?.quotes?.length) {
    return '';
  }

  return cluster.quotes.map(quote => quote.stationId).join(',');
}

function buildOutsidePriceTargets(quotes, mapRegion, screenWidth, screenHeight) {
  if (!quotes || quotes.length <= 1) {
    return [];
  }

  const projection = buildProjection(mapRegion, screenWidth, screenHeight);
  const primaryQuote = quotes[0];

  return quotes.slice(1).map(quote => {
    const point = projectQuote(quote, primaryQuote, projection);
    return {
      stationId: quote.stationId,
      quote,
      x: point.x,
      y: point.y,
      width: PRIMARY_PILL_WIDTH,
      height: PRIMARY_PILL_HEIGHT,
    };
  });
}

function computeParentBoundsForTargets(targets, extraPoints = []) {
  const points = [
    { x: 0, y: 0 },
    { x: COLLAPSED_OFFSET, y: 0 },
    ...(targets || []).map(target => ({ x: target.x, y: target.y })),
    ...extraPoints,
  ].filter(Boolean);

  const horizontalReach = Math.max(COLLAPSED_OFFSET, ...points.map(point => Math.abs(point.x)));
  const verticalReach = Math.max(0, ...points.map(point => Math.abs(point.y)));

  return {
    width: Math.max(240, 48 + PRIMARY_PILL_WIDTH + horizontalReach * 2),
    height: Math.max(80, 52 + verticalReach * 2),
    horizontalReach,
    verticalReach,
  };
}

function computeParentBoundsForQuotes({ quotes, mapRegion, screenWidth, screenHeight }) {
  const targets = buildOutsidePriceTargets(quotes, mapRegion, screenWidth, screenHeight);
  return computeParentBoundsForTargets(targets);
}

function computeDistance(startX, startY, endX, endY) {
  return Math.hypot(endX - startX, endY - startY);
}

function resolveDuration(distance, baseMs, perPointMs, maxMs) {
  return Math.max(baseMs, Math.min(maxMs, Math.round(baseMs + distance * perPointMs)));
}

function buildMergeSequence({ fromCluster, toCluster, mapRegion, screenWidth, screenHeight }) {
  const fromIds = new Set((fromCluster?.quotes || []).map(quote => String(quote.stationId)));
  const toQuotes = toCluster?.quotes || [];
  const targets = buildOutsidePriceTargets(toQuotes, mapRegion, screenWidth, screenHeight);
  const targetById = new Map(targets.map(target => [String(target.stationId), target]));

  return toQuotes
    .filter((quote, index) => index > 0)
    .filter(quote => !fromIds.has(String(quote.stationId)))
    .map((quote, index) => {
      const sourceTarget = targetById.get(String(quote.stationId));
      const startX = sourceTarget?.x || COLLAPSED_OFFSET;
      const startY = sourceTarget?.y || 0;
      const endX = COLLAPSED_OFFSET;
      const endY = 0;

      return {
        sequenceIndex: index,
        stationId: quote.stationId,
        quote,
        startX,
        startY,
        endX,
        endY,
        distance: computeDistance(startX, startY, endX, endY),
        durationMs: resolveDuration(
          computeDistance(startX, startY, endX, endY),
          220,
          24,
          700
        ),
      };
    });
}

function buildSplitSequence({ fromCluster, toCluster, mapRegion, screenWidth, screenHeight }) {
  const toIds = new Set((toCluster?.quotes || []).map(quote => String(quote.stationId)));
  const fromQuotes = fromCluster?.quotes || [];
  const primaryQuote = toCluster?.quotes?.[0] || fromQuotes[0];

  if (!primaryQuote) {
    return [];
  }

  const projection = buildProjection(mapRegion, screenWidth, screenHeight);

  return fromQuotes
    .filter((quote, index) => index > 0)
    .filter(quote => !toIds.has(String(quote.stationId)))
    .map((quote, index) => {
      const target = projectQuote(quote, primaryQuote, projection);
      const startX = COLLAPSED_OFFSET;
      const startY = 0;
      const endX = target.x;
      const endY = target.y;

      return {
        sequenceIndex: index,
        stationId: quote.stationId,
        quote,
        startX,
        startY,
        endX,
        endY,
        distance: computeDistance(startX, startY, endX, endY),
        durationMs: resolveDuration(
          computeDistance(startX, startY, endX, endY),
          210,
          20,
          620
        ),
      };
    });
}

function computeSplitHandoffTolerance() {
  return {
    positionDeltaPx: SPLIT_HANDOFF_POSITION_EPSILON,
    sizeDeltaPx: SPLIT_HANDOFF_SIZE_EPSILON,
    contentDelta: SPLIT_HANDOFF_CONTENT_EPSILON,
  };
}

function doRectsTouch(left, right) {
  return (
    left.left <= right.right &&
    left.right >= right.left &&
    left.top <= right.bottom &&
    left.bottom >= right.top
  );
}

function buildRectForQuote(quote, mapRegion, screenWidth, screenHeight, padding) {
  const projection = buildProjection(mapRegion, screenWidth, screenHeight);
  const centerLng = mapRegion?.longitude || 0;
  const centerLat = mapRegion?.latitude || 0;
  const width = PRIMARY_PILL_WIDTH + padding * 2;
  const height = PRIMARY_PILL_HEIGHT + padding * 2;
  const x = (quote.longitude - centerLng) * projection.ptPerLng;
  const y = -(quote.latitude - centerLat) * projection.ptPerLat;

  return {
    x,
    y,
    left: x - width / 2,
    right: x + width / 2,
    top: y - height / 2,
    bottom: y + height / 2,
  };
}

function buildPreviousPairSet(previousClusters) {
  const pairSet = new Set();

  (previousClusters || []).forEach(cluster => {
    const ids = (cluster?.quotes || []).map(quote => String(quote.stationId));
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const key = ids[i] < ids[j] ? `${ids[i]}|${ids[j]}` : `${ids[j]}|${ids[i]}`;
        pairSet.add(key);
      }
    }
  });

  return pairSet;
}

function groupByTouch({ stationQuotes, mapRegion, screenWidth, screenHeight, previousClusters = [] }) {
  const quotes = [...(stationQuotes || [])].sort((left, right) => left.price - right.price);
  if (quotes.length === 0) {
    return [];
  }

  const parent = quotes.map((_, index) => index);
  const rank = quotes.map(() => 0);
  const previousPairSet = buildPreviousPairSet(previousClusters);

  const find = (index) => {
    if (parent[index] !== index) {
      parent[index] = find(parent[index]);
    }
    return parent[index];
  };

  const union = (leftIndex, rightIndex) => {
    const leftRoot = find(leftIndex);
    const rightRoot = find(rightIndex);

    if (leftRoot === rightRoot) {
      return;
    }

    if (rank[leftRoot] < rank[rightRoot]) {
      parent[leftRoot] = rightRoot;
      return;
    }

    if (rank[leftRoot] > rank[rightRoot]) {
      parent[rightRoot] = leftRoot;
      return;
    }

    parent[rightRoot] = leftRoot;
    rank[leftRoot] += 1;
  };

  for (let i = 0; i < quotes.length; i += 1) {
    for (let j = i + 1; j < quotes.length; j += 1) {
      const left = quotes[i];
      const right = quotes[j];
      const leftId = String(left.stationId);
      const rightId = String(right.stationId);
      const key = leftId < rightId ? `${leftId}|${rightId}` : `${rightId}|${leftId}`;
      const wasGrouped = previousPairSet.has(key);
      const padding = 6 * (wasGrouped ? 1.3 : 1);
      const leftRect = buildRectForQuote(left, mapRegion, screenWidth, screenHeight, padding);
      const rightRect = buildRectForQuote(right, mapRegion, screenWidth, screenHeight, padding);

      if (doRectsTouch(leftRect, rightRect)) {
        union(i, j);
      }
    }
  }

  const groupsByRoot = new Map();
  quotes.forEach((quote, index) => {
    const root = find(index);
    const current = groupsByRoot.get(root) || [];
    groupsByRoot.set(root, [...current, quote]);
  });

  return Array.from(groupsByRoot.values()).map(groupQuotes => {
    const sortedQuotes = [...groupQuotes].sort((left, right) => left.price - right.price);
    const averageLat = sortedQuotes.reduce((sum, quote) => sum + quote.latitude, 0) / sortedQuotes.length;
    const averageLng = sortedQuotes.reduce((sum, quote) => sum + quote.longitude, 0) / sortedQuotes.length;

    return {
      quotes: sortedQuotes,
      averageLat,
      averageLng,
    };
  });
}

module.exports = {
  CLUSTER_MERGE_LAT_FACTOR,
  CLUSTER_MERGE_LNG_FACTOR,
  CLUSTER_SPLIT_MULTIPLIER,
  CLUSTER_SPLIT_HANDOFF_POSITION_EPSILON: SPLIT_HANDOFF_POSITION_EPSILON,
  CLUSTER_SPLIT_HANDOFF_SIZE_EPSILON: SPLIT_HANDOFF_SIZE_EPSILON,
  CLUSTER_SPLIT_HANDOFF_CONTENT_EPSILON: SPLIT_HANDOFF_CONTENT_EPSILON,
  PRIMARY_PILL_WIDTH,
  PRIMARY_PILL_HEIGHT,
  COLLAPSED_OFFSET,
  SPLIT_HANDOFF_POSITION_EPSILON,
  SPLIT_HANDOFF_SIZE_EPSILON,
  SPLIT_HANDOFF_CONTENT_EPSILON,
  clamp01,
  buildClusterMembershipKey,
  buildOutsidePriceTargets,
  computeParentBoundsForTargets,
  computeParentBoundsForQuotes,
  buildMergeSequence,
  buildSplitSequence,
  computeSplitHandoffTolerance,
  groupByTouch,
};
