import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateMarketLag } from '../scripts/price-model/marketLag.mjs';
const HOUR = 3600000;
const nowMs = 100 * HOUR;
const quote = (stationId, price, hour, brand = stationId) => ({ stationId, brand, fuel: 'premium', payment: 'credit', price,
    observedAtMs: hour * HOUR, sourceAtMs: hour * HOUR });
function scenario() {
    return { candidate: quote('target', 4, 100), nowMs,
        history: [quote('target', 4, 76), ...Array.from({ length: 8 }, (_, i) => quote(`p${i}`, 4.3 + i * .01, 76))],
        peers: Array.from({ length: 8 }, (_, i) => quote(`p${i}`, 4.8 + i * .01, 100)) };
}

test('replayed source timestamp cannot reset a market-lag signal or prove freshness', () => {
    const input = scenario();
    const before = estimateMarketLag(input);
    input.candidate.sourceAtMs = nowMs;
    input.history.push({ ...input.candidate, observedAtMs: nowMs - HOUR, sourceAtMs: nowMs - HOUR });
    const after = estimateMarketLag(input);
    assert.ok(Math.abs(before.estimatedPrice - 4.375) < 1e-8);
    assert.equal(after.estimatedPrice, before.estimatedPrice);
    assert.equal(after.unchangedObservedHours, 24);
});

test('station discount survives correction and high legitimate prices are never lowered', () => {
    const input = scenario();
    assert.ok(estimateMarketLag(input).estimatedPrice < 4.8);
    input.candidate.price = 5.1;
    assert.equal(estimateMarketLag(input).estimatedPrice, 5.1);
});

test('flat markets, sparse evidence, future rows, and different products cannot cause correction', () => {
    const input = scenario();
    input.peers = input.peers.map(row => ({ ...row, price: row.price - .5 }));
    assert.equal(estimateMarketLag(input).isEstimated, false);
    const sparse = scenario(); sparse.peers = sparse.peers.slice(0, 4);
    assert.equal(estimateMarketLag(sparse).isEstimated, false);
    const future = scenario(); future.history = future.history.map(row => ({ ...row, observedAtMs: nowMs + HOUR }));
    assert.equal(estimateMarketLag(future).isEstimated, false);
    const otherGrade = scenario(); otherGrade.peers = otherGrade.peers.map(row => ({ ...row, fuel: 'regular' }));
    assert.equal(estimateMarketLag(otherGrade).isEstimated, false);
});

test('duplicates and one-chain movement cannot manufacture independent corroboration', () => {
    const input = scenario(); input.peers = Array.from({ length: 20 }, () => input.peers[0]);
    assert.equal(estimateMarketLag(input).isEstimated, false);
    const chain = scenario(); chain.peers = chain.peers.map(row => ({ ...row, brand: 'same chain' }));
    assert.equal(estimateMarketLag(chain).isEstimated, false);
});

test('station that already moved with the market receives no additional uplift', () => {
    const input = scenario(); input.candidate.price = 4.5;
    assert.equal(estimateMarketLag(input).estimatedPrice, 4.5);
});
