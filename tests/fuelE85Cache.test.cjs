const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/loadComponent.cjs');
const core = require('../src/services/fuel/core');
test('spatial and persisted caches never reuse unrestricted coverage for E85 or vice versa', async () => {
    const values = new Map();
    const storage = { getItem: async key => values.get(key), setItem: async (key,value) => values.set(key,value) };
    const cache = load('src/services/fuel/cacheStore.js', { '@react-native-async-storage/async-storage': storage });
    const service = load('src/services/fuel/index.js', {
        './core': core, './config': {getFuelServiceConfig:()=>({stationCacheTtlMs:600000,areaCacheTtlMs:600000})},
        './cacheStore': cache, './stationData': {}, './remote': {}, '../../lib/trajectoryFuelFetch': {},
    });
    const query = {latitude:27.95,longitude:-82.45,radiusMiles:10,fuelType:'premium'};
    const normalKey = core.buildCacheKey(query);
    const e85Key = core.buildCacheKey({...query,requiresE85:true});
    assert.notEqual(normalKey,e85Key);
    const metadata = {centerLat:query.latitude,centerLng:query.longitude,radiusMiles:10,fuelType:'premium',preferredProvider:'gasbuddy',fetchedAt:Date.now()};
    await cache.setCachedEntry(normalKey,{topStations:[]},metadata);
    assert.equal(service.hasUsableCachedFuelWindow(query),true);
    assert.equal(service.hasUsableCachedFuelWindow({...query,requiresE85:true}),false);
    await cache.setCachedEntry(e85Key,{topStations:[]},{...metadata,requiresE85:true});
    assert.equal(service.hasUsableCachedFuelWindow({...query,requiresE85:true}),true);
    const restartedCache=load('src/services/fuel/cacheStore.js',{'@react-native-async-storage/async-storage':storage});
    await restartedCache.getCachedEntry(e85Key);
    assert.equal(restartedCache.listSpatialCacheEntries()[0].requiresE85,true);
});

test('cache reuse requires coverage of the entire requested radius after movement', async () => {
    const storage = {getItem:async()=>null,setItem:async()=>{}};
    const cache = load('src/services/fuel/cacheStore.js', {'@react-native-async-storage/async-storage':storage});
    const service = load('src/services/fuel/index.js', {
        './core':core,'./config':{getFuelServiceConfig:()=>({stationCacheTtlMs:600000,areaCacheTtlMs:600000})},
        './cacheStore':cache,'./stationData':{},'./remote':{},'../../lib/trajectoryFuelFetch':{},
    });
    const query={latitude:27.95,longitude:-82.45,radiusMiles:10,fuelType:'regular'};
    await cache.setCachedEntry(core.buildCacheKey(query),{}, {centerLat:query.latitude,centerLng:query.longitude,
        radiusMiles:10,fuelType:'regular',preferredProvider:'gasbuddy',fetchedAt:Date.now()});
    assert.equal(service.hasUsableCachedFuelWindow(query),true);
    assert.equal(service.hasUsableCachedFuelWindow({...query,latitude:27.96}),false);
    assert.equal(service.hasUsableCachedFuelWindow({...query,latitude:27.96,radiusMiles:5}),true);
    assert.notEqual(core.buildCacheKey(query),core.buildCacheKey({...query,latitude:27.95001}));
});

test('a narrower reused window removes the old cheapest outside the new radius',async()=>{
    const stationData=require('../src/services/fuel/stationData');
    const storage={getItem:async()=>null,setItem:async()=>{}};
    const cache=load('src/services/fuel/cacheStore.js',{'@react-native-async-storage/async-storage':storage});
    const service=load('src/services/fuel/index.js',{
        './core':core,'./config':{getFuelServiceConfig:()=>({stationCacheTtlMs:600000,areaCacheTtlMs:600000,defaultRadiusMiles:10})},
        './cacheStore':cache,'./stationData':{...stationData,snapshotHasCurrentValidation:()=>true},'./remote':{},'../../lib/trajectoryFuelFetch':{},
    });
    const query={latitude:27.95,longitude:-82.45,radiusMiles:10,fuelType:'regular'};
    const base={providerId:'gasbuddy',providerTier:'station',fuelType:'regular',longitude:-82.45,isEstimated:false};
    const near={...base,stationId:'near',latitude:27.95,price:4,allPrices:{regular:4}};
    const far={...base,stationId:'far',latitude:28.05,price:3,allPrices:{regular:3}};
    await cache.setCachedEntry(core.buildCacheKey(query),{quote:far,topStations:[far,near],fetchedAt:new Date().toISOString()},
        {centerLat:query.latitude,centerLng:query.longitude,radiusMiles:10,fuelType:'regular',preferredProvider:'gasbuddy',fetchedAt:Date.now()});
    const snapshot=await service.getCachedFuelPriceSnapshot({...query,radiusMiles:2});
    assert.equal(snapshot.quote.stationId,'near');assert.deepEqual(snapshot.topStations.map(q=>q.stationId),['near']);
});
