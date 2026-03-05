const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CLUSTER_SPLIT_HANDOFF_CONTENT_EPSILON,
  CLUSTER_SPLIT_HANDOFF_POSITION_EPSILON,
  CLUSTER_SPLIT_HANDOFF_SIZE_EPSILON,
  COLLAPSED_OFFSET,
  buildMergeSequence,
  buildOutsidePriceTargets,
  buildSplitSequence,
  computeParentBoundsForQuotes,
  computeSplitHandoffTolerance,
  groupByTouch,
} = require('../src/lib/clusterAnimationMath.cjs');

const SCREEN_WIDTH = 393;
const SCREEN_HEIGHT = 852;

const baseQuotes = [
  {
    stationId: 'station-1',
    originalIndex: 1,
    price: 3.41,
    latitude: 40.7500,
    longitude: -73.9900,
  },
  {
    stationId: 'station-2',
    originalIndex: 2,
    price: 3.55,
    latitude: 40.7507,
    longitude: -73.9888,
  },
  {
    stationId: 'station-3',
    originalIndex: 3,
    price: 3.67,
    latitude: 40.7491,
    longitude: -73.9876,
  },
];

const mapRegions = [
  {
    latitude: 40.7500,
    longitude: -73.9890,
    latitudeDelta: 0.06,
    longitudeDelta: 0.06,
  },
  {
    latitude: 40.7500,
    longitude: -73.9890,
    latitudeDelta: 0.03,
    longitudeDelta: 0.03,
  },
  {
    latitude: 40.7500,
    longitude: -73.9890,
    latitudeDelta: 0.012,
    longitudeDelta: 0.012,
  },
];

test('parent bounds contain all merge-capable price pill targets', () => {
  mapRegions.forEach(mapRegion => {
    const bounds = computeParentBoundsForQuotes({
      quotes: baseQuotes,
      mapRegion,
      screenWidth: SCREEN_WIDTH,
      screenHeight: SCREEN_HEIGHT,
    });
    const targets = buildOutsidePriceTargets(baseQuotes, mapRegion, SCREEN_WIDTH, SCREEN_HEIGHT);

    assert.ok(bounds.width >= 240);
    assert.ok(bounds.height >= 80);

    targets.forEach(target => {
      assert.ok(Math.abs(target.x) <= bounds.horizontalReach + 1e-9);
      assert.ok(Math.abs(target.y) <= bounds.verticalReach + 1e-9);
    });
  });
});

test('merge duplicates spawn 1:1 from outside target positions', () => {
  const fromCluster = {
    quotes: [baseQuotes[0]],
    averageLat: baseQuotes[0].latitude,
    averageLng: baseQuotes[0].longitude,
  };
  const toCluster = {
    quotes: baseQuotes,
    averageLat: baseQuotes.reduce((sum, quote) => sum + quote.latitude, 0) / baseQuotes.length,
    averageLng: baseQuotes.reduce((sum, quote) => sum + quote.longitude, 0) / baseQuotes.length,
  };

  mapRegions.forEach(mapRegion => {
    const sequence = buildMergeSequence({
      fromCluster,
      toCluster,
      mapRegion,
      screenWidth: SCREEN_WIDTH,
      screenHeight: SCREEN_HEIGHT,
    });
    const outsideTargets = buildOutsidePriceTargets(toCluster.quotes, mapRegion, SCREEN_WIDTH, SCREEN_HEIGHT);
    const outsideById = new Map(outsideTargets.map(target => [String(target.stationId), target]));

    sequence.forEach(step => {
      const target = outsideById.get(String(step.stationId));
      assert.ok(target);
      assert.equal(step.startX, target.x);
      assert.equal(step.startY, target.y);
    });
  });
});

test('merge accumulator increments strictly in serial order', () => {
  const fromCluster = {
    quotes: [baseQuotes[0]],
    averageLat: baseQuotes[0].latitude,
    averageLng: baseQuotes[0].longitude,
  };
  const toCluster = {
    quotes: baseQuotes,
    averageLat: baseQuotes.reduce((sum, quote) => sum + quote.latitude, 0) / baseQuotes.length,
    averageLng: baseQuotes.reduce((sum, quote) => sum + quote.longitude, 0) / baseQuotes.length,
  };

  const sequence = buildMergeSequence({
    fromCluster,
    toCluster,
    mapRegion: mapRegions[1],
    screenWidth: SCREEN_WIDTH,
    screenHeight: SCREEN_HEIGHT,
  });

  assert.equal(sequence.length, 2);
  sequence.forEach((step, index) => {
    assert.equal(step.sequenceIndex, index);
  });

  const increments = sequence.map((_, index) => index + 1);
  assert.deepEqual(increments, [1, 2]);
});

test('split duplicate starts at +n origin and moves toward detached quote targets', () => {
  const fromCluster = {
    quotes: baseQuotes,
    averageLat: baseQuotes.reduce((sum, quote) => sum + quote.latitude, 0) / baseQuotes.length,
    averageLng: baseQuotes.reduce((sum, quote) => sum + quote.longitude, 0) / baseQuotes.length,
  };
  const toCluster = {
    quotes: [baseQuotes[0], baseQuotes[1]],
    averageLat: (baseQuotes[0].latitude + baseQuotes[1].latitude) / 2,
    averageLng: (baseQuotes[0].longitude + baseQuotes[1].longitude) / 2,
  };

  const sequence = buildSplitSequence({
    fromCluster,
    toCluster,
    mapRegion: mapRegions[1],
    screenWidth: SCREEN_WIDTH,
    screenHeight: SCREEN_HEIGHT,
  });

  assert.equal(sequence.length, 1);
  assert.equal(sequence[0].startX, COLLAPSED_OFFSET);
  assert.equal(sequence[0].startY, 0);
  assert.notEqual(sequence[0].endX, COLLAPSED_OFFSET);
});

test('split handoff tolerances stay at strict hard limits', () => {
  const tolerance = computeSplitHandoffTolerance();

  assert.equal(tolerance.positionDeltaPx, CLUSTER_SPLIT_HANDOFF_POSITION_EPSILON);
  assert.equal(tolerance.sizeDeltaPx, CLUSTER_SPLIT_HANDOFF_SIZE_EPSILON);
  assert.equal(tolerance.contentDelta, CLUSTER_SPLIT_HANDOFF_CONTENT_EPSILON);

  assert.ok(tolerance.positionDeltaPx <= 0.5);
  assert.ok(tolerance.sizeDeltaPx <= 0.5);
  assert.ok(tolerance.contentDelta <= 0.01);
});

test('grouping-by-touch remains stable across zoom levels', () => {
  const groupedAcrossZoom = mapRegions.map(mapRegion => (
    groupByTouch({
      stationQuotes: baseQuotes,
      mapRegion,
      screenWidth: SCREEN_WIDTH,
      screenHeight: SCREEN_HEIGHT,
      previousClusters: [],
    })
  ));

  groupedAcrossZoom.forEach(clusters => {
    assert.ok(clusters.length >= 1);
    clusters.forEach(cluster => {
      const prices = cluster.quotes.map(quote => quote.price);
      const sortedPrices = [...prices].sort((left, right) => left - right);
      assert.deepEqual(prices, sortedPrices);
    });
  });
});
