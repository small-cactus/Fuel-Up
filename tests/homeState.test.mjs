import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildHomeQuerySignature,
    buildVisibleSuppressedStationIds,
    filterStationQuotesForHome,
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

test('buildVisibleSuppressedStationIds preserves passive suppression and only reveals the active chip on explicit selection', () => {
    const passiveSuppression = buildVisibleSuppressedStationIds({
        suppressedStationIds: new Set(['station-a', 'station-b']),
        activeStationId: 'station-a',
        allowActiveReveal: false,
    });
    const explicitSelectionSuppression = buildVisibleSuppressedStationIds({
        suppressedStationIds: new Set(['station-a', 'station-b']),
        activeStationId: 'station-a',
        allowActiveReveal: true,
    });

    assert.deepEqual(Array.from(passiveSuppression).sort(), ['station-a', 'station-b']);
    assert.deepEqual(Array.from(explicitSelectionSuppression).sort(), ['station-b']);
});

test('home auto-fit only runs for new data, not for passive focus restoration', () => {
    assert.equal(shouldAutoFitHomeMap({
        isFocused: true,
        isNewData: false,
    }), false);
    assert.equal(shouldAutoFitHomeMap({
        isFocused: true,
        isNewData: true,
    }), true);
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
