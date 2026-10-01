// Read only: verify completed publication against the current protected cache.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const sql = `select national_fuel_station_cache('regular',true) stations,
 (select e85_availability_version from fuel_national_trends_cache where fuel_type='regular' and requires_e85) version,
 (select run_id from fuel_national_trends_cache where fuel_type='regular' and requires_e85) run_id`;
const stored = JSON.parse(execFileSync('npx', ['--no-install', 'supabase@2.118.0', 'db', 'query', '--linked',
  '--project-ref', 'vjindchxfebaltbslqwc', sql, '--output', 'json'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).rows[0];
assert.equal(stored.version, 1, 'Wait for the first completed publication after deployment');
assert.equal(stored.stations.length, 5);
assert.ok(stored.stations.every(r => r.station.offersE85 === true));
const { url, key } = JSON.parse(readFileSync('app.json')).expo.extra.supabase;
const response = await fetch(`${url}/functions/v1/gas-prices`, {
  method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'x-region': 'us-east-2' },
  body: JSON.stringify({ scope: 'national', fuelType: 'regular', requiresE85: true }),
  signal: AbortSignal.timeout(20000),
});
const result = await response.json();
assert.equal(response.status, 200);
assert.equal(result.scanId, stored.run_id);
assert.deepEqual(result.quotes.map(q => q.stationId), stored.stations.map(r => String(r.station.id)));
for (const quote of result.quotes) {
  const entry = stored.stations.find(r => String(r.station.id) === quote.stationId).station.prices.find(p => p.fuelProduct === 'regular_gas');
  const fresh = p => p?.price > 0 && Date.parse(p.postedTime) <= Date.now() && Date.now() - Date.parse(p.postedTime) <= 86400000;
  const raw = fresh(entry.credit) ? entry.credit : fresh(entry.cash) ? entry.cash : null;
  assert.ok(raw);
  assert.equal(quote.price, raw.price);
  assert.equal(Date.parse(quote.updatedAt), Date.parse(raw.postedTime));
}
console.log(JSON.stringify({ verifiedAt: new Date().toISOString(), providerRequests: 0, runId: result.scanId,
  availabilityVersion: stored.version, exactIdsPricesTimestamps: true, quotes: result.quotes }, null, 2));
