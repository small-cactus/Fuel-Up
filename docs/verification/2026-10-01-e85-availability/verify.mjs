// Cache-only verification; no provider requests. Run from the project root.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { url, key } = JSON.parse(readFileSync('app.json')).expo.extra.supabase;
const checks = [];
for (const requiresE85 of [false, true]) {
  const started = Date.now();
  const response = await fetch(`${url}/functions/v1/gas-prices`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'x-region': 'us-east-2' },
    body: JSON.stringify({ latitude: 27.973, longitude: -82.764, radiusMiles: 15, fuelType: 'regular', requiresE85 }),
    signal: AbortSignal.timeout(20000),
  });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.source, 'national-cache');
  assert.ok(result.quotes.length > 0);
  for (const q of result.quotes) {
    assert.ok(q.price > 0 && q.distanceMiles <= 15);
    assert.ok(Date.parse(q.updatedAt) <= Date.now() && Date.parse(q.updatedAt) >= started - 86400000);
    assert.ok(!q.isEstimated && !q.validation?.usedPrediction);
    if (requiresE85) assert.equal(q.offersE85, true);
  }
  checks.push({ requiresE85, count: result.quotes.length,
    listedE85: result.quotes.filter(q => q.offersE85).length,
    listedWithoutFreshE85Price: result.quotes.filter(q => q.offersE85 && !(q.allPrices?.e85 > 0)).length,
    stations: result.quotes.filter(q => q.offersE85).map(q => ({ id: q.stationId, name: q.stationName, price: q.price, e85Price: q.allPrices?.e85 ?? null })) });
}
assert.ok(checks[1].listedWithoutFreshE85Price > 0);
assert.equal(checks[1].count, checks[0].listedE85);
console.log(JSON.stringify({ verifiedAt: new Date().toISOString(), providerRequests: 0, checks }, null, 2));
