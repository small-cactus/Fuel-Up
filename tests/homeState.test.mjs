import test from 'node:test';
import assert from 'node:assert/strict';

import {
    canRevealActiveStation,
    buildPersistentSuppressedStationIds,
    buildHomeFilterSignature,
    buildHomeQuerySignature,
    buildVisibleSuppressedStationIds,
    filterStationQuotesForHome,
    hasHomeFilterSignatureChanged,
    resolveCommittedHomeActiveIndex,
    resolveHomeCardIndexFromOffset,
    shouldShowActiveStationDecoration,
    shouldInitializeInitialSuppressionDelay,
    shouldDelayStationMarkerSuppression,
    shouldAutoFitHomeMap,
    resolveHomeFuelSnapshotStrategy,
} from '../src/lib/homeState.js';
import { rankQuotesForFuelGrade } from '../src/lib/fuelGrade.js';

test('filterStationQuotesForHome enforces radius filtering and dedupes overlapping station rows', () => {
    const filteredQuotes = filterStationQuotesForHome({
        quotes: [
            {
                stationId: 'nearby-a',
                providerId: 'primary',
                providerTier: 'station',
                fuelType: 'regular',
                price: 3.19,
                distanceMiles: 2.4,
            },
            {
                stationId: 'outside-radius',
                providerId: 'primary',
                providerTier: 'station',
                fuelType: 'regular',
                price: 2.89,
                distanceMiles: 12.2,
            },
            {
                stationId: 'nearby-a',
                providerId: 'primary',
                providerTier: 'station',
                fuelType: 'regular',
                price: 3.09,
                distanceMiles: 2.4,
            },
        ],
        origin: { latitude: 40.7128, longitude: -74.0060 },
        radiusMiles: 5,
        minimumRating: 0,
    });

    assert.equal(filteredQuotes.length, 1);
    assert.equal(filteredQuotes[0].stationId, 'nearby-a');
    assert.equal(filteredQuotes[0].price, 3.09);
});

test('rankQuotesForFuelGrade reorders filtered home rows immediately when fuel grade changes', () => {
    const filteredQuotes = filterStationQuotesForHome({
        quotes: [
            {
                stationId: 'station-a',
                providerId: 'primary',
                providerTier: 'station',
                fuelType: 'regular',
                price: 2.99,
                distanceMiles: 1.1,
                allPrices: {
                    regular: 2.99,
                    premium: 4.19,
                },
            },
            {
                stationId: 'station-b',
                providerId: 'primary',
                providerTier: 'station',
                fuelType: 'regular',
                price: 3.05,
                distanceMiles: 1.4,
                allPrices: {
                    regular: 3.05,
                    premium: 3.79,
                },
            },
        ],
        origin: { latitude: 40.7128, longitude: -74.0060 },
        radiusMiles: 5,
        minimumRating: 0,
    });

    const rankedPremiumQuotes = rankQuotesForFuelGrade(filteredQuotes, 'premium');

    assert.equal(rankedPremiumQuotes[0].stationId, 'station-b');
    assert.equal(rankedPremiumQuotes[0].price, 3.79);
    assert.equal(rankedPremiumQuotes[1].stationId, 'station-a');
});

test('buildVisibleSuppressedStationIds keeps overlap suppression authoritative for non-cluster pills', () => {
    const visibleSuppression = buildVisibleSuppressedStationIds({
        suppressedStationIds: new Set(['station-a', 'station-b']),
    });

    assert.deepEqual(Array.from(visibleSuppression).sort(), ['station-a', 'station-b']);
});

test('shouldShowActiveStationDecoration only decorates non-best visible active stations', () => {
    assert.equal(shouldShowActiveStationDecoration({
        activeQuote: null,
        suppressedStationIds: new Set(),
    }), false);

    assert.equal(shouldShowActiveStationDecoration({
        activeQuote: {
            originalIndex: 0,
            stationId: 'station-a',
        },
        suppressedStationIds: new Set(),
    }), false);

    assert.equal(shouldShowActiveStationDecoration({
        activeQuote: {
            originalIndex: 2,
            stationId: 'station-b',
        },
        suppressedStationIds: new Set(['station-b']),
    }), false);

    assert.equal(shouldShowActiveStationDecoration({
        activeQuote: {
            originalIndex: 2,
            stationId: 'station-b',
        },
        suppressedStationIds: new Set(),
    }), true);
});

test('canRevealActiveStation stays locked while the map is moving and only releases after the current suppression pass clears the active station', () => {
    assert.equal(canRevealActiveStation({
        activeStationId: 'station-a',
        currentSuppressedStationIds: new Set(),
        isMapMoving: true,
        isSuppressionRevealAllowed: true,
    }), false);

    assert.equal(canRevealActiveStation({
        activeStationId: 'station-a',
        currentSuppressedStationIds: new Set(['station-a']),
        isMapMoving: false,
        isSuppressionRevealAllowed: true,
    }), false);

    assert.equal(canRevealActiveStation({
        activeStationId: 'station-a',
        currentSuppressedStationIds: new Set(),
        isMapMoving: false,
        isSuppressionRevealAllowed: true,
    }), true);
});

