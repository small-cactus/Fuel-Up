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

test('applyFuelGradeToQuote prefers the validated final price over stale allPrices data', () => {
    const quote = {
        stationId: 'station-2',
        fuelType: 'premium',
        price: 4.41,
        allPrices: {
            regular: 3.04,
            premium: 4.41,
        },
        validationByFuelType: {
            regular: {
                fuelType: 'regular',
                finalPrice: 3.40,
                usedPrediction: true,
            },
        },
    };

    const regularQuote = applyFuelGradeToQuote(quote, 'regular');

    assert.equal(regularQuote.price, 3.40);
    assert.equal(regularQuote.validation?.finalPrice, 3.40);
});

test('applyFuelGradeToQuote rejects unavailable grades on regular-only quotes', () => {
    const quote = {
        stationId: 'station-3',
        fuelType: 'regular',
        price: 3.09,
        allPrices: {
            regular: 3.09,
        },
        availableFuelGrades: ['regular'],
        hasUniformGradePriceIssue: true,
    };

    assert.equal(applyFuelGradeToQuote(quote, 'premium'), null);

    const regularQuote = applyFuelGradeToQuote(quote, 'regular');
    assert.equal(regularQuote?.price, 3.09);
});

test('applyFuelGradeToQuote exposes diesel validation metadata and corrected price', () => {
    const quote = {
        stationId: 'station-4',
        fuelType: 'diesel',
        price: 3.89,
        allPrices: {
            diesel: 3.89,
        },
        validationByFuelType: {
            diesel: {
                fuelType: 'diesel',
                finalPrice: 4.09,
                predictedPrice: 4.09,
                apiPrice: 3.89,
                usedPrediction: true,
                decision: 'reject',
            },
        },
    };

    const dieselQuote = applyFuelGradeToQuote(quote, 'diesel');

    assert.equal(dieselQuote?.price, 4.09);
    assert.equal(dieselQuote?.validation?.fuelType, 'diesel');
    assert.equal(dieselQuote?.validation?.usedPrediction, true);
});
