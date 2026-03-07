import test from 'node:test';
import assert from 'node:assert/strict';

import { applyFuelGradeToQuote, rankQuotesForFuelGrade } from '../src/lib/fuelGrade.js';

test('applyFuelGradeToQuote exposes grade-specific corrected price and validation metadata', () => {
    const quote = {
        stationId: 'station-1',
        fuelType: 'regular',
        price: 3.05,
        allPrices: {
            regular: 3.05,
            midgrade: 3.45,
            premium: 3.79,
        },
        validation: {
            fuelType: 'regular',
            finalPrice: 3.05,
            usedPrediction: false,
        },
        validationByFuelType: {
            regular: {
                fuelType: 'regular',
                finalPrice: 3.05,
                usedPrediction: false,
            },
            premium: {
                fuelType: 'premium',
                finalPrice: 3.79,
                predictedPrice: 3.79,
                apiPrice: 3.49,
                usedPrediction: true,
                decision: 'reject',
            },
        },
    };

    const premiumQuote = applyFuelGradeToQuote(quote, 'premium');

    assert.equal(premiumQuote.price, 3.79);
    assert.equal(premiumQuote.validation?.fuelType, 'premium');
    assert.equal(premiumQuote.validation?.usedPrediction, true);
});

test('rankQuotesForFuelGrade sorts leaderboard rows by the corrected selected-grade price', () => {
    const ranked = rankQuotesForFuelGrade([
        {
            stationId: 'A',
            fuelType: 'regular',
            price: 2.99,
            allPrices: { premium: 3.89 },
            distanceMiles: 1.2,
        },
        {
            stationId: 'B',
            fuelType: 'regular',
            price: 2.95,
            allPrices: { premium: 3.59 },
            distanceMiles: 2.4,
        },
    ], 'premium');

    assert.equal(ranked[0].stationId, 'B');
    assert.equal(ranked[0].price, 3.59);
    assert.equal(ranked[1].stationId, 'A');
    assert.equal(ranked[1].price, 3.89);
});
