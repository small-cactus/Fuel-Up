// Cache-only public endpoint verification. No collection/provider requests.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const grades = ['regular', 'midgrade', 'premium', 'diesel', 'e85'];
const sql = `select grade, national_fuel_station_cache(grade) as stations
  from unnest(array['regular','midgrade','premium','diesel','e85']) grade`;
const stored = JSON.parse(execFileSync('npx', ['--no-install', 'supabase@2.118.0', 'db', 'query',
  '--linked', '--project-ref', 'vjindchxfebaltbslqwc', sql, '--output', 'json'],
  { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })).rows;
const { url, key } = JSON.parse(readFileSync('app.json')).expo.extra.supabase;
const checks = [];
for (const fuelType of grades) {
  const start = Date.now();
  const response = await fetch(`${url}/functions/v1/gas-prices`, {
    method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'x-region': 'us-east-2' },
    body: JSON.stringify({ scope: 'national', fuelType }), signal: AbortSignal.timeout(20000),
  });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.scope, 'national');
  const rows = stored.find(row => row.grade === fuelType).stations;
  assert.equal(rows.length, 5);
  assert.deepEqual(result.quotes.map(q => q.stationId), rows.map(row => String(row.station.id)));
  const product = ['regular', 'midgrade', 'premium'].includes(fuelType) ? `${fuelType}_gas` : fuelType;
  for (const quote of result.quotes) {
    const entry = rows.find(row => String(row.station.id) === quote.stationId).station.prices.find(p => p.fuelProduct === product);
    const fresh = p => p?.price > 0 && Date.parse(p.postedTime) <= start && start - Date.parse(p.postedTime) <= 86400000;
    const raw = fresh(entry.credit) ? entry.credit : fresh(entry.cash) ? entry.cash : null;
    assert.ok(raw);
    assert.equal(quote.price, raw.price);
    assert.equal(Date.parse(quote.updatedAt), Date.parse(raw.postedTime));
    assert(!quote.isEstimated && !quote.validation?.usedPrediction);
  }
  checks.push({ fuelType, milliseconds: Date.now() - start, exactIdsPricesAndTimestamps: true,
    prices: result.quotes.map(q => q.price), stationIds: result.quotes.map(q => q.stationId) });
}
console.log(JSON.stringify({ verifiedAt: new Date().toISOString(), providerRequests: 0, checks }, null, 2));
