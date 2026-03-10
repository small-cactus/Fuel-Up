const test = require('node:test');
const assert = require('node:assert/strict');

const {
    ADJUSTED_PRICE_SAFETY_BUFFER,
    buildValidationState,
    normalizePrice,
    validateAndChoosePrice,
} = require('../src/services/fuel/priceValidation');

const HOUR_MS = 60 * 60 * 1000;

function buildRow({ stationId, price, hoursAgo, lat, lon, fuelType = 'regular', sourceHoursAgo = hoursAgo }) {
    const observedAtMs = Date.UTC(2026, 2, 7, 12, 0, 0) - (hoursAgo * HOUR_MS);
    const sourceUpdatedAtMs = Date.UTC(2026, 2, 7, 12, 0, 0) - (sourceHoursAgo * HOUR_MS);

    return {
        stationId,
        fuelType,
        price,
        observedAtMs,
        sourceUpdatedAtMs,
        timestampMs: observedAtMs,
        lat,
        lon,
    };
}

function buildBaselineHistory() {
    return [
        buildRow({ stationId: 'A', price: 2.61, hoursAgo: 96, lat: 40.0000, lon: -74.0000 }),
        buildRow({ stationId: 'B', price: 2.64, hoursAgo: 96, lat: 40.0100, lon: -74.0000 }),
        buildRow({ stationId: 'C', price: 2.62, hoursAgo: 95, lat: 40.0150, lon: -74.0060 }),
        buildRow({ stationId: 'D', price: 2.66, hoursAgo: 94, lat: 40.0180, lon: -73.9980 }),
        buildRow({ stationId: 'B', price: 3.08, hoursAgo: 2, lat: 40.0100, lon: -74.0000 }),
        buildRow({ stationId: 'C', price: 3.11, hoursAgo: 2, lat: 40.0150, lon: -74.0060 }),
        buildRow({ stationId: 'D', price: 3.09, hoursAgo: 1, lat: 40.0180, lon: -73.9980 }),
    ];
}

function buildExpensiveStationHistory() {
    return [
        buildRow({ stationId: 'A', price: 3.25, hoursAgo: 120, lat: 40.0000, lon: -74.0000 }),
        buildRow({ stationId: 'B', price: 3.00, hoursAgo: 120, lat: 40.0100, lon: -74.0000 }),
        buildRow({ stationId: 'C', price: 3.01, hoursAgo: 120, lat: 40.0150, lon: -74.0060 }),
        buildRow({ stationId: 'D', price: 3.02, hoursAgo: 120, lat: 40.0180, lon: -73.9980 }),
        buildRow({ stationId: 'A', price: 3.35, hoursAgo: 96, lat: 40.0000, lon: -74.0000 }),
        buildRow({ stationId: 'B', price: 3.10, hoursAgo: 96, lat: 40.0100, lon: -74.0000 }),
        buildRow({ stationId: 'C', price: 3.11, hoursAgo: 96, lat: 40.0150, lon: -74.0060 }),
        buildRow({ stationId: 'D', price: 3.12, hoursAgo: 96, lat: 40.0180, lon: -73.9980 }),
        buildRow({ stationId: 'A', price: 3.45, hoursAgo: 72, lat: 40.0000, lon: -74.0000 }),
        buildRow({ stationId: 'B', price: 3.20, hoursAgo: 72, lat: 40.0100, lon: -74.0000 }),
        buildRow({ stationId: 'C', price: 3.21, hoursAgo: 72, lat: 40.0150, lon: -74.0060 }),
        buildRow({ stationId: 'D', price: 3.22, hoursAgo: 72, lat: 40.0180, lon: -73.9980 }),
        buildRow({ stationId: 'A', price: 3.55, hoursAgo: 60, lat: 40.0000, lon: -74.0000 }),
        buildRow({ stationId: 'B', price: 3.30, hoursAgo: 60, lat: 40.0100, lon: -74.0000 }),
        buildRow({ stationId: 'C', price: 3.31, hoursAgo: 60, lat: 40.0150, lon: -74.0060 }),
        buildRow({ stationId: 'D', price: 3.32, hoursAgo: 60, lat: 40.0180, lon: -73.9980 }),
        buildRow({ stationId: 'A', price: 3.65, hoursAgo: 48, lat: 40.0000, lon: -74.0000 }),
        buildRow({ stationId: 'B', price: 3.40, hoursAgo: 48, lat: 40.0100, lon: -74.0000 }),
        buildRow({ stationId: 'C', price: 3.41, hoursAgo: 48, lat: 40.0150, lon: -74.0060 }),
        buildRow({ stationId: 'D', price: 3.42, hoursAgo: 48, lat: 40.0180, lon: -73.9980 }),
        buildRow({ stationId: 'B', price: 3.69, hoursAgo: 2, lat: 40.0100, lon: -74.0000 }),
        buildRow({ stationId: 'C', price: 3.70, hoursAgo: 2, lat: 40.0150, lon: -74.0060 }),
        buildRow({ stationId: 'D', price: 3.71, hoursAgo: 1, lat: 40.0180, lon: -73.9980 }),
    ];
}

