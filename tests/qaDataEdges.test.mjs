import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePricesSheetParams } from '../src/lib/pricesSheetParams.js';
import { buildFuelSearchLocationKey, buildResolvedFuelSearchContext } from '../src/lib/fuelSearchState.js';
import { calculateDistanceMiles } from '../src/lib/homeState.js';

for (const quotesData of ['{broken', 'null', '{}', '1', '"text"', '[null, 5, "text"]', undefined]) {
    test(`prices sheet tolerates malformed or missing deep link data: ${quotesData}`, () => {
        assert.deepEqual(parsePricesSheetParams({ quotesData, benchmarkData: 'oops' }), { quotes: [], benchmarkQuote: null, error: null });
    });
}
test('prices sheet retains valid rows and handles repeated route parameters', () => {
    const quote = { stationId: 'a', price: 3.29 };
    assert.deepEqual(parsePricesSheetParams({ quotesData: [JSON.stringify([quote]), 'ignored'] }).quotes, [quote]);
});
for (const value of [null, undefined, '', '  ', false, NaN, Infinity, 91]) {
    test(`missing or invalid location is not turned into a real fuel query: ${value}`, () => {
        const origin = { latitude: value, longitude: -122 };
        assert.equal(buildFuelSearchLocationKey(origin), 'unresolved');
        assert.equal(buildResolvedFuelSearchContext({ origin }), null);
    });
}
test('zero is a valid coordinate but missing coordinates cannot produce a station distance', () => {
    assert.equal(buildFuelSearchLocationKey({ latitude: 0, longitude: 0 }), '0.00:0.00');
    assert.equal(calculateDistanceMiles({ latitude: null, longitude: null }, { latitude: 37, longitude: -122 }), null);
});

import { isTransientLocationUnavailable } from '../src/lib/locationErrors.js';
test('temporary no-fix GPS errors remain recoverable without hiding real permission/network failures', () => {
    assert.equal(isTransientLocationUnavailable({ code: 0, message: 'Error Domain=kCLErrorDomain Code=0 "(null)"' }), true);
    assert.equal(isTransientLocationUnavailable({ code: 1, message: 'Error Domain=kCLErrorDomain Code=1' }), false);
    assert.equal(isTransientLocationUnavailable({ code: 0, message: 'Database unavailable' }), false);
    assert.equal(isTransientLocationUnavailable(null), false);
});
