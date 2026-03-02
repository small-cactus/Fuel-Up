const test = require('node:test');
const assert = require('node:assert/strict');

const {
    CLUSTER_MERGE_LNG_FACTOR,
    CLUSTER_SPLIT_MULTIPLIER,
    computeClusterTransitionSnapshot,
    computeMorphProgress,
    computeSpreadProgressFromCluster,
} = require('../src/lib/clusterAnimationMath.cjs');

const SCREEN_WIDTH = 393;
const SCREEN_HEIGHT = 852;
const EPSILON = 1e-9;

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

const averageLat = baseQuotes.reduce((sum, quote) => sum + quote.latitude, 0) / baseQuotes.length;
const averageLng = baseQuotes.reduce((sum, quote) => sum + quote.longitude, 0) / baseQuotes.length;

const mapRegions = [
    {
        latitude: averageLat,
        longitude: averageLng,
        latitudeDelta: 0.06,
        longitudeDelta: 0.06,
    },
    {
        latitude: averageLat,
        longitude: averageLng,
        latitudeDelta: 0.03,
        longitudeDelta: 0.03,
    },
    {
        latitude: averageLat,
        longitude: averageLng,
        latitudeDelta: 0.012,
        longitudeDelta: 0.012,
    },
];

function assertAlmostEqual(actual, expected, message) {
    assert.ok(Math.abs(actual - expected) <= EPSILON, `${message}: expected ${expected}, received ${actual}`);
}

function assertBetween(value, edgeA, edgeB, message) {
    const min = Math.min(edgeA, edgeB) - EPSILON;
    const max = Math.max(edgeA, edgeB) + EPSILON;
    assert.ok(value >= min && value <= max, `${message}: ${value} not between ${edgeA} and ${edgeB}`);
}

test('cluster transition hits the exact incoming frame at the switch boundary across zoom levels', () => {
    for (const mapRegion of mapRegions) {
        const morphProgress = computeMorphProgress(1);
        const snapshot = computeClusterTransitionSnapshot({
            quotes: baseQuotes,
            averageLat,
            averageLng,
            mapRegion,
            screenWidth: SCREEN_WIDTH,
            screenHeight: SCREEN_HEIGHT,
            spreadProgress: 1,
            morphProgress,
        });

        assertAlmostEqual(snapshot.outgoingPrimary.x, snapshot.incomingPrimary.x, 'primary x continuity');
        assertAlmostEqual(snapshot.outgoingPrimary.y, snapshot.incomingPrimary.y, 'primary y continuity');
        assertAlmostEqual(snapshot.outgoingRemainder.x, snapshot.incomingSecondary.x, 'remainder x continuity');
        assertAlmostEqual(snapshot.outgoingRemainder.y, snapshot.incomingSecondary.y, 'remainder y continuity');
        assert.equal(snapshot.outgoingRemainderPlusCount, snapshot.incomingSecondaryPlusCount);
        assert.equal(snapshot.secondaryShellMinWidth, 72);
        assert.equal(snapshot.escapingPriceOpacity, 1);
        assert.equal(snapshot.nextClusterQuoteCount, 2);
    }
});

test('cluster transition bridge stays inside the current and incoming endpoints while zooming', () => {
    const spreadSamples = [0, 0.2, 0.4, 0.6, 0.8, 1];

    for (const mapRegion of mapRegions) {
        for (const spreadProgress of spreadSamples) {
            const snapshot = computeClusterTransitionSnapshot({
                quotes: baseQuotes,
                averageLat,
                averageLng,
                mapRegion,
                screenWidth: SCREEN_WIDTH,
                screenHeight: SCREEN_HEIGHT,
                spreadProgress,
                morphProgress: computeMorphProgress(spreadProgress),
            });

            assert.ok(Number.isFinite(snapshot.outgoingPrimary.x));
            assert.ok(Number.isFinite(snapshot.outgoingPrimary.y));
            assert.ok(Number.isFinite(snapshot.outgoingRemainder.x));
            assert.ok(Number.isFinite(snapshot.outgoingRemainder.y));
            assertBetween(snapshot.outgoingPrimary.x, snapshot.currentPrimary.x, snapshot.incomingPrimary.x, 'primary x bridge');
            assertBetween(snapshot.outgoingPrimary.y, snapshot.currentPrimary.y, snapshot.incomingPrimary.y, 'primary y bridge');
            assertBetween(snapshot.outgoingRemainder.x, snapshot.currentBreakout.x, snapshot.incomingSecondary.x, 'remainder x bridge');
            assertBetween(snapshot.outgoingRemainder.y, snapshot.currentBreakout.y, snapshot.incomingSecondary.y, 'remainder y bridge');
            assert.ok(snapshot.secondaryShellMinWidth >= 40 && snapshot.secondaryShellMinWidth <= 72);
        }
    }
});

test('spread normalization reaches 1.0 at the split threshold regardless of zoom level', () => {
    for (const mapRegion of mapRegions) {
        const splitLngThreshold = mapRegion.longitudeDelta * CLUSTER_MERGE_LNG_FACTOR * CLUSTER_SPLIT_MULTIPLIER;
        const boundaryQuotes = [
            {
                stationId: 'station-1',
                originalIndex: 1,
                price: 3.41,
                latitude: averageLat,
                longitude: averageLng,
            },
            {
                stationId: 'station-2',
                originalIndex: 2,
                price: 3.55,
                latitude: averageLat,
                longitude: averageLng + splitLngThreshold,
            },
            {
                stationId: 'station-3',
                originalIndex: 3,
                price: 3.67,
                latitude: averageLat,
                longitude: averageLng - splitLngThreshold,
            },
        ];

        const spreadProgress = computeSpreadProgressFromCluster({
            quotes: boundaryQuotes,
            averageLat,
            averageLng,
            mapRegion,
        });

        assertAlmostEqual(spreadProgress, 1, 'spread at split boundary');
    }
});
