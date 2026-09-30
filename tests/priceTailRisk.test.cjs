const test = require('node:test');
const assert = require('node:assert/strict');
const { distribution, errors, fixedSlice } = require('../scripts/price-model/tailRisk.cjs');

test('p95 interpolates while worst five percent averages the actual tail', () => {
    const result = distribution(Array.from({ length: 100 }, (_, i) => i + 1));
    assert.ok(Math.abs(result.p95 - 95.05) < 1e-10);
    assert.equal(result.worst5Count, 5);
    assert.equal(result.worst5Mean, 98);
    assert.equal(result.max, 100);
    assert.equal(distribution([]).p95, null);
});

test('too-low and too-high errors are separate losses over the same denominator', () => {
    const rows = [{ targetPrice: 5, prices: { model: 4 } }, { targetPrice: 5, prices: { model: 7 } }];
    const result = errors(rows, 'model');
    assert.equal(result.tooLow.max, 100);
    assert.equal(result.tooHigh.max, 200);
    assert.equal(result.tooLow.count, result.tooHigh.count);
    assert.equal(result.underByMoreThan10Cents, 1);
    assert.equal(result.overByMoreThan10Cents, 1);
});

test('fixed worst baseline slice includes cutoff ties and does not follow model successes', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ case: i, station: String(i), targetPrice: 5,
        prices: { baseline: i < 2 ? 4 : 5, replacement: i === 0 ? 5 : i === 1 ? 3 : 5 } }));
    const result = fixedSlice(rows, 'baseline', ['baseline', 'replacement']);
    assert.equal(result.countWithBoundaryTies, 2);
    assert.equal(result.policies.replacement.improved, 1);
    assert.equal(result.policies.replacement.worsened, 1);
    assert.equal(result.policies.replacement.meanAbsoluteErrorCents, 100);
});
