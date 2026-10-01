const test=require('node:test');
const assert=require('node:assert/strict');
const load=require('./helpers/loadComponent.cjs');

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