test('rejects a stale low replay and replaces it with the predicted price', () => {
    const validationState = buildValidationState(buildBaselineHistory());
    const incomingRow = buildRow({
        stationId: 'A',
        price: 2.61,
        hoursAgo: 0,
        sourceHoursAgo: 96,
        lat: 40.0000,
        lon: -74.0000,
    });
    const result = validateAndChoosePrice(
        incomingRow,
        validationState.trustedRows,
        validationState.rawApiHistory
    );

    assert.equal(result.decision, 'reject');
    assert.equal(result.usedPrediction, true);
    assert.ok((result.predictedPrice || 0) >= 2.90);
    assert.ok((result.finalDisplayedPrice || 0) >= 2.90);
    assert.equal(
        result.finalDisplayedPrice,
        normalizePrice((result.predictedPrice || 0) + ADJUSTED_PRICE_SAFETY_BUFFER)
    );
    assert.equal(result.adjustedPriceSafetyBuffer, ADJUSTED_PRICE_SAFETY_BUFFER);
    assert.ok((result.features?.stale || 0) >= 0.6);
    assert.equal(result.features?.replay, 1);
});

test('accepts an API price that stays close to the station-market prediction', () => {
    const validationState = buildValidationState(buildBaselineHistory());
    const incomingRow = buildRow({
        stationId: 'A',
        price: 3.08,
        hoursAgo: 0,
        lat: 40.0000,
        lon: -74.0000,
    });
    const result = validateAndChoosePrice(
        incomingRow,
        validationState.trustedRows,
        validationState.rawApiHistory
    );

    assert.equal(result.decision, 'accept');
    assert.equal(result.usedPrediction, false);
    assert.equal(result.finalDisplayedPrice, 3.08);
    assert.equal(result.adjustedPriceSafetyBuffer, 0);
});

test('accepts the API price on a cold start instead of forcing a replacement', () => {
    const incomingRow = buildRow({
        stationId: 'cold-start',
        price: 3.19,
        hoursAgo: 0,
        lat: 35.0000,
        lon: -80.0000,
    });
    const result = validateAndChoosePrice(incomingRow, [], []);

    assert.equal(result.usedPrediction, false);
    assert.equal(result.finalDisplayedPrice, 3.19);
    assert.equal(result.adjustedPriceSafetyBuffer, 0);
    assert.equal(result.decision, 'accept');
    assert.equal(result.isColdStart, true);
});

test('trusts a newly updated source timestamp that changed from the last station price', () => {
    const validationState = buildValidationState(buildBaselineHistory());
    const incomingRow = buildRow({
        stationId: 'A',
        price: 3.19,
        hoursAgo: 0,
        sourceHoursAgo: 0,
        lat: 40.0000,
        lon: -74.0000,
    });
    const result = validateAndChoosePrice(
        incomingRow,
        validationState.trustedRows,
        validationState.rawApiHistory
    );

    assert.equal(result.decision, 'accept');
    assert.equal(result.usedPrediction, false);
    assert.equal(result.finalDisplayedPrice, 3.19);
    assert.equal(result.adjustedPriceSafetyBuffer, 0);
});

test('keeps expensive stations above the local market when a stale source is corrected upward', () => {
    const validationState = buildValidationState(buildExpensiveStationHistory());
    const incomingRow = buildRow({
        stationId: 'A',
        price: 3.65,
        hoursAgo: 0,
        sourceHoursAgo: 48,
        lat: 40.0000,
        lon: -74.0000,
    });
    const result = validateAndChoosePrice(
        incomingRow,
        validationState.trustedRows,
        validationState.rawApiHistory
    );

    assert.equal(result.usedPrediction, true);
    assert.ok((result.prediction?.localMarketPrice || 0) >= 3.69);
    assert.ok((result.predictedPrice || 0) > (result.prediction?.localMarketPrice || 0) + 0.10);
    assert.equal(
        result.finalDisplayedPrice,
        normalizePrice((result.predictedPrice || 0) + ADJUSTED_PRICE_SAFETY_BUFFER)
    );
});
