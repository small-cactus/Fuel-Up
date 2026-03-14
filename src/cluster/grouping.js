import {
  CLUSTER_PRIMARY_PILL_WIDTH,
  CLUSTER_TOUCH_PILL_HEIGHT,
} from './constants';

function buildQuoteRect(quote, mapRegion, screenWidth, screenHeight) {
  const safeScreenWidth = Number.isFinite(screenWidth) ? screenWidth : 0;
  const safeScreenHeight = Number.isFinite(screenHeight) ? screenHeight : 0;
  const ptPerLng = mapRegion?.longitudeDelta ? safeScreenWidth / mapRegion.longitudeDelta : 0;
  const ptPerLat = mapRegion?.latitudeDelta ? safeScreenHeight / mapRegion.latitudeDelta : 0;
  const centerLng = mapRegion?.longitude || 0;
  const centerLat = mapRegion?.latitude || 0;
  const x = (quote.longitude - centerLng) * ptPerLng;
  const y = -(quote.latitude - centerLat) * ptPerLat;

  return {
    stationId: quote.stationId,
    x,
    y,
    left: x - CLUSTER_PRIMARY_PILL_WIDTH / 2,
    right: x + CLUSTER_PRIMARY_PILL_WIDTH / 2,
    top: y - CLUSTER_TOUCH_PILL_HEIGHT / 2,
    bottom: y + CLUSTER_TOUCH_PILL_HEIGHT / 2,
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

function isFullyInsideMap(rect, screenWidth, screenHeight) {
  const halfWidth = (Number.isFinite(screenWidth) ? screenWidth : 0) / 2;
  const halfHeight = (Number.isFinite(screenHeight) ? screenHeight : 0) / 2;

  return (
    rect.left >= -halfWidth &&
    rect.right <= halfWidth &&
    rect.top >= -halfHeight &&
    rect.bottom <= halfHeight
  );
}

function findRoot(parentByIndex, index) {
  if (parentByIndex[index] !== index) {
    parentByIndex[index] = findRoot(parentByIndex, parentByIndex[index]);
  }
  return parentByIndex[index];
}

function unionRoots(parentByIndex, rankByIndex, leftIndex, rightIndex) {
  const leftRoot = findRoot(parentByIndex, leftIndex);
  const rightRoot = findRoot(parentByIndex, rightIndex);

  if (leftRoot === rightRoot) {
    return;
  }

  if (rankByIndex[leftRoot] < rankByIndex[rightRoot]) {
    parentByIndex[leftRoot] = rightRoot;
    return;
  }

  if (rankByIndex[leftRoot] > rankByIndex[rightRoot]) {
    parentByIndex[rightRoot] = leftRoot;
    return;
  }

  parentByIndex[rightRoot] = leftRoot;
  rankByIndex[leftRoot] += 1;
}

function buildCluster(groupQuotes) {
  const sortedQuotes = [...groupQuotes].sort((left, right) => left.price - right.price);
  const averageLat = sortedQuotes.reduce((sum, quote) => sum + quote.latitude, 0) / sortedQuotes.length;
  const averageLng = sortedQuotes.reduce((sum, quote) => sum + quote.longitude, 0) / sortedQuotes.length;

  return {
    quotes: sortedQuotes,
    averageLat,
    averageLng,
  };
}

export function groupStationsIntoClusters({
  stationQuotes,
  mapRegion,
  screenWidth,
  screenHeight,
}) {
  if (!Array.isArray(stationQuotes) || stationQuotes.length === 0) {
    return [];
  }

  const quotes = [...stationQuotes].sort((left, right) => left.price - right.price);
  const rectById = new Map();
  const fullyInsideById = new Map();
  const parentByIndex = quotes.map((_, index) => index);
  const rankByIndex = quotes.map(() => 0);

  quotes.forEach(quote => {
    const id = String(quote.stationId);
    const rect = buildQuoteRect(quote, mapRegion, screenWidth, screenHeight);
    rectById.set(id, rect);
    fullyInsideById.set(id, isFullyInsideMap(rect, screenWidth, screenHeight));
  });

  for (let i = 0; i < quotes.length; i += 1) {
    for (let j = i + 1; j < quotes.length; j += 1) {
      const leftQuote = quotes[i];
      const rightQuote = quotes[j];
      const leftId = String(leftQuote.stationId);
      const rightId = String(rightQuote.stationId);
      const leftRect = rectById.get(leftId);
      const rightRect = rectById.get(rightId);

      if (!leftRect || !rightRect) {
        continue;
      }

      if (!fullyInsideById.get(leftId) || !fullyInsideById.get(rightId)) {
        continue;
      }

      if (doRectsTouch(leftRect, rightRect)) {
        unionRoots(parentByIndex, rankByIndex, i, j);
      }
    }
  }

  const groupsByRoot = new Map();
  quotes.forEach((quote, index) => {
    const rootIndex = findRoot(parentByIndex, index);
    const existingGroup = groupsByRoot.get(rootIndex) || [];
    groupsByRoot.set(rootIndex, [...existingGroup, quote]);
  });

  const clusters = Array.from(groupsByRoot.values()).map(buildCluster);

  return clusters.sort((left, right) => {
    const leftPrice = left.quotes[0]?.price ?? Number.POSITIVE_INFINITY;
    const rightPrice = right.quotes[0]?.price ?? Number.POSITIVE_INFINITY;
    if (leftPrice !== rightPrice) {
      return leftPrice - rightPrice;
    }

    const leftId = String(left.quotes[0]?.stationId || '');
    const rightId = String(right.quotes[0]?.stationId || '');
    return leftId.localeCompare(rightId);
  });
}
