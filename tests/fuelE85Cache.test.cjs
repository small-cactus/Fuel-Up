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
