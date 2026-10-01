const test=require('node:test');
const assert=require('node:assert/strict');
const load=require('./helpers/loadComponent.cjs');

test('Home shares its fallback GPS origin so Trends searches the same radius center',async t=>{
    let effect;
    const commits=[], queries=[];
    const origin={latitude:27.95,longitude:-82.45};
    const hook=load('src/screens/cluster-lab/useClusterLabStations.js',{
        react:{useEffect:fn=>{effect=fn;},useMemo:fn=>fn(),useState:()=>[null,()=>{}]},
        'react-native':{AppState:{currentState:'active',addEventListener:()=>({remove(){}})}},
        'expo-location':{getForegroundPermissionsAsync:async()=>({status:'granted'}),getLastKnownPositionAsync:async()=>({coords:origin})},
        '../../AppStateContext':{useAppState:()=>({setResolvedFuelSearchContext:value=>commits.push(value)})},
        '../../PreferencesContext':{usePreferences:()=>({preferences:{preferredOctane:'regular',searchRadiusMiles:5}})},
        '../../lib/deviceLocationCache':{getLastDeviceLocationRegion:async()=>null},
        '../../services/fuel':{getCachedFuelPriceSnapshot:async()=>null,refreshFuelPriceSnapshot:async query=>{queries.push(query);return {snapshot:{}};}},
        './stationCardModel':{buildLabStations:()=>[]},
    }).default;
    hook(true);t.after(effect());
    await new Promise(setImmediate);
    assert.equal(commits.length,1);
    assert.equal(commits[0].latitude,origin.latitude);
    assert.equal(commits[0].longitude,origin.longitude);
    assert.equal(commits[0].locationSource,'device');
    assert.equal(queries[0].latitude,commits[0].latitude);
    assert.equal(queries[0].longitude,commits[0].longitude);
    assert.equal(queries[0].radiusMiles,5);
});

test('Home publishes local data then refreshes DB on focus and foreground; cleanup prevents old query results',async()=>{
    let effect, cleanup, foreground, resolveRefresh, calls=0;
    const results=[];
    const hook=load('src/screens/cluster-lab/useClusterLabStations.js',{
        react:{useEffect:fn=>{effect=fn;},useMemo:fn=>fn(),useState:()=>[null,value=>results.push(value)]},
        'react-native':{AppState:{currentState:'active',addEventListener:(_,fn)=>{foreground=fn;return {remove(){foreground=null;}};}}},
        'expo-location':{},'../../AppStateContext':{useAppState:()=>({resolvedFuelSearchContext:{latitude:27.95,longitude:-82.45}})},
        '../../PreferencesContext':{usePreferences:()=>({preferences:{preferredOctane:'regular',searchRadiusMiles:5}})},
        '../../lib/deviceLocationCache':{},
        '../../services/fuel':{getCachedFuelPriceSnapshot:async()=>({topStations:['cached']}),refreshFuelPriceSnapshot:()=>{calls++;return new Promise(resolve=>resolveRefresh=resolve);}},
        './stationCardModel':{buildLabStations:s=>s?.topStations||[]},
    }).default;
    hook(true);cleanup=effect();
    await new Promise(setImmediate);
    assert.equal(calls,1);assert.deepEqual(results[0].stations,['cached']);
    resolveRefresh({snapshot:{topStations:['fresh']}});await new Promise(setImmediate);
    assert.deepEqual(results.at(-1).stations,['fresh']);
    foreground('active');await new Promise(setImmediate);assert.equal(calls,2);
    cleanup();const count=results.length;
    resolveRefresh({snapshot:{topStations:['wrong-old-query']}});await new Promise(setImmediate);
    assert.equal(results.length,count);assert.equal(foreground,null);
});

test('Home removes a quote immediately after its 24-hour expiry without a network request',async t=>{
    const now=Date.parse('2026-10-01T15:00:00Z');
    t.mock.timers.enable({apis:['Date','setTimeout'],now});
    let effect,calls=0;
    const results=[];
    const quote={providerTier:'station',price:3.10,updatedAt:new Date(now-86400000+1000).toISOString()};
    const {isFreshReportedQuote}=require('../src/services/fuel/reportedPrices');
    const hook=load('src/screens/cluster-lab/useClusterLabStations.js',{
        react:{useEffect:fn=>{effect=fn;},useMemo:fn=>fn(),useState:()=>[null,value=>results.push(value)]},
        'react-native':{AppState:{currentState:'active',addEventListener:()=>({remove(){}})}},
        'expo-location':{},'../../AppStateContext':{useAppState:()=>({resolvedFuelSearchContext:{latitude:27.95,longitude:-82.45}})},
        '../../PreferencesContext':{usePreferences:()=>({preferences:{preferredOctane:'regular',searchRadiusMiles:5}})},
        '../../lib/deviceLocationCache':{},
        '../../services/fuel':{getCachedFuelPriceSnapshot:async()=>({topStations:[quote]}),refreshFuelPriceSnapshot:async()=>{calls++;return {snapshot:{topStations:[quote]}};}},
        './stationCardModel':{buildLabStations:s=>s.topStations.filter(q=>isFreshReportedQuote(q))},
    }).default;
    hook(true);const cleanup=effect();t.after(cleanup);
    await new Promise(setImmediate);
    assert.equal(results.at(-1).stations.length,1);
    t.mock.timers.tick(1000);assert.equal(results.at(-1).stations.length,1);
    t.mock.timers.tick(1);assert.deepEqual(results.at(-1).stations,[]);
    assert.equal(calls,1);
});
