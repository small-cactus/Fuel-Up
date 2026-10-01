// Public cached endpoint only; this never asks the upstream provider for prices.
// Usage: node scripts/national-prices/benchmarkTrends.mjs > timings.json
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { url, key } = JSON.parse(readFileSync('app.json')).expo.extra.supabase;
const results = [];
for (let pass = 0; pass < 2; pass++) {
  for (const requiresE85 of [false, true]) {
    for (const fuelType of ['regular', 'premium', 'e85']) {
      const started = performance.now();
      const response = await fetch(`${url}/functions/v1/gas-prices`, {
        method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'x-region': 'us-east-2' },
        body: JSON.stringify({ scope: 'national', fuelType, requiresE85 }),
        signal: AbortSignal.timeout(20000),
      });
      const body = await response.text();
      const ms = Math.round(performance.now() - started);
      assert.equal(response.status, 200);
      const value = JSON.parse(body);
      assert.equal(value.historyError, null);
      results.push({ pass, fuelType, requiresE85, status: response.status, ms,
        bytes: Buffer.byteLength(body), quotes: value.quotes.map(q => q.stationId), history: value.history.length });
    }
  }
}
console.log(JSON.stringify(results, null, 2));
