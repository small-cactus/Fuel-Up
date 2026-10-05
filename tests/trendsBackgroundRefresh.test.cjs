const test=require('node:test');
const assert=require('node:assert/strict');
const React=require('react');
const {act,create}=require('react-test-renderer');
const load=require('./helpers/loadComponent.cjs');
global.IS_REACT_ACT_ENVIRONMENT=true;

test('refreshes on cold launch and foreground, waits for Home location, and does not refresh for Control Center', async () => {
    const calls=[];let listener,view;
    const services={
        buildTrendRequestKey:p=>JSON.stringify(p),
        clearTrendDataCache:()=>calls.push(['clearLocal']),
        restoreTrendData:async p=>calls.push(['restoreLocal',p]),
        prefetchTrendData:async p=>calls.push(['local',p]),
    };
    const national={
        clearNationalTrendsCache:()=>calls.push(['clearNational']),
        restoreNationalTrends:async p=>calls.push(['restoreNational',p]),
        prefetchNationalTrends:async p=>calls.push(['national',p]),
    };
    const hook=load('src/screens/trends/useTrendsBackgroundRefresh.js',{
        '../../services/fuel/trends':services,'../../services/fuel/nationalTrendsCache':national,
    });
    let state={resolvedFuelSearchContext:null,fuelResetToken:0};
    let preferences={preferences:{hasCompletedOnboarding:true},normalizedFuelSearchPreferences:{preferredOctane:'regular',searchRadiusMiles:6},isLoading:true};
    const Component=load('src/components/TrendsBackgroundRefresh.js',{
        'react-native':{AppState:{currentState:'active',addEventListener:(_,cb)=>{listener=cb;return{remove(){listener=null}}}}},
        '../AppStateContext':{useAppState:()=>state},
        '../PreferencesContext':{usePreferences:()=>preferences},
        '../screens/trends/useTrendsBackgroundRefresh':hook,
    }).default;
    const rerender=async()=>act(async()=>view.update(React.createElement(Component)));
    const count=kind=>calls.filter(c=>c[0]===kind).length;
    await act(async()=>{view=create(React.createElement(Component))});
    assert.equal(calls.length,0,'no speculative default-grade requests while preferences load');
    preferences={...preferences,isLoading:false};await rerender();
    assert.equal(count('national'),1);assert.equal(count('local'),0);
    state={...state,resolvedFuelSearchContext:{latitude:27.95,longitude:-82.45}};await rerender();
    assert.equal(count('local'),1);assert.equal(count('national'),1);
    await act(async()=>listener('inactive'));await act(async()=>listener('active'));
    assert.equal(count('local'),1);
    await act(async()=>listener('background'));await act(async()=>listener('active'));
    assert.equal(count('local'),2);assert.equal(count('national'),2);
    assert.equal(calls.find(c=>c[0]==='national')[1].force,true);
    preferences={...preferences,normalizedFuelSearchPreferences:{preferredOctane:'premium',requiresE85:true,searchRadiusMiles:12}};await rerender();
    assert.equal(count('local'),3);assert.equal(count('national'),3);
    assert.equal(calls.filter(c=>c[0]==='local').at(-1)[1].radiusMiles,12);
    state={...state,manualLocationOverride:{latitude:40,longitude:-74}};await rerender();
    assert.equal(calls.filter(c=>c[0]==='local').at(-1)[1].latitude,40);
    assert.equal(count('national'),3,'location changes do not reload national data');
    state={...state,fuelResetToken:1};await rerender();
    assert.equal(count('clearLocal'),1);assert.equal(count('clearNational'),1);
    await act(async()=>view.unmount());assert.equal(listener,null);
});