test('shouldDelayStationMarkerSuppression only keeps the launch delay for the stations captured in the initial suppression snapshot', () => {
    assert.equal(shouldDelayStationMarkerSuppression({
        stationId: 'station-a',
        isSuppressed: true,
        isInitialSuppressionDelayActive: true,
        initialSuppressionStationIds: new Set(['station-a', 'station-b']),
    }), true);

    assert.equal(shouldDelayStationMarkerSuppression({
        stationId: 'station-c',
        isSuppressed: true,
        isInitialSuppressionDelayActive: true,
        initialSuppressionStationIds: new Set(['station-a', 'station-b']),
    }), false);

    assert.equal(shouldDelayStationMarkerSuppression({
        stationId: 'station-a',
        isSuppressed: false,
        isInitialSuppressionDelayActive: true,
        initialSuppressionStationIds: new Set(['station-a']),
    }), false);
});

test('resolveCommittedHomeActiveIndex ignores preview changes and only commits settled or explicit selection changes', () => {
    assert.equal(resolveCommittedHomeActiveIndex({
        currentActiveIndex: 2,
        nextIndex: 4,
        stationCount: 6,
        reason: 'preview',
    }), 2);

    assert.equal(resolveCommittedHomeActiveIndex({
        currentActiveIndex: 2,
        nextIndex: 4,
        stationCount: 6,
        reason: 'settle',
    }), 4);

    assert.equal(resolveCommittedHomeActiveIndex({
        currentActiveIndex: 1,
        nextIndex: 3,
        stationCount: 6,
        reason: 'marker-press',
    }), 3);

    assert.equal(resolveCommittedHomeActiveIndex({
        currentActiveIndex: 5,
        stationCount: 6,
        reason: 'reset',
    }), 0);
});

test('resolveHomeCardIndexFromOffset clamps the settled card index to the available station range', () => {
    assert.equal(resolveHomeCardIndexFromOffset({
        offsetX: 0,
        itemWidth: 320,
        stationCount: 4,
    }), 0);

    assert.equal(resolveHomeCardIndexFromOffset({
        offsetX: 640,
        itemWidth: 320,
        stationCount: 4,
    }), 2);

    assert.equal(resolveHomeCardIndexFromOffset({
        offsetX: 5000,
        itemWidth: 320,
        stationCount: 4,
    }), 3);
});

test('shouldInitializeInitialSuppressionDelay only allows the launch grace period once the initial layout has settled', () => {
    assert.equal(shouldInitializeInitialSuppressionDelay({
        hasInitializedInitialSuppressionDelay: false,
        isMapLoaded: true,
        isMapMoving: false,
        stationCount: 3,
        hasSettledInitialStationLayout: true,
    }), true);

    assert.equal(shouldInitializeInitialSuppressionDelay({
        hasInitializedInitialSuppressionDelay: true,
        isMapLoaded: true,
        isMapMoving: false,
        stationCount: 3,
        hasSettledInitialStationLayout: true,
    }), false);

    assert.equal(shouldInitializeInitialSuppressionDelay({
        hasInitializedInitialSuppressionDelay: false,
        isMapLoaded: true,
        isMapMoving: false,
        stationCount: 3,
        hasSettledInitialStationLayout: false,
    }), false);
});

test('buildPersistentSuppressedStationIds keeps hidden chips hidden by default and only releases the active clear station', () => {
    assert.deepEqual(
        Array.from(buildPersistentSuppressedStationIds({
            currentSuppressedStationIds: new Set(),
            previousPersistentSuppressedStationIds: new Set(['station-a', 'station-b']),
            visibleStationIds: new Set(['station-a', 'station-b', 'station-c']),
            activeStationId: null,
            canRevealActiveStation: false,
        })).sort(),
        ['station-a', 'station-b']
    );

    assert.deepEqual(
        Array.from(buildPersistentSuppressedStationIds({
            currentSuppressedStationIds: new Set(['station-c']),
            previousPersistentSuppressedStationIds: new Set(['station-a', 'station-b']),
            visibleStationIds: new Set(['station-a', 'station-b', 'station-c']),
            activeStationId: 'station-a',
            canRevealActiveStation: true,
        })).sort(),
        ['station-b', 'station-c']
    );

    assert.deepEqual(
        Array.from(buildPersistentSuppressedStationIds({
            currentSuppressedStationIds: new Set(['station-a']),
            previousPersistentSuppressedStationIds: new Set(['station-a', 'station-b']),
            visibleStationIds: new Set(['station-a', 'station-b']),
            activeStationId: 'station-a',
            canRevealActiveStation: true,
        })).sort(),
        ['station-a', 'station-b']
    );
});

test('home auto-fit skips passive focus restoration when there is no pending refit request', () => {
    assert.equal(shouldAutoFitHomeMap({
        isFocused: true,
        isNewData: false,
        pendingRefitRequest: null,
    }), null);
    assert.deepEqual(shouldAutoFitHomeMap({
        isFocused: true,
        isNewData: true,
        pendingRefitRequest: {
            reason: 'location-refresh',
            animated: true,
        },
    }), {
        reason: 'location-refresh',
        animated: true,
        forceAnimation: false,
        runSettlePass: false,
        requiresNewData: true,
    });
});

