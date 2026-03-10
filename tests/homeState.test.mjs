import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildHomeFilterSignature,
    buildHomeQuerySignature,
    buildVisibleSuppressedStationIds,
    filterStationQuotesForHome,
    hasHomeFilterSignatureChanged,
    shouldInitializeInitialSuppressionDelay,
    shouldShowActiveStationDecoration,
    shouldAutoFitHomeMap,
} from '../src/lib/homeState.js';
import { rankQuotesForFuelGrade } from '../src/lib/fuelGrade.js';

test('filterStationQuotesForHome enforces radius filtering and dedupes overlapping station rows', () => {
    const filteredQuotes = filterStationQuotesForHome({
        quotes: [
            {
                stationId: 'nearby-a',
                providerId: 'gasbuddy',
                providerTier: 'station',
                fuelType: 'regular',
                price: 3.19,
                distanceMiles: 2.4,
            },
            {
                stationId: 'outside-radius',
                providerId: 'gasbuddy',
                providerTier: 'station',
                fuelType: 'regular',
                price: 2.89,
                distanceMiles: 12.2,
            },
            {
                stationId: 'nearby-a',
                providerId: 'gasbuddy',
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
                providerId: 'gasbuddy',
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
                providerId: 'gasbuddy',
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

test('shouldShowActiveStationDecoration only decorates visible non-best stations', () => {
    assert.equal(shouldShowActiveStationDecoration({
        activeQuote: {
            stationId: 'best-station',
            originalIndex: 0,
        },
        suppressedStationIds: new Set(),
    }), false);

    assert.equal(shouldShowActiveStationDecoration({
        activeQuote: {
            stationId: 'hidden-station',
            originalIndex: 2,
        },
        suppressedStationIds: new Set(['hidden-station']),
    }), false);

    assert.equal(shouldShowActiveStationDecoration({
        activeQuote: {
            stationId: 'visible-station',
            originalIndex: 2,
        },
        suppressedStationIds: new Set(['other-station']),
    }), true);
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
        runSettlePass: false,
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

test('buildHomeQuerySignature changes when the selected fuel grade or radius changes', () => {
    const regularSignature = buildHomeQuerySignature({
        origin: { latitude: 40.7128, longitude: -74.0060 },
        radiusMiles: 10,
        fuelGrade: 'regular',
        preferredProvider: 'gasbuddy',
    });
    const premiumSignature = buildHomeQuerySignature({
        origin: { latitude: 40.7128, longitude: -74.0060 },
        radiusMiles: 10,
        fuelGrade: 'premium',
        preferredProvider: 'gasbuddy',
    });
    const shortRadiusSignature = buildHomeQuerySignature({
        origin: { latitude: 40.7128, longitude: -74.0060 },
        radiusMiles: 5,
        fuelGrade: 'premium',
        preferredProvider: 'gasbuddy',
    });

    assert.notEqual(regularSignature, premiumSignature);
    assert.notEqual(premiumSignature, shortRadiusSignature);
});

test('buildHomeFilterSignature changes for every map-affecting filter', () => {
    const baseSignature = buildHomeFilterSignature({
        radiusMiles: 10,
        fuelGrade: 'regular',
        preferredProvider: 'gasbuddy',
        minimumRating: 0,
    });
    const ratingSignature = buildHomeFilterSignature({
        radiusMiles: 10,
        fuelGrade: 'regular',
        preferredProvider: 'gasbuddy',
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
            preferredProvider: 'gasbuddy',
            minimumRating: 0,
        }),
        nextFilterSignature,
    }), true);
});
