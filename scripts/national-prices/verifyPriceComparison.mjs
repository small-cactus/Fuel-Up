// Independent archive/schema checks and quote-difference counts against Python output.
// Usage: node verifyPriceComparison.mjs BEFORE_DIR AFTER_DIR COMPARISON_JSON REPORT_JSON
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { auditArchive } from './auditArchive.mjs';

const [beforeDir, afterDir, comparisonPath, outputPath] = process.argv.slice(2);
const expected = JSON.parse(readFileSync(comparisonPath));
function load(root) {
  const { run, jobs } = JSON.parse(readFileSync(join(root, 'manifest.json')));
  assert.equal(run.status, 'complete');
  assert.equal(jobs.length, run.expected_batches);
  const stations = new Set(), quotes = new Map();
  let archiveBytes = 0;
  for (const job of jobs) {
    assert.equal(job.status, 'succeeded');
    const bytes = readFileSync(join(root, job.object_path));
    auditArchive(bytes, job, run);
    archiveBytes += bytes.length;
    const snapshot = JSON.parse(gunzipSync(bytes));
    for (const station of snapshot.stations) {
      assert(!stations.has(station.id));
      stations.add(station.id);
      for (const price of station.prices) for (const payment of ['cash', 'credit']) {
        const key = JSON.stringify([station.id, price.fuelProduct, payment]);
        assert(!quotes.has(key));
        quotes.set(key, price[payment]);
      }
    }
  }
  assert.equal(stations.size, run.expected_stations);
  return { runId: run.id, archiveBytes, objects: jobs.length, stations, quotes };
}
const a = load(beforeDir), b = load(afterDir);
assert.deepEqual(a.stations, b.stations);
assert.equal(a.runId, expected.before_run);
assert.equal(b.runId, expected.after_run);
const counts = {}, changedStations = new Set();
const positive = q => Number.isFinite(q?.price) && q.price > 0;
for (const key of new Set([...a.quotes.keys(), ...b.quotes.keys()])) {
  const x = a.quotes.get(key), y = b.quotes.get(key);
  let category;
  if (positive(x) && positive(y)) {
    if (x.price !== y.price) {
      category = 'price_changed';
      changedStations.add(JSON.parse(key)[0]);
    } else {
      category = 'price_unchanged';
      if (Date.parse(y.postedTime) > Date.parse(x.postedTime)) {
        counts.price_unchanged_advanced = (counts.price_unchanged_advanced || 0) + 1;
      }
    }
  } else category = positive(y) ? 'newly_available_quotes' : positive(x) ? 'newly_missing_quotes' : 'unpriced_both';
  counts[category] = (counts[category] || 0) + 1;
}
for (const [key, value] of Object.entries(counts)) assert.equal(value, expected.counts[key], key);
assert.equal(changedStations.size, expected.stations_with_price_changes);
writeFileSync(outputPath, JSON.stringify({ verified: true, runs: [a.runId, b.runId],
  archiveObjects: a.objects + b.objects, archiveBytes: a.archiveBytes + b.archiveBytes,
  stationsPerRun: a.stations.size, counts, changedStations: changedStations.size,
  checks: ['sha256', 'size', 'schema', 'ordered station IDs', 'regional provenance',
    'observation timestamps', 'duplicate absence', 'priced counts', 'independent quote comparison'] }, null, 2) + '\n', { flag: 'wx' });
console.log(`Verified runs ${a.runId} → ${b.runId}: ${a.objects + b.objects} archives.`);
