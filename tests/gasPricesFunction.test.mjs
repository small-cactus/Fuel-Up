import test from 'node:test';
import assert from 'node:assert/strict';
import { getGasPrices, fetchProvider, validateInput, queryKey } from '../supabase/functions/_shared/gasPrices.mjs';
const input = { latitude: 27.77, longitude: -82.64, fuelType: 'regular', radiusMiles: 10 };
const station = { id: '1', name: 'Station', latitude: 27.77, longitude: -82.64,
    prices: [{ fuelProduct: 'regular_gas', credit: { price: 3.5, postedTime: new Date().toISOString() } }] };
const payload = { data: { locationBySearchTerm: { stations: { results: [station] } } } };
function database({ cached = null, history = [], cacheError = null, lease = 'token' } = {}) {
    const writes = []; const calls = [];
    return { writes, calls, from(table) {
        const chain = {
            select() { return this; }, eq() { return this; }, gte() { return this; }, order() { return this; }, limit() { return this; },
            async maybeSingle() { return { data: cached, error: cacheError }; },
            async insert(rows) { writes.push({ table, rows }); return { error: null }; },
            async upsert(row) { writes.push({ table, row }); return { error: null }; },
            then(resolve) { return Promise.resolve({ data: history, error: null }).then(resolve); },
        }; return chain;
    }, async rpc(name, args) { calls.push({ name, args }); return { data: name === 'claim_fuel_refresh' ? lease : null, error: null }; } };
}
test('reject invalid inputs before touching the cache or provider', async () => {
    for (const bad of [{latitude:null}, {latitude:91}, {longitude:'-82'}, {fuelType:'all'}, {radiusMiles:0}, {forceRefresh:'yes'}]) {
        assert.throws(() => validateInput({...input,...bad}), { code:'INVALID_INPUT' });
    }
});
test('cache keys isolate grade, radius and geographically distinct queries', () => {
    assert.notEqual(queryKey(input),queryKey({...input,fuelType:'diesel'}));
    assert.notEqual(queryKey(input),queryKey({...input,latitude:27.78}));
    assert.notEqual(queryKey(input),queryKey({...input,radiusMiles:20}));
});
test('fresh cache returns without provider calls and rejects other providers', async () => {
    const q = {providerId:'gasbuddy',providerTier:'station',stationId:'1',fuelType:'regular',price:3.5,allPrices:{regular:3.5},latitude:27.77,longitude:-82.64};
    const db = database({cached:{quotes:[q,{...q,providerId:'google'}],expires_at:new Date(Date.now()+60000).toISOString()}});
    const result = await getGasPrices({input,db,fetchImpl:()=>{throw Error('must not fetch');}});
    assert.equal(result.source,'cache'); assert.equal(result.quotes.length,1); assert.equal(db.calls.length,0);
});
test('cache miss validates, writes and returns live GasBuddy prices', async () => {
    const db=database(); const outcomes=[]; let url;
    const result=await getGasPrices({input,db,fetchImpl:async u=>{url=u;return Response.json(payload);},recordOutcome:async(...args)=>outcomes.push(args)});
    assert.equal(url,'https://www.gasbuddy.com/graphql'); assert.equal(result.source,'live');
    assert.equal(result.quotes[0].price,3.5); assert.equal(result.quotes[0].providerId,'gasbuddy');
    assert.ok(db.writes.some(w=>w.table==='station_prices'));
    assert.ok(db.writes.some(w=>w.table==='fuel_query_cache'));
    assert.deepEqual(outcomes,[[true,'OK']]); assert.equal(db.calls.at(-1).name,'release_fuel_refresh');
});
test('HTTP 200 with GraphQL errors or schema changes is a failure', async () => {
    for (const p of [{errors:[{message:'field changed'}]}, {data:{changed:true}}]) {
        const db=database(); const outcomes=[];
        await assert.rejects(getGasPrices({input,db,fetchImpl:async()=>Response.json(p),recordOutcome:async(...args)=>outcomes.push(args)}));
        assert.equal(outcomes[0][0],false); assert.equal(db.writes.length,0);
        assert.equal(db.calls.at(-1).name,'release_fuel_refresh');
    }
});
test('empty coverage is negative-cached without a repair incident', async () => {
    const db=database();const outcomes=[];
    const result=await getGasPrices({input,db,fetchImpl:async()=>Response.json({data:{locationBySearchTerm:{stations:{results:[]}}}}),recordOutcome:async(...args)=>outcomes.push(args)});
    assert.deepEqual(result.quotes,[]);assert.deepEqual(outcomes,[[true,'OK']]);assert.equal(db.writes.length,1);
});
test('cache failure and duplicate refresh do not trigger provider repair', async () => {
    for (const db of [database({cacheError:{message:'down'}}),database({lease:null})]) {
        await assert.rejects(getGasPrices({input,db,fetchImpl:()=>{throw Error('must not fetch');},recordOutcome:()=>{assert.fail('must not record');}}),{status:503});
    }
});
test('a provider timeout or 429 is recorded once and never cached as success', async () => {
    for (const fetchImpl of [async()=>new Response('',{status:429}),async()=>{throw new Error('timeout');}]) {
        const db=database();let failures=0;
        await assert.rejects(getGasPrices({input,db,fetchImpl,recordOutcome:async success=>{if(!success)failures++;}}));
        assert.equal(failures,1);assert.equal(db.writes.length,0);
    }
});
test('cache-fill uses GasBuddy history without a live call', async () => {
    const db=database({history:[{station_id:'cached',provider_id:'gasbuddy',fuel_type:'regular',price:3.4,all_prices:{regular:3.4},latitude:input.latitude,longitude:input.longitude,
        station_name:'Cached',created_at:new Date().toISOString(),updated_at_source:new Date().toISOString()}]});
    const result=await getGasPrices({input,db,fetchImpl:()=>assert.fail('No upstream call expected')});
    assert.equal(result.source,'cache-fill');assert.equal(result.quotes[0].stationId,'cached');
});
test('cash-only fallback uses cash source timestamp', async () => {
    const p=structuredClone(payload); p.data.locationBySearchTerm.stations.results[0].prices[0]={fuelProduct:'regular_gas',credit:{price:0,postedTime:'2020-01-01'},cash:{price:3.25,postedTime:'2026-09-28'}};
    const result=await fetchProvider(input,async()=>Response.json(p));
    assert.equal(result.quotes[0].price,3.25);assert.equal(result.quotes[0].updatedAt,'2026-09-28');
});
test('candidate probes cannot modify cache, history or incident counters', async () => {
    const db = database({ cached: { quotes: [], expires_at: new Date(Date.now() + 60000).toISOString() } });
    const result = await getGasPrices({ input, db, probeOnly: true,
        fetchImpl: async () => Response.json(payload), recordOutcome: () => assert.fail('Candidate must not record outcomes') });
    assert.equal(result.source, 'live'); assert.ok(result.quotes.length);
    assert.deepEqual(db.writes, []); assert.deepEqual(db.calls, []);
});
