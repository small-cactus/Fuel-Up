// Research-only causal baseline. A timestamp refresh is not corroboration.
const HOUR = 3600000;
const median = values => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2 : null;
};
const close = (a, b) => Math.abs(a - b) < .005;
const valid = row => Number.isFinite(row.price) && row.price > 0 && Number.isFinite(row.observedAtMs);

export function estimateMarketLag({ candidate, peers, history, nowMs, shrinkage = .75 }) {
    if (!valid(candidate) || !Number.isFinite(nowMs) || shrinkage < 0 || shrinkage > 1) throw new Error('Invalid estimator input');
    const sameProduct = row => row.fuel === candidate.fuel && row.payment === candidate.payment;
    const past = history.filter(row => valid(row) && sameProduct(row) && row.observedAtMs < nowMs && row.observedAtMs >= nowMs - 48 * HOUR)
        .sort((a, b) => a.observedAtMs - b.observedAtMs);
    const own = past.filter(row => row.stationId === candidate.stationId);
    let unchangedSince = nowMs;
    for (let i = own.length - 1; i >= 0; i--) {
        if (!close(own[i].price, candidate.price)) break;
        unchangedSince = own[i].observedAtMs;
    }
    const base = { version: 'market-lag-v1', rawPrice: candidate.price, estimatedPrice: candidate.price,
        isEstimated: false, correction: 0, evidenceStrength: 0, unchangedObservedHours: (nowMs - unchangedSince) / HOUR,
        peerCount: 0, movingPeerCount: 0, brandCount: 0, marketMovement: 0,
        // This is an uncalibrated scenario envelope, never a confidence interval.
        scenarioLow: candidate.price, scenarioHigh: candidate.price };
    const anchor = own.find(row => row.observedAtMs <= nowMs - 6 * HOUR);
    if (!anchor) return { ...base, reason: 'insufficient_history' };
    const latestAtAnchor = new Map();
    for (const row of past) {
        if (row.observedAtMs <= anchor.observedAtMs && row.observedAtMs >= anchor.observedAtMs - 6 * HOUR) latestAtAnchor.set(row.stationId, row);
    }
    const currentPeers = new Map();
    for (const peer of peers) {
        if (peer.stationId === candidate.stationId || !valid(peer) || !sameProduct(peer) || peer.observedAtMs > nowMs || peer.observedAtMs < nowMs - 2 * HOUR) continue;
        const existing = currentPeers.get(peer.stationId);
        if (!existing || peer.observedAtMs > existing.observedAtMs) currentPeers.set(peer.stationId, peer);
    }
    const changes = [];
    for (const peer of currentPeers.values()) {
        const prior = latestAtAnchor.get(peer.stationId);
        if (!prior) continue;
        changes.push({ delta: peer.price - prior.price,
            brand: String(peer.brand || prior.brand || 'unknown').trim().toLowerCase() });
    }
    const byBrand = new Map();
    for (const change of changes) {
        if (!byBrand.has(change.brand)) byBrand.set(change.brand, []);
        byBrand.get(change.brand).push(change.delta);
    }
    const brandMoves = [...byBrand.values()].map(median);
    const moving = changes.filter(row => row.delta >= .04 - 1e-8);
    const evidence = { ...base, peerCount: changes.length, movingPeerCount: moving.length, brandCount: byBrand.size,
        anchorObservedAtMs: anchor.observedAtMs, anchorPrice: anchor.price };
    if (changes.length < 5 || byBrand.size < 3) return { ...evidence, reason: 'insufficient_independent_peers' };
    const movement = median(brandMoves);
    const dispersion = median(brandMoves.map(delta => Math.abs(delta - movement)));
    const agreement = moving.length / changes.length;
    const context = { ...evidence, marketMovement: movement, marketDispersion: dispersion, directionAgreement: agreement };
    if (moving.length < 4 || agreement < .6 || movement < .06 || dispersion > Math.max(.08, movement * .5)) {
        return { ...context, reason: 'no_coherent_upward_market_move' };
    }
    // Preserve the station's own historical discount rather than forcing it to
    // the local price median. A current high price is never lowered here.
    const expectedPrice = anchor.price + movement;
    const unexplainedLag = expectedPrice - candidate.price;
    if (unexplainedLag <= Math.max(.08, 2 * dispersion) + 1e-8) return { ...context, reason: 'quote_tracks_market' };
    const strength = shrinkage * agreement * Math.min(1, (byBrand.size - 2) / 3) * Math.min(1, changes.length / 8);
    const correction = Math.max(0, unexplainedLag * strength);
    return { ...context, reason: 'unexplained_market_lag', isEstimated: correction > 0,
        expectedPrice, correction, estimatedPrice: candidate.price + correction, evidenceStrength: strength,
        scenarioHigh: Math.max(candidate.price, expectedPrice + 2 * dispersion) };
}
