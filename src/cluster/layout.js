import {
  CLUSTER_COLLAPSED_OFFSET,
  CLUSTER_PARENT_MIN_HEIGHT,
  CLUSTER_PARENT_MIN_WIDTH,
  CLUSTER_PILL_HEIGHT,
  CLUSTER_PRIMARY_PILL_WIDTH,
} from './constants';

export function buildClusterMembershipKey(cluster) {
  if (!cluster?.quotes?.length) {
    return '';
  }

  return cluster.quotes.map(quote => quote.stationId).join(',');
}

export function buildMapProjection(mapRegion, screenWidth, screenHeight) {
  const ptPerLng = mapRegion?.longitudeDelta ? screenWidth / mapRegion.longitudeDelta : 0;
  const ptPerLat = mapRegion?.latitudeDelta ? screenHeight / mapRegion.latitudeDelta : 0;

  return {
    ptPerLng,
    ptPerLat,
  };
}

export function projectQuoteOffset(quote, primaryQuote, projection) {
  return {
    x: (quote.longitude - primaryQuote.longitude) * projection.ptPerLng,
    y: -(quote.latitude - primaryQuote.latitude) * projection.ptPerLat,
  };
}

export function buildOutsideTargets(quotes, projection) {
  if (!Array.isArray(quotes) || quotes.length <= 1) {
    return [];
  }

  const primaryQuote = quotes[0];

  return quotes.slice(1).map(quote => {
    const offset = projectQuoteOffset(quote, primaryQuote, projection);

    return {
      stationId: quote.stationId,
      quote,
      x: offset.x,
      y: offset.y,
      width: CLUSTER_PRIMARY_PILL_WIDTH,
      height: CLUSTER_PILL_HEIGHT,
    };
  });
}

export function computeAccumulatorAnchor() {
  return {
    x: CLUSTER_COLLAPSED_OFFSET,
    y: 0,
  };
}

export function computeParentBounds({
  outsideTargets,
  mergeMover,
  splitMover,
}) {
  const baseHalfWidth = CLUSTER_PRIMARY_PILL_WIDTH / 2;
  const baseHalfHeight = CLUSTER_PILL_HEIGHT / 2;
  const mergeHalfWidth = (mergeMover?.width || CLUSTER_PRIMARY_PILL_WIDTH) / 2;
  const mergeHalfHeight = (mergeMover?.height || CLUSTER_PILL_HEIGHT) / 2;
  const splitHalfWidth = (splitMover?.width || CLUSTER_PRIMARY_PILL_WIDTH) / 2;
  const splitHalfHeight = (splitMover?.height || CLUSTER_PILL_HEIGHT) / 2;

  const rects = [
    {
      left: -baseHalfWidth,
      right: baseHalfWidth,
      top: -baseHalfHeight,
      bottom: baseHalfHeight,
    },
    {
      left: computeAccumulatorAnchor().x - baseHalfWidth,
      right: computeAccumulatorAnchor().x + baseHalfWidth,
      top: computeAccumulatorAnchor().y - baseHalfHeight,
      bottom: computeAccumulatorAnchor().y + baseHalfHeight,
    },
    ...(outsideTargets || []).map(target => ({
      left: target.x - (target.width || CLUSTER_PRIMARY_PILL_WIDTH) / 2,
      right: target.x + (target.width || CLUSTER_PRIMARY_PILL_WIDTH) / 2,
      top: target.y - (target.height || CLUSTER_PILL_HEIGHT) / 2,
      bottom: target.y + (target.height || CLUSTER_PILL_HEIGHT) / 2,
    })),
    mergeMover
      ? {
        left: mergeMover.x - mergeHalfWidth,
        right: mergeMover.x + mergeHalfWidth,
        top: mergeMover.y - mergeHalfHeight,
        bottom: mergeMover.y + mergeHalfHeight,
      }
      : null,
    splitMover
      ? {
        left: splitMover.x - splitHalfWidth,
        right: splitMover.x + splitHalfWidth,
        top: splitMover.y - splitHalfHeight,
        bottom: splitMover.y + splitHalfHeight,
      }
      : null,
  ].filter(Boolean);

  const minLeft = Math.min(...rects.map(rect => rect.left));
  const maxRight = Math.max(...rects.map(rect => rect.right));
  const minTop = Math.min(...rects.map(rect => rect.top));
  const maxBottom = Math.max(...rects.map(rect => rect.bottom));
  const horizontalReach = Math.max(Math.abs(minLeft), Math.abs(maxRight));
  const verticalReach = Math.max(Math.abs(minTop), Math.abs(maxBottom));
  const widthFromRects = maxRight - minLeft + 36;
  const heightFromRects = maxBottom - minTop + 36;

  return {
    width: Math.max(CLUSTER_PARENT_MIN_WIDTH, widthFromRects),
    height: Math.max(CLUSTER_PARENT_MIN_HEIGHT, heightFromRects),
    horizontalReach,
    verticalReach,
  };
}

export function resolveAnimationDuration(distance, { baseMs, perPointMs, maxMs }) {
  const rawDuration = Math.round(baseMs + (Math.max(0, distance) * perPointMs));
  return Math.max(baseMs, Math.min(maxMs, rawDuration));
}

export function buildOutsidePillRect(target, padding = 0) {
  const width = target.width + padding * 2;
  const height = target.height + padding * 2;

  return {
    stationId: target.stationId,
    left: target.x - width / 2,
    right: target.x + width / 2,
    top: target.y - height / 2,
    bottom: target.y + height / 2,
    width,
    height,
  };
}
