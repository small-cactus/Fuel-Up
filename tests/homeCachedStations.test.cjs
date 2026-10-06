const test=require('node:test');
const assert=require('node:assert/strict');
const load=require('./helpers/loadComponent.cjs');

test('Home shares its fallback GPS origin so Trends searches the same radius center',async t=>{
    let effect;
    const commits=[], queries=[];
    const origin={latitude:27.95,longitude:-82.45};
    const hook=load('src/screens/cluster-lab/useClusterLabStations.js',{
        '../../lib/useNetworkStatus': { __esModule: true, default: () => ({ faultsEnabled: false, generation: 0, connected: null }) },
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
        '../../lib/useNetworkStatus': { __esModule: true, default: () => ({ faultsEnabled: false, generation: 0, connected: null }) },
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
    assert.equal(calls,1);assert.deepEqual(results.find(value=>value.stations).stations,['cached']);
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
        '../../lib/useNetworkStatus': { __esModule: true, default: () => ({ faultsEnabled: false, generation: 0, connected: null }) },
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

test('live Home location updates the shared search context and launch cache using current preferences', () => {
    let effect, options;
    const commits=[], persisted=[];
    const hook=load('src/screens/cluster-lab/useHomeDeviceLocation.js', {
        react:{useEffect:fn=>{effect=fn;},useRef:()=>({current:null})},
        'react-native':{AppState:{}},'expo-location':{},
        '../../AppStateContext':{useAppState:()=>({resolvedFuelSearchContext:{latitude:27.9,longitude:-82.8},setResolvedFuelSearchContext:c=>commits.push(c)})},
        '../../PreferencesContext':{usePreferences:()=>({preferences:{preferredOctane:'premium',searchRadiusMiles:8,preferredBrands:['wawa'],fuelMemberships:['costco']}})},
        '../../lib/homeDeviceLocation':{startHomeDeviceLocation:o=>{options=o;return ()=>{};}},
        '../../lib/deviceLocationCache':{persistLastDeviceLocationRegion:(...args)=>persisted.push(args)},
    }).default;
    hook(true);effect();
    options.onLocation({coords:{latitude:28.01,longitude:-82.577,accuracy:10},timestamp:123456});
    assert.equal(commits[0].latitude,28.01);assert.equal(commits[0].longitude,-82.577);
    assert.match(commits[0].criteriaSignature,/premium\|8/);
    assert.equal(options.getOrigin().latitude,28.01);
    assert.equal(persisted[0][1].capturedAt,123456);
});

test('live GPS does not override an explicit manual location or run on an unfocused Home', () => {
    for (const [active,manualLocationOverride] of [[false,null],[true,{latitude:27,longitude:-82}]]) {
        let effect, starts=0;
        const hook=load('src/screens/cluster-lab/useHomeDeviceLocation.js', {
            react:{useEffect:fn=>{effect=fn;},useRef:()=>({current:null})},
            'react-native':{AppState:{}},'expo-location':{},
            '../../AppStateContext':{useAppState:()=>({manualLocationOverride})},
            '../../PreferencesContext':{usePreferences:()=>({preferences:{}})},
            '../../lib/homeDeviceLocation':{startHomeDeviceLocation:()=>{starts++;}},
            '../../lib/deviceLocationCache':{},
        }).default;
        hook(active);effect();assert.equal(starts,0);
    }
});

test('cached station distances are recalculated from the current search center before filtering', async t => {
    let effect;const results=[];
    const stale={latitude:28.01,longitude:-82.577,distanceMiles:15};
    const hook=load('src/screens/cluster-lab/useClusterLabStations.js',{
        '../../lib/useNetworkStatus': { __esModule: true, default: () => ({ faultsEnabled: false, generation: 0, connected: null }) },
        react:{useEffect:fn=>{effect=fn;},useMemo:fn=>fn(),useState:()=>[null,value=>results.push(value)]},
        'react-native':{AppState:{currentState:'active',addEventListener:()=>({remove(){}})}},
        'expo-location':{},'../../AppStateContext':{useAppState:()=>({resolvedFuelSearchContext:{latitude:28.01,longitude:-82.577}})},
        '../../PreferencesContext':{usePreferences:()=>({preferences:{preferredOctane:'regular',searchRadiusMiles:5}})},
        '../../lib/deviceLocationCache':{},
        '../../services/fuel':{getCachedFuelPriceSnapshot:async()=>({quote:stale,topStations:[stale]}),refreshFuelPriceSnapshot:async()=>({snapshot:{quote:stale,topStations:[stale]}})},
        './stationCardModel':{buildLabStations:s=>[s.quote,...s.topStations].filter(q=>q.distanceMiles<=5)},
    }).default;
    hook(true);t.after(effect());await new Promise(setImmediate);
    assert.equal(results.at(-1).stations.length,2);
    assert.equal(results.at(-1).stations[0].distanceMiles,0);
    assert.equal(stale.distanceMiles,15);
});

test('Home publishes map origin before an unresolved price-cache read', async t => {
    let effect, readStarted = false, stateIndex = 0;
    const updates = [[], []], values = [null, null];
    const origin = {latitude:27.95, longitude:-82.45};
    const hook = load('src/screens/cluster-lab/useClusterLabStations.js', {
        '../../lib/useNetworkStatus': { __esModule: true, default: () => ({ faultsEnabled: false, generation: 0, connected: null }) },
        react: {useEffect: fn=>{effect=fn;}, useMemo: fn=>fn(), useState:()=>{const index=stateIndex++; return [values[index],value=>{values[index]=value;updates[index].push(value);}];}},
        'react-native': {AppState:{currentState:'active',addEventListener:()=>({remove(){}})}},
        'expo-location':{},
        '../../AppStateContext':{useAppState:()=>({resolvedFuelSearchContext:origin})},
        '../../PreferencesContext':{usePreferences:()=>({preferences:{preferredOctane:'regular',searchRadiusMiles:6}})},
        '../../lib/deviceLocationCache':{},
        '../../services/fuel':{getCachedFuelPriceSnapshot:()=>{readStarted=true;return new Promise(()=>{});}},
        './stationCardModel':{buildLabStations:()=>[]},
    }).default;
    hook(true); t.after(effect());
    await new Promise(setImmediate);
    assert.equal(readStarted,true);
    assert.equal(updates[0].length,0,'no invented or prematurely published prices');
    assert.equal(updates[1][0].latitude,origin.latitude);
    assert.equal(updates[1][0].longitude,origin.longitude);
    stateIndex=0;
    assert.deepEqual(hook(true).origin,origin,'native map receives only numeric coordinates, not the scope key');
});

for (const cachedFresh of [true, false]) {
    test(`onboarding Home waits for durable cache (cached fresh: ${cachedFresh})`, async t => {
        let effect, finishWrite;
        const results = [], writes = [];
        const hook = load('src/screens/cluster-lab/useClusterLabStations.js', {
            '../../lib/onboardingHandoff': { onboardingHandoff: { getSnapshot: () => 'preparing' } },
            '../../lib/useNetworkStatus': { __esModule: true, default: () => ({ connected: true }) },
            react: { useEffect: fn => { effect = fn; }, useMemo: fn => fn(), useState: () => [null, v => results.push(v)] },
            'react-native': { AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } },
            'expo-location': {},
            '../../AppStateContext': { useAppState: () => ({ resolvedFuelSearchContext: { latitude: 27, longitude: -82 } }) },
            '../../PreferencesContext': { usePreferences: () => ({ preferences: { preferredOctane: 'regular', searchRadiusMiles: 6 } }) },
            '../../lib/deviceLocationCache': {},
            '../../services/fuel': {
                getCachedFuelPriceSnapshot: async () => ({ isFresh: cachedFresh, cacheKey: 'cached', topStations: ['cached'] }),
                refreshFuelPriceSnapshot: async () => ({ snapshot: { cacheKey: 'fresh', topStations: ['fresh'] } }),
                flushCachedEntry: key => { writes.push(key); return new Promise(resolve => { finishWrite = resolve; }); },
            },
            './stationCardModel': { buildLabStations: s => s.topStations },
        }).default;
        hook(true); t.after(effect()); await new Promise(setImmediate);
        assert.equal(results.some(v => v.loaded), false);
        assert.deepEqual(writes, [cachedFresh ? 'cached' : 'fresh']);
        finishWrite(); await new Promise(setImmediate);
        assert.deepEqual(results.find(v => v.loaded).stations, [cachedFresh ? 'cached' : 'fresh']);
        if (cachedFresh) { finishWrite(); await new Promise(setImmediate); }
    });
}

test('Also show E85 keeps gasoline available while the extra grade refreshes', async t => {
    let effect, finishE85;
    const queries = [], published = [];
    const hook = load('src/screens/cluster-lab/useClusterLabStations.js', {
        '../../lib/useNetworkStatus': { __esModule: true, default: () => ({ connected: true }) },
        react: { useEffect: fn => { effect = fn; }, useMemo: fn => fn(), useState: () => [null, () => {}] },
        'react-native': { AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } },
        'expo-location': {},
        '../../AppStateContext': { useAppState: () => ({ resolvedFuelSearchContext: { latitude: 28, longitude: -82 } }) },
        '../../PreferencesContext': { usePreferences: () => ({ preferences: { preferredOctane: 'premium', requiresE85: true, searchRadiusMiles: 5 } }) },
        '../../lib/deviceLocationCache': {},
        '../../services/fuel': {
            getCachedFuelPriceSnapshot: async query => { queries.push(query); return { source: `cached-${query.fuelType}` }; },
            refreshFuelPriceSnapshot: query => {
                queries.push(query);
                return query.fuelType === 'e85' ? new Promise(resolve => { finishE85 = resolve; }) : Promise.resolve({ snapshot: { source: 'fresh-premium' } });
            },
        },
        './stationCardModel': { buildLabStations: (main, options, extra) => { published.push([main.source, extra.source]); return []; } },
    }).default;
    hook(true); t.after(effect());
    await new Promise(setImmediate);
    assert.deepEqual(queries.map(q => q.fuelType), ['premium', 'e85', 'premium', 'e85']);
    assert(queries.every(q => q.requiresE85 === false));
    assert.deepEqual(published, [['cached-premium', 'cached-e85'], ['fresh-premium', 'cached-e85']]);
    finishE85({ snapshot: { source: 'fresh-e85' } });
    await new Promise(setImmediate);
    assert.deepEqual(published.at(-1), ['fresh-premium', 'fresh-e85']);
});
