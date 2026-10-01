const test = require('node:test');
const assert = require('node:assert/strict');
const query={latitude:37.3346,longitude:-122.009,radiusMiles:10,fuelType:'regular'};
const station=(prices)=>({id:'A',name:'Test fuel',latitude:query.latitude,longitude:query.longitude,prices});
const price=(fuelProduct,value)=>({fuelProduct,credit:{price:value,postedTime:new Date().toISOString()}});

async function setup(t, readRows) {
    const storage=new Map();
    const paths=['../src/services/fuel/index.js','../src/services/fuel/cacheStore.js',
        '@react-native-async-storage/async-storage','../src/lib/devCounter.js','../src/lib/supabase.js'].map(require.resolve);
    const previous=paths.map(p=>require.cache[p]);
    paths.forEach(p=>delete require.cache[p]);
    const prime=(i,exports)=>require.cache[paths[i]]={id:paths[i],filename:paths[i],loaded:true,exports};
    prime(2,{default:{getItem:async k=>storage.get(k)??null,setItem:async(k,v)=>storage.set(k,v),
        removeItem:async k=>storage.delete(k),getAllKeys:async()=>[...storage.keys()],multiRemove:async ks=>ks.forEach(k=>storage.delete(k))}});
    prime(3,{getApiStats:async()=>({}),incrementApiStat(){},resetApiStats:async()=>({})});
    const {getCachedGasPrices}=await import('../supabase/functions/_shared/cachedGasPrices.mjs');
    prime(4,{hasSupabaseConfig:true,supabase:{functions:{async invoke(name,options){
        assert.equal(name,'gas-prices');
        try {return {data:await getCachedGasPrices({input:options.body,db:{
            from(){assert.fail('Serving must not read prediction history or write research prices');},
            async rpc(name){assert.equal(name,'nearby_fuel_station_cache');return {data:(await readRows()).map(s=>({station:s,observedAt:new Date().toISOString()})),error:null};}
        }}),error:null};}catch(error){return {data:null,error};}
    }}}});
    const oldFetch=global.fetch,oldDev=global.__DEV__;
    global.__DEV__=false;global.fetch=()=>assert.fail('No provider requests from app serving');
    t.after(()=>{global.fetch=oldFetch;global.__DEV__=oldDev;paths.forEach((p,i)=>{delete require.cache[p];if(previous[i])require.cache[p]=previous[i];});});
    return {service:require(paths[0]),storage};
}

test('clearFuelPriceCache prevents an in-flight DB read from repopulating cache',async t=>{
    let resolveRead;
    const {service,storage}=await setup(t,()=>new Promise(resolve=>resolveRead=resolve));
    const request=service.refreshFuelPriceSnapshot(query);
    while(!resolveRead) await new Promise(setImmediate);
    await service.clearFuelPriceCache();
    resolveRead([station([price('regular_gas',3.10)])]);
    await assert.rejects(request,error=>service.isFuelCacheResetError(error));
    assert.equal(await service.getCachedFuelPriceSnapshot(query),null);
    assert.deepEqual([...storage.keys()].filter(k=>k.startsWith('fuel:')),[]);
});

test('empty nationwide DB results clear an old winner without fetching the provider',async t=>{
    let rows=[station([price('regular_gas',3.10)])];
    const {service}=await setup(t,async()=>rows);
    assert.equal((await service.refreshFuelPriceSnapshot(query)).snapshot.quote.price,3.10);
    rows=[];
    const result=await service.refreshFuelPriceSnapshot(query);
    assert.equal(result.snapshot.quote,null);assert.deepEqual(result.snapshot.topStations,[]);
    assert.deepEqual((await service.getCachedFuelPriceSnapshot(query)).topStations,[]);
});

test('refresh persists the exact reported price locally, without prediction or history writes',async t=>{
    const {service}=await setup(t,async()=>[station([price('regular_gas',3.10)])]);
    const result=await service.refreshFuelPriceSnapshot(query);
    const saved=await service.getCachedFuelPriceSnapshot(query);
    for(const snapshot of [result.snapshot,saved]){
        assert.equal(snapshot.quote.price,3.10);
        assert.equal(snapshot.topStations[0].allPrices.regular,3.10);
        assert.equal(snapshot.quote.validation?.usedPrediction,undefined);
        assert.equal(snapshot.quote.isEstimated,false);
    }
});

test('uniform multi-grade prices exclude unsupported higher grades',async t=>{
    const {service}=await setup(t,async()=>[station(['regular_gas','midgrade_gas','premium_gas'].map(f=>price(f,3.79)))]);
    const result=await service.refreshFuelPriceSnapshot({...query,fuelType:'premium'});
    assert.deepEqual(result.snapshot.topStations,[]);
});

test('duplicate higher grades stay suppressed in the local cache',async t=>{
    const {service}=await setup(t,async()=>[station([price('regular_gas',3.39),price('midgrade_gas',3.39),price('premium_gas',3.79)])]);
    await service.refreshFuelPriceSnapshot(query);
    const q=(await service.getCachedFuelPriceSnapshot(query)).topStations[0];
    assert.equal(q.allPrices.regular,3.39);assert.equal(q.allPrices.premium,3.79);
    assert.equal(q.allPrices.midgrade,undefined);assert.equal(q.allPrices._payment.midgrade,undefined);
    assert.deepEqual(q.availableFuelGrades,['regular','premium']);
    assert.deepEqual(q.suppressedDuplicateFuelGrades,['midgrade']);
});

test('a requested duplicate higher grade does not reappear via the client cache',async t=>{
    const {service}=await setup(t,async()=>[station([price('regular_gas',3.39),price('midgrade_gas',3.39),price('premium_gas',3.79)])]);
    const result=await service.refreshFuelPriceSnapshot({...query,fuelType:'midgrade'});
    assert.deepEqual(result.snapshot.topStations,[]);
});
