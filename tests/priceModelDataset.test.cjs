const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const builder = path.resolve(__dirname, '../scripts/price-model/buildDataset.cjs');
function row(id, observed, source, price, station = 'A') {
    return { id, station_id: station, provider_id: 'gasbuddy', fuel_type: 'premium',
        all_prices: { premium: price, _payment: { premium: { credit: price, cash: null } } },
        price, station_name: 'Station', address: 'Test, Clearwater, FL, 33765',
        latitude: 27.98, longitude: -82.75, search_latitude_rounded: 28,
        search_longitude_rounded: -82.8, created_at: observed, updated_at_source: source };
}
function build(rows) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fuel-price-model-'));
    try {
        const input = path.join(directory, 'input.json');
        const output = path.join(directory, 'output.json');
        fs.writeFileSync(input, JSON.stringify({ rows }));
        execFileSync(process.execPath, [builder, input, output]);
        return JSON.parse(fs.readFileSync(output));
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test('future label and future peer prices cannot affect current features or baseline', () => {
    const rows = [row(1, '2026-09-28T10:00Z', '2026-09-28T09:00Z', 5),
        row(2, '2026-09-29T10:00Z', '2026-09-29T09:00Z', 5.2),
        row(3, '2026-09-29T10:01Z', '2026-09-29T09:00Z', 5.3, 'B')];
    const before = build(rows).samples[0];
    rows[1].all_prices._payment.premium.credit = 7;
    rows[2].all_prices._payment.premium.credit = 8;
    const after = build(rows).samples[0];
    assert.deepEqual(before.featureValues, after.featureValues);
    assert.equal(before.mathPrice, after.mathPrice);
    assert.notEqual(before.targetPrice, after.targetPrice);
});

test('cache replays do not create labels; unchanged newer reports remain controls', () => {
    const rows = [row(1, '2026-09-28T10:00Z', '2026-09-28T09:00Z', 5),
        row(2, '2026-09-28T11:00Z', '2026-09-28T09:00Z', 5),
        row(3, '2026-09-29T10:00Z', '2026-09-29T09:00Z', 5)];
    const { samples } = build(rows);
    assert.equal(samples.length, 1);
    assert.equal(samples[0].materiallyChanged, false);
    assert.equal(samples[0].observedAt, '2026-09-28T10:00:00.000Z');
});

test('split-boundary targets are purged and different payments cannot label one another', () => {
    const rows = [row(1, '2026-04-14T10:00Z', '2026-04-14T09:00Z', 5),
        row(2, '2026-04-15T10:00Z', '2026-04-15T09:00Z', 5.2)];
    const output = build(rows);
    assert.equal(output.samples.length, 0);
    assert.equal(output.purged, 1);
    rows[0].created_at = '2026-09-28T10:00Z';
    rows[0].updated_at_source = '2026-09-28T09:00Z';
    rows[1].created_at = '2026-09-29T10:00Z';
    rows[1].updated_at_source = '2026-09-29T09:00Z';
    rows[1].all_prices._payment.premium = { credit: null, cash: 5.2 };
    assert.equal(build(rows).samples.length, 0);
});
