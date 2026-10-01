const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRawTrendRows } = require('../src/services/fuel/rawTrendRows');
const now = Date.now();
const row = { station_id: 'one', provider_id: 'gasbuddy', fuel_type: 'regular',
    price: 99, all_prices: { regular: 99, _payment: { regular: { credit: 3.79, cash: 3.69 } } },
    created_at: new Date(now).toISOString(), updated_at_source: new Date(now - 3600000).toISOString() };

test('historical trends recover the exact raw payment price, never an adjusted display value', () => {
    assert.equal(buildRawTrendRows([row], 'regular')[0].price, 3.79);
    assert.equal(row.price, 99, 'raw storage must not be rewritten');
});
test('unverifiable, stale-at-observation, future, or wrong-grade history is omitted, never filled', () => {
    const invalid = [
        { ...row, all_prices: { regular: 99 } },
        { ...row, updated_at_source: null },
        { ...row, updated_at_source: new Date(now - 86400001).toISOString() },
        { ...row, updated_at_source: new Date(now + 1).toISOString() },
        { ...row, fuel_type: 'premium' },
        { ...row, provider_id: 'estimate' },
    ];
    assert.deepEqual(buildRawTrendRows(invalid, 'regular'), []);
});
test('historical cash fallback preserves the actual cash value', () => {
    assert.equal(buildRawTrendRows([{ ...row, all_prices: { _payment: { regular: { cash: 3.69 } } } }], 'regular')[0].price, 3.69);
});
