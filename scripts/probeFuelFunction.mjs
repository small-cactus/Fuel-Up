import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const config = JSON.parse(await readFile(new URL('../app.json', import.meta.url))).expo.extra.supabase;
const endpoint = process.env.FUEL_FUNCTION_NAME || 'gas-prices';
const key = config.key;
const grades = process.argv.includes('--all-grades') ? ['regular', 'midgrade', 'premium', 'diesel', 'e85'] : ['regular'];
for (const fuelType of grades) {
  const body = { latitude: 27.9506, longitude: -82.4572, radiusMiles: 10, fuelType,
    forceRefresh: !process.argv.includes('--cache-only') };
  for (let attempt = 0; attempt < 2; attempt++) {
    const start = performance.now();
    const response = await fetch(`${config.url}/functions/v1/${endpoint}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-region': 'us-east-2', ...(endpoint !== 'gas-prices' ? { 'x-fuel-repair-secret': process.env.FUEL_REPAIR_SECRET } : {}), apikey: key, Authorization: `Bearer ${key}` },
      body: JSON.stringify(body), signal: AbortSignal.timeout(20000),
    });
    const result = await response.json();
    assert.equal(response.status, 200, `Function returned ${response.status}: ${result.error}`);
    assert.equal(result.version, 1);
    assert.ok(result.quotes.length > 0, `${fuelType}: expected prices in Tampa`);
    for (const quote of result.quotes) {
      assert.equal(quote.providerId, 'gasbuddy');
      assert.equal(quote.fuelType, fuelType);
      assert.ok(Number.isFinite(quote.price) && quote.price > 0 && quote.price < 20);
      assert.ok(quote.distanceMiles >= 0 && quote.distanceMiles <= body.radiusMiles);
    }
    if (attempt && endpoint === 'gas-prices') assert.equal(result.source, 'cache');
    if (!attempt && body.forceRefresh) {
      assert.equal(result.source, 'live');
      if (endpoint === 'gas-prices') assert.ok(result.summary.persistedLiveRowCount > 0, 'Live history must persist');
    }
    console.log(JSON.stringify({ fuelType, source: result.source, stations: result.quotes.length,
      milliseconds: Math.round(performance.now() - start), summary: result.summary }));
    body.forceRefresh = false;
  }
}
