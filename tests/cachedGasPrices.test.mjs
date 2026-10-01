import test from 'node:test';
import assert from 'node:assert/strict';
import { getCachedGasPrices } from '../supabase/functions/_shared/cachedGasPrices.mjs';
const now = Date.parse('2026-10-01T15:00:00Z');
const cached = args => getCachedGasPrices({...args, now});
const input = { latitude: 27.95, longitude: -82.45, radiusMiles: 5, fuelType: 'regular' };
const row = (id, longitude = input.longitude) => ({ observedAt: '2026-10-01T01:00:00Z', station: {
  id, name: 'Cached station', latitude: input.latitude, longitude,
  prices: [{ fuelProduct: 'regular_gas', credit: { price: 3.59, postedTime: '2026-09-30T23:00:00Z' }, cash: { price: 3.49 } }],
} });
function database(rows, error = null) {
  const calls = [];
  return { calls, rpc: async (name, args) => { calls.push({ name, args }); return { data: rows, error }; },
    from: () => { throw new Error('Serving must not query prediction history'); } };
}
test('fresh DB reads are cache-only, including forceRefresh; preserve payment and observation times', async () => {
  const db = database([row('one')]);
  const result = await cached({input:{...input,forceRefresh:true},db});
  assert.equal(result.source, 'national-cache');
  assert.equal(result.quotes[0].price,3.59);
  assert.equal(result.quotes[0].observedAt,'2026-10-01T01:00:00Z');
  assert.equal(result.quotes[0].updatedAt,'2026-09-30T23:00:00Z');
  assert.deepEqual(db.calls,[{name:'nearby_fuel_station_cache',args:{p_latitude:27.95,p_longitude:-82.45,p_radius_miles:5}}]);
});
test('exact radius, requested grade, and E85 restrictions survive DB normalization', async () => {
  const db = database([row('near'),row('outside',-82.7)]);
  assert.deepEqual((await cached({input,db})).quotes.map(q=>q.stationId),['near']);
  assert.equal((await cached({input:{...input,fuelType:'premium'},db})).quotes.length,0);
  assert.equal((await cached({input:{...input,requiresE85:true},db})).quotes.length,0);
});
test('empty cache and failed DB never invoke a fallback or write', async () => {
  assert.deepEqual((await cached({input,db:database([])})).quotes,[]);
  await assert.rejects(cached({input,db:database(null,{code:'down'})}),{code:'CACHE_UNAVAILABLE'});
});

test('serving returns raw reported prices only, with a 24-hour cutoff for the selected payment and grade',async()=>{
  const hour=3600000, posted=offset=>new Date(now+offset).toISOString();
  const station=(id,price,age)=>{const r=row(id);r.station.prices=[{fuelProduct:'regular_gas',credit:{price,postedTime:posted(-age)}}];return r;};
  const raw=station('raw-cheap',1.23,hour),boundary=station('boundary',4,24*hour),old=station('old',2,24*hour+1);
  const missing=station('missing',3,hour);delete missing.station.prices[0].credit.postedTime;
  const zero=station('zero',0,hour),future=station('future',3,-1);
  const fallback=station('fresh-cash',3,25*hour);fallback.station.prices[0].cash={price:3.2,postedTime:posted(-hour)};
  raw.station.prices.push({fuelProduct:'premium_gas',credit:{price:4.2,postedTime:posted(-25*hour)}});
  const result=await cached({input,db:database([raw,boundary,old,missing,zero,future,fallback])});
  assert.deepEqual(result.quotes.map(q=>q.stationId),['raw-cheap','boundary','fresh-cash']);
  assert.equal(result.quotes[0].price,1.23);assert.equal(result.quotes[0].validation,undefined);
  assert.equal(result.quotes[0].allPrices.premium,undefined);
  assert.equal(result.quotes[2].price,3.2);assert.equal(result.quotes[2].allPrices._payment.regular.selected,'cash');
  assert.equal(result.summary.pricePolicy,'reported-last-24-hours');
});

test('E85 access survives old, empty and omitted quotes without filling a price', async () => {
  const old=row('old-e85'),empty=row('unpriced-e85'),known=row('known-e85'),unknown=row('unknown');
  old.station.prices.push({fuelProduct:'e85',credit:{price:2.49,postedTime:'2026-09-01T00:00:00Z'}});
  empty.station.prices.push({fuelProduct:'e85',credit:null,cash:null});
  known.station.offersE85=true;
  const result=await cached({input:{...input,requiresE85:true},db:database([old,empty,known,unknown])});
  assert.deepEqual(result.quotes.map(q=>q.stationId),['old-e85','unpriced-e85','known-e85']);
  for(const q of result.quotes){assert.equal(q.offersE85,true);assert.equal(q.price,3.59);assert.equal(q.allPrices.e85,undefined);}
  // Buying E85 itself still cannot display an absent or stale quote as current.
  const e85=await cached({input:{...input,fuelType:'e85'},db:database([old,empty,known,unknown])});
  assert.deepEqual(e85.quotes.map(q=>q.stationId), ['old-e85','unpriced-e85','known-e85']);
  for(const q of e85.quotes) { assert.equal(q.price,null); assert.equal(q.updatedAt,null); assert.deepEqual(q.allPrices,{}); }
});

test('independent AFDC stations appear only for E85 and never inherit another grade price',async()=>{
  const afdc=row('afdc:123'); afdc.station.availabilitySource='afdc';afdc.station.offersE85=true;afdc.station.prices=[];
  const db=database([afdc]);
  const e85=(await cached({input:{...input,fuelType:'e85'},db})).quotes;
  assert.equal(e85.length,1);assert.equal(e85[0].providerId,'afdc');assert.equal(e85[0].price,null);
  assert.equal((await cached({input,db})).quotes.length,0);
});
