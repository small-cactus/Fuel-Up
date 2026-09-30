const fs = require('node:fs');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const assert = require('node:assert/strict');
const { buildValidationState, validateAndChoosePrice, haversineMiles } = require('../../src/services/fuel/priceValidation');
const { buildValidationRowFromStoredRow } = require('../../src/services/fuel/stationData');

const HOUR = 3600000;
const TRAIN_END = Date.parse('2026-04-15T00:00:00Z');
const VALIDATION_END = Date.parse('2026-09-01T00:00:00Z');
const inputBytes = fs.readFileSync(process.argv[2]);
const input = process.argv[2].endsWith('.gz') ? zlib.gunzipSync(inputBytes) : inputBytes;
const snapshot = JSON.parse(input);
const rows = snapshot.rows.map(row => ({ ...row, observed: Date.parse(row.created_at) }))
    .sort((a, b) => a.observed - b.observed || String(a.id).localeCompare(String(b.id)));

function rawObservation(row) {
    const payment = row.all_prices?._payment?.[row.fuel_type];
    const method = Number(payment?.credit) > 0 ? 'credit' : 'cash';
    const price = Number(payment?.[method]);
    const source = Date.parse(row.updated_at_source);
    if (!(price > 0) || !Number.isFinite(source) || source > row.observed + 5 * 60000) return null;
    return { row, price, method, source, observed: row.observed,
        station: String(row.station_id), fuel: row.fuel_type,
        key: `${row.station_id}:${row.fuel_type}:${method}` };
}

const observations = rows.map(rawObservation).filter(Boolean);
const events = new Map();
const conflicts = new Set();
for (const observation of observations) {
    const key = `${observation.key}:${observation.source}`;
    const existing = events.get(key);
    if (existing && existing.price !== observation.price) conflicts.add(key);
    if (!existing) events.set(key, observation);
}
const groups = new Map();
for (const [key, event] of events) {
    if (conflicts.has(key)) continue;
    if (!groups.has(event.key)) groups.set(event.key, []);
    groups.get(event.key).push(event);
}

const featureNames = ['price', 'source_age_hours', 'peer_gap', 'peer_spread', 'peer_count',
    'peer_age_hours', 'fresher_peer_fraction', 'previous_station_gap', 'previous_station_age_hours',
    'math_display_gap', 'math_prediction_gap', 'risk', 'validity', 'math_adjusted',
    'low', 'stale', 'plateau', 'jump', 'replay',
    'regular', 'midgrade', 'premium', 'diesel', 'e85', 'membership_brand', 'cash', 'hour_sin', 'hour_cos'];