test('home auto-fit returns a forced animated intent for off-screen filter changes even without new data', () => {
    assert.deepEqual(shouldAutoFitHomeMap({
        isFocused: true,
        isNewData: false,
        pendingRefitRequest: {
            reason: 'filter-change',
            forceAnimation: true,
        },
    }), {
        reason: 'filter-change',
        animated: true,
        forceAnimation: true,
        runSettlePass: true,
        requiresNewData: false,
    });
});

test('home auto-fit keeps initial-load behavior on fresh data only', () => {
    assert.equal(shouldAutoFitHomeMap({
        isFocused: true,
        isNewData: false,
        pendingRefitRequest: {
            reason: 'initial-load',
            animated: false,
        },
    }), null);
    assert.deepEqual(shouldAutoFitHomeMap({
        isFocused: true,
        isNewData: true,
        pendingRefitRequest: {
            reason: 'initial-load',
            animated: false,
        },
    }), {
        reason: 'initial-load',
        animated: false,
        forceAnimation: false,
        runSettlePass: true,
        requiresNewData: true,
    });
});

test('home fuel snapshot strategy only controls cached bootstrap eligibility', () => {
    assert.deepEqual(resolveHomeFuelSnapshotStrategy({
        preferCached: true,
        fuelGrade: 'regular',
        hasVisibleFuelState: false,
        pendingRefitRequest: null,
    }), {
        useCachedSnapshot: true,
    });

    assert.deepEqual(resolveHomeFuelSnapshotStrategy({
        preferCached: true,
        fuelGrade: 'premium',
        hasVisibleFuelState: false,
        pendingRefitRequest: null,
    }), {
        useCachedSnapshot: false,
    });

    assert.deepEqual(resolveHomeFuelSnapshotStrategy({
        preferCached: true,
        fuelGrade: 'regular',
        hasVisibleFuelState: true,
        pendingRefitRequest: {
            reason: 'filter-change',
        },
    }), {
        useCachedSnapshot: false,
    });

    assert.deepEqual(resolveHomeFuelSnapshotStrategy({
        preferCached: true,
        fuelGrade: 'regular',
        hasVisibleFuelState: true,
        pendingRefitRequest: {
            reason: 'location-refresh',
        },
    }), {
        useCachedSnapshot: true,
    });
});

test('buildHomeQuerySignature changes when the selected fuel grade or radius changes', () => {
    const regularSignature = buildHomeQuerySignature({
        origin: { latitude: 40.7128, longitude: -74.0060 },
        radiusMiles: 10,
        fuelGrade: 'regular',
        preferredProvider: 'primary',
    });
    const premiumSignature = buildHomeQuerySignature({
        origin: { latitude: 40.7128, longitude: -74.0060 },
        radiusMiles: 10,
        fuelGrade: 'premium',
        preferredProvider: 'primary',
    });
    const shortRadiusSignature = buildHomeQuerySignature({
        origin: { latitude: 40.7128, longitude: -74.0060 },
        radiusMiles: 5,
        fuelGrade: 'premium',
        preferredProvider: 'primary',
    });

    assert.notEqual(regularSignature, premiumSignature);
    assert.notEqual(premiumSignature, shortRadiusSignature);
});

test('buildHomeFilterSignature changes for every map-affecting filter', () => {
    const baseSignature = buildHomeFilterSignature({
        radiusMiles: 10,
        fuelGrade: 'regular',
        preferredProvider: 'primary',
        minimumRating: 0,
    });
    const ratingSignature = buildHomeFilterSignature({
        radiusMiles: 10,
        fuelGrade: 'regular',
        preferredProvider: 'primary',
        minimumRating: 4,
    });
    const providerSignature = buildHomeFilterSignature({
        radiusMiles: 10,
        fuelGrade: 'regular',
        preferredProvider: 'all',
        minimumRating: 0,
    });

    assert.notEqual(baseSignature, ratingSignature);
    assert.notEqual(baseSignature, providerSignature);
});

test('hasHomeFilterSignatureChanged only flags a real off-screen filter change once a baseline exists', () => {
    const nextFilterSignature = buildHomeFilterSignature({
        radiusMiles: 15,
        fuelGrade: 'premium',
        preferredProvider: 'all',
        minimumRating: 4,
    });

    assert.equal(hasHomeFilterSignatureChanged({
        previousFilterSignature: '',
        nextFilterSignature,
    }), false);
    assert.equal(hasHomeFilterSignatureChanged({
        previousFilterSignature: nextFilterSignature,
        nextFilterSignature,
    }), false);
    assert.equal(hasHomeFilterSignatureChanged({
        previousFilterSignature: buildHomeFilterSignature({
            radiusMiles: 10,
            fuelGrade: 'regular',
            preferredProvider: 'primary',
            minimumRating: 0,
        }),
        nextFilterSignature,
    }), true);
});
