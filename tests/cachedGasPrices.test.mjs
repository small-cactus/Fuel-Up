import test from 'node:test';
import assert from 'node:assert/strict';
import { getCachedGasPrices } from '../supabase/functions/_shared/cachedGasPrices.mjs';
const input = { latitude: 27.95, longitude: -82.45, radiusMiles: 5, fuelType: 'regular' };
const row = (id, longitude = input.longitude) => ({ observedAt: '2026-10-01T01:00:00Z', station: {
  id, name: 'Cached station', latitude: input.latitude, longitude,
  prices: [{ fuelProduct: 'regular_gas', credit: { price: 3.59, postedTime: '2026-09-30T23:00:00Z' }, cash: { price: 3.49 } }],
} });
function database(rows, error = null) {
  const calls = [];
  return { calls, rpc: async (name, args) => { calls.push({ name, args }); return { data: rows, error }; },
    from: name => { assert.equal(name, 'station_prices'); const chain = { select(){return this;},eq(){return this;},gte(){return this;},order(){return this;},limit(){return this;},
      then(resolve){return Promise.resolve({data:[]}).then(resolve);} }; return chain; } };
}
test('fresh DB reads are cache-only, including forceRefresh; preserve payment and observation times', async () => {
  const db = database([row('one')]);
  const result = await getCachedGasPrices({input:{...input,forceRefresh:true},db});
  assert.equal(result.source, 'national-cache');
  assert.equal(result.quotes[0].price,3.59);
  assert.equal(result.quotes[0].observedAt,'2026-10-01T01:00:00Z');
  assert.equal(result.quotes[0].updatedAt,'2026-09-30T23:00:00Z');
  assert.deepEqual(db.calls,[{name:'nearby_fuel_station_cache',args:{p_latitude:27.95,p_longitude:-82.45,p_radius_miles:5}}]);
});
test('exact radius, requested grade, and E85 restrictions survive DB normalization', async () => {
  const db = database([row('near'),row('outside',-82.7)]);
  assert.deepEqual((await getCachedGasPrices({input,db})).quotes.map(q=>q.stationId),['near']);
  assert.equal((await getCachedGasPrices({input:{...input,fuelType:'premium'},db})).quotes.length,0);
  assert.equal((await getCachedGasPrices({input:{...input,requiresE85:true},db})).quotes.length,0);
});
test('empty cache and failed DB never invoke a fallback or write', async () => {
  assert.deepEqual((await getCachedGasPrices({input,db:database([])})).quotes,[]);
  await assert.rejects(getCachedGasPrices({input,db:database(null,{code:'down'})}),{code:'CACHE_UNAVAILABLE'});
});
