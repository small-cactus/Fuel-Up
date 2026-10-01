import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
const { url, key } = JSON.parse(readFileSync(new URL('../../app.json', import.meta.url))).expo.extra.supabase;
const cities = [
  ['Clearwater',27.9659,-82.8001],['New York',40.7128,-74.006],
  ['Los Angeles',34.0522,-118.2437],['Seattle',47.6062,-122.3321],
  ['Honolulu',21.3099,-157.8581],['Anchorage',61.2181,-149.9003],
];
const checks = [];
for (const [city, latitude, longitude] of cities) {
  let previous = new Set();
  for (const radiusMiles of [2,5,10,15]) {
    const started = performance.now();
    const response = await fetch(`${url}/functions/v1/gas-prices`, {
      method: 'POST', headers: { apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json','x-region':'us-east-2' },
      body: JSON.stringify({ latitude,longitude,radiusMiles,fuelType:'regular',forceRefresh:true }),
      signal:AbortSignal.timeout(30000),
    });
    const result = await response.json();
    assert.equal(response.status,200,`${city}: ${result.error}`);
    assert.equal(result.source,'national-cache');
    assert.equal(result.summary.pricePolicy,'reported-last-24-hours');
    // An empty cache response is valid when every local report has expired.
    const ids = new Set(result.quotes.map(q=>q.stationId));
    assert.equal(ids.size,result.quotes.length);
    for (const id of previous) assert(ids.has(id),`${city}: expanded radius lost ${id}`);
    for (const q of result.quotes) {
      assert(q.distanceMiles<=radiusMiles && q.distanceMiles>=0);
      assert(Number.isFinite(Date.parse(q.observedAt)));
      assert(q.price>0 && q.fuelType==='regular');
      assert(!q.isEstimated && !q.validation?.usedPrediction);
      assert(Date.parse(q.updatedAt)<=Date.now() && Date.now()-Date.parse(q.updatedAt)<=86400000);
    }
    previous = ids;
    const check={city,radiusMiles,stations:ids.size,milliseconds:Math.round(performance.now()-started),...result.summary};
    checks.push(check);console.log(JSON.stringify(check));
  }
}
if (process.argv[2]) writeFileSync(process.argv[2],JSON.stringify({verifiedAt:new Date().toISOString(),checks},null,2)+'\n');
