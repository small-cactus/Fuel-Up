import {
  CLUSTER_GROUP_HYSTERESIS_MULTIPLIER,
  CLUSTER_GROUP_TOUCH_PADDING,
  CLUSTER_PRIMARY_PILL_WIDTH,
  CLUSTER_PILL_HEIGHT,
} from './constants';

function buildQuoteRect(quote, mapRegion, screenWidth, screenHeight, padding = 0) {
  const safeScreenWidth = Number.isFinite(screenWidth) ? screenWidth : 0;
  const safeScreenHeight = Number.isFinite(screenHeight) ? screenHeight : 0;
  const ptPerLng = mapRegion?.longitudeDelta ? safeScreenWidth / mapRegion.longitudeDelta : 0;
  const ptPerLat = mapRegion?.latitudeDelta ? safeScreenHeight / mapRegion.latitudeDelta : 0;
  const centerLng = mapRegion?.longitude || 0;
  const centerLat = mapRegion?.latitude || 0;
  const width = CLUSTER_PRIMARY_PILL_WIDTH + padding * 2;
  const height = CLUSTER_PILL_HEIGHT + padding * 2;
  const x = (quote.longitude - centerLng) * ptPerLng;
  const y = -(quote.latitude - centerLat) * ptPerLat;

  return {
    stationId: quote.stationId,
    x,
    y,
    left: x - width / 2,
    right: x + width / 2,
    top: y - height / 2,
    bottom: y + height / 2,
    width,
    height,
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

function buildPreviousPairs(previousClusters) {
  const pairs = new Set();

  (previousClusters || []).forEach(cluster => {
    const ids = (cluster?.quotes || []).map(quote => String(quote.stationId));
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const pairKey = ids[i] < ids[j] ? `${ids[i]}|${ids[j]}` : `${ids[j]}|${ids[i]}`;
        pairs.add(pairKey);
      }
    }
  });

  return pairs;
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

export function groupStationsIntoClusters({
  stationQuotes,
  mapRegion,
  screenWidth,
  screenHeight,
  previousClusters,
}) {
  if (!Array.isArray(stationQuotes) || stationQuotes.length === 0) {
    return [];
  }

  const previousPairs = buildPreviousPairs(previousClusters);
  const quotes = [...stationQuotes].sort((left, right) => left.price - right.price);
  const parentByIndex = quotes.map((_, index) => index);
  const rankByIndex = quotes.map(() => 0);

  for (let i = 0; i < quotes.length; i += 1) {
    for (let j = i + 1; j < quotes.length; j += 1) {
      const leftQuote = quotes[i];
      const rightQuote = quotes[j];
      const leftId = String(leftQuote.stationId);
      const rightId = String(rightQuote.stationId);
      const pairKey = leftId < rightId ? `${leftId}|${rightId}` : `${rightId}|${leftId}`;
      const wasPairedBefore = previousPairs.has(pairKey);
      const padding = CLUSTER_GROUP_TOUCH_PADDING * (wasPairedBefore ? CLUSTER_GROUP_HYSTERESIS_MULTIPLIER : 1);
      const leftRect = buildQuoteRect(leftQuote, mapRegion, screenWidth, screenHeight, padding);
      const rightRect = buildQuoteRect(rightQuote, mapRegion, screenWidth, screenHeight, padding);

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

  return Array.from(groupsByRoot.values())
    .map(groupQuotes => {
      const sortedQuotes = [...groupQuotes].sort((left, right) => left.price - right.price);
      const averageLat = sortedQuotes.reduce((sum, quote) => sum + quote.latitude, 0) / sortedQuotes.length;
      const averageLng = sortedQuotes.reduce((sum, quote) => sum + quote.longitude, 0) / sortedQuotes.length;

      return {
        quotes: sortedQuotes,
        averageLat,
        averageLng,
      };
    })
    .sort((left, right) => {
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
