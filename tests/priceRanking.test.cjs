const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateChoice } = require('../scripts/price-model/scoreRanking.cjs');
const { pairedChoices } = require('../scripts/price-model/scoreOpenai.cjs');
const sample = (station, rawPrice, targetPrice, hour = 10) => ({ station, rawPrice, targetPrice,
    targetSourceAt: targetPrice === null ? null : `2026-09-29T${hour}:00:00Z` });

test('unknown cheapest remains selected and cannot be counted as correct', () => {
    const result = evaluateChoice([sample('a', 4, null), sample('b', 5, 5)], row => row.rawPrice);
    assert.equal(result.station, 'a');
    assert.equal(result.status, 'unknown_winner');
    assert.equal(result.regretLowerBoundCents, null);
});

test('one low quote can cause large recommendation regret despite small overall MAE', () => {
    const candidates = [sample('a', 4.8, 5.3), sample('b', 5, 5),
        ...Array.from({ length: 98 }, (_, index) => sample(`other${index}`, 5.4, 5.4))];
    const mae = candidates.reduce((sum, row) => sum + Math.abs(row.rawPrice - row.targetPrice), 0) / candidates.length;
    assert.equal(mae, .005);
    const result = evaluateChoice(candidates, row => row.rawPrice);
    assert.ok(Math.abs(result.regretLowerBoundCents - 30) < 1e-6);
    assert.equal(result.falseCheapWinnerProxy, true);
});

test('missing alternatives and mismatched future times stay unknown', () => {
    assert.equal(evaluateChoice([sample('a', 4, 4), sample('b', 5, null)], row => row.rawPrice).status, 'unknown_alternatives');
    const rows = [sample('a', 4, 5), sample('b', 4.5, 4.5, 14)];
    assert.equal(evaluateChoice(rows, row => row.rawPrice, 2).status, 'unknown_alternatives');
    assert.equal(evaluateChoice(rows, row => row.rawPrice).regretLowerBoundCents, 50);
});

test('future targets do not enter scoring or break ties', () => {
    const rows = [sample('z', 4, 3), sample('a', 4, 6)];
    const score = row => { assert.equal('targetPrice' in row, false); return row.rawPrice; };
    assert.equal(evaluateChoice(rows, score).station, 'a');
    rows.reverse();
    rows[0].targetPrice = null;
    assert.equal(evaluateChoice(rows, score).station, 'a');
});

test('explicit model recommendation is scored separately from lowest predicted price', () => {
    const rows = [sample('a', 4, 5), sample('b', 4.5, 4.5)];
    assert.equal(evaluateChoice(rows, row => row.rawPrice, Infinity, 'b').station, 'b');
    assert.equal(evaluateChoice(rows, row => row.rawPrice).station, 'a');
    assert.throws(() => evaluateChoice(rows, row => row.rawPrice, Infinity, 'missing'));
});

test('paired policy comparison excludes unknown or temporally unmatched chosen prices', () => {
    const left = [sample('a', 4, 5), sample('b', 4, null), sample('c', 4, 4, 15)];
    const right = [sample('d', 4, 4.5), sample('e', 4, 4.5), sample('f', 4, 4.5)];
    assert.deepEqual(pairedChoices(left, right, 2), {
        pairs: 1, cheaper: 0, tied: 0, moreExpensive: 1, meanExtraCentsPerGallon: 50 });
});