const median = values => {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length ? (sorted[middle] + sorted[Math.floor((sorted.length - 1) / 2)]) / 2 : null;
};
const samples = [];
let purged = 0;
for (const sequence of groups.values()) {
    sequence.sort((a, b) => a.observed - b.observed);
    for (let index = 0; index < sequence.length; index++) {
        const event = sequence[index];
        const target = sequence.slice(index + 1).find(next => next.observed > event.observed && next.source > event.source + 5 * 60000);
        if (!target || target.observed - event.observed > 48 * HOUR) continue;
        const split = event.observed < TRAIN_END ? 'train' : event.observed < VALIDATION_END ? 'validation' : 'test';
        const splitEnd = split === 'train' ? TRAIN_END : split === 'validation' ? VALIDATION_END : Infinity;
        if (target.observed >= splitEnd) { purged++; continue; }
        const current = event.row;
        const history = rows.filter(row => row.observed < event.observed && row.observed >= event.observed - 14 * 24 * HOUR &&
            row.provider_id === 'gasbuddy' && row.fuel_type === event.fuel &&
            row.search_latitude_rounded === current.search_latitude_rounded && row.search_longitude_rounded === current.search_longitude_rounded)
            .slice(-1500);
        const origin = { latitude: current.latitude, longitude: current.longitude };
        const state = buildValidationState(history.flatMap(row => buildValidationRowFromStoredRow({ row, origin })));
        const query = { stationId: event.station, fuelType: event.fuel, price: event.price,
            observedAtMs: event.observed, sourceUpdatedAtMs: event.source,
            lat: current.latitude, lon: current.longitude };
        const result = validateAndChoosePrice(query, state.context);
        const latest = new Map();
        for (const row of history) {
            const observation = rawObservation(row);
            if (!observation || observation.method !== event.method) continue;
            const prior = latest.get(observation.station);
            if (!prior || observation.source > prior.source) latest.set(observation.station, observation);
        }
        const peers = [...latest.values()].filter(peer => peer.station !== event.station &&
            event.observed - peer.source <= 72 * HOUR && peer.source <= event.observed &&
            haversineMiles(current.latitude, current.longitude, peer.row.latitude, peer.row.longitude) <= 8);
        const peerMedian = median(peers.map(peer => peer.price)) ?? event.price;
        const previous = latest.get(event.station);
        const stateCode = (current.address || '').match(/, ([A-Z]{2})(?:,| )/)?.[1];
        const timezone = ({ CA: 'America/Los_Angeles', FL: 'America/New_York',
            CO: 'America/Denver' })[stateCode] || 'UTC';
        const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', hourCycle: 'h23' }).format(event.observed));
        const prediction = result.predictedPrice ?? event.price;
        const values = [event.price, (event.observed - event.source) / HOUR,
            peerMedian - event.price, median(peers.map(peer => Math.abs(peer.price - peerMedian))) ?? 0,
            peers.length, median(peers.map(peer => (event.observed - peer.source) / HOUR)) ?? 72,
            peers.length ? peers.filter(peer => peer.source > event.source + 5 * 60000).length / peers.length : 0,
            previous ? event.price - previous.price : 0, previous ? (event.observed - previous.source) / HOUR : 336,
            result.finalDisplayedPrice - event.price, prediction - event.price,
            result.risk, result.validity, Number(result.usedPrediction),
            ...['low', 'stale', 'plateau', 'jump', 'replay'].map(key => result.features[key]),
            ...['regular', 'midgrade', 'premium', 'diesel', 'e85'].map(fuel => Number(fuel === event.fuel)),
            Number(/costco|sam.s club|bj.s/i.test(current.station_name || '')), Number(event.method === 'cash'),
            Math.sin(hour * Math.PI / 12), Math.cos(hour * Math.PI / 12)];
        assert.equal(values.length, featureNames.length);
        assert.ok(values.every(Number.isFinite));
        assert.ok(history.every(row => row.observed < event.observed));
        const correction = target.price - event.price;
        samples.push({ id: `${event.key}:${event.source}`, station: event.station, fuel: event.fuel,
            split, observedAt: new Date(event.observed).toISOString(), sourceAt: new Date(event.source).toISOString(),
            targetObservedAt: new Date(target.observed).toISOString(), targetSourceAt: new Date(target.source).toISOString(),
            rawPrice: event.price, targetPrice: target.price, correction,
            materiallyChanged: Math.abs(correction) >= .10 - 1e-8,
            underpriced: correction >= .10 - 1e-8, nextObservationHours: (target.observed - event.observed) / HOUR,
            mathPrice: result.finalDisplayedPrice, mathPrediction: prediction, mathDecision: result.decision,
            mathRisk: result.risk, mathAdjusted: result.usedPrediction, peerMedian,
            historyRows: history.length, featureValues: values });
    }
}
samples.sort((a, b) => a.observedAt.localeCompare(b.observedAt) || a.id.localeCompare(b.id));
const summary = Object.fromEntries(['train', 'validation', 'test'].map(split => {
    const selected = samples.filter(sample => sample.split === split);
    return [split, { count: selected.length, materialChanges: selected.filter(sample => sample.materiallyChanged).length,
        stations: new Set(selected.map(sample => sample.station)).size, first: selected[0]?.observedAt, last: selected.at(-1)?.observedAt }];
}));
const output = { version: 1, inputSha256: crypto.createHash('sha256').update(input).digest('hex'),
    inputRows: rows.length, excludedConflictingEvents: conflicts.size, purged, featureNames, summary, samples };
fs.writeFileSync(process.argv[3], JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
