import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStationBrandOptions, normalizePreferredBrands, rankStationQuotes, stationOffersE85 } from '../src/lib/stationPreferences.js';
import { buildFuelSearchRequestKey, normalizeFuelSearchPreferences } from '../src/lib/fuelSearchState.js';
import { createPreferencesStore, PREFERENCES_STORAGE_KEY } from '../src/lib/preferencesStore.js';
const quote = (id, brand, price, extra = {}) => ({ stationId: id, stationName: brand, providerTier: 'station', fuelType: 'premium', price, allPrices: { premium: price }, distanceMiles: 1, ...extra });
test('preferred brand advantage is bounded and never changes prices', () => {
    const input = [quote('a','Other',2),quote('b','Shell',5),quote('c','Shell',4)];
    const ranked = rankStationQuotes(input, { preferredBrands: [' SHELL '] });
    assert.deepEqual(ranked.map(q=>q.stationId),['a','c','b']);
    assert.deepEqual(input.map(q=>q.stationId),['a','b','c']);
    assert.equal(ranked[2],input[1]);
});
test('E85 requires explicit availability and remains independent of selected fuel and brands', () => {
    const input = [quote('a','Shell',3),quote('b','Other',4,{allPrices:{premium:4,e85:2.5}}),quote('c','Shell',5,{availableFuelGrades:['premium','e85']})];
    assert.deepEqual(rankStationQuotes(input,{requiresE85:true,preferredBrands:['shell']}).map(q=>q.stationId),['b','c']);
    assert.equal(stationOffersE85({stationName:'E85 Depot'}),false);
    assert.equal(stationOffersE85({allPrices:{e85:0}}),false);
    assert.equal(stationOffersE85({fuelType:'e85',price:2}),true);
});
test('brand discovery counts unique selected-grade stations inside actual current radius', () => {
    const input=[quote('a','Shop',3,{brandNames:['Shell'],latitude:0,longitude:0}),quote('a','Shop',3,{brandNames:['Shell'],latitude:0,longitude:0}),quote('b','Shell',4,{latitude:0,longitude:0.01}),quote('c','BP',4,{latitude:0,longitude:0}),quote('far','BP',3,{latitude:0,longitude:1}),quote('wrong','BP',3,{fuelType:'diesel',allPrices:{diesel:3},latitude:0,longitude:0})];
    assert.deepEqual(buildStationBrandOptions(input,{latitude:0,longitude:0,radiusMiles:2,fuelGrade:'premium'}),[{id:'shell',label:'Shell',count:2},{id:'bp',label:'BP',count:1}]);
    assert.deepEqual(buildStationBrandOptions(input,{latitude:0,longitude:0,radiusMiles:2,fuelGrade:'premium',requiresE85:true}),[]);
});
test('keys separate E85 and brands and canonicalize order', () => {
    const base={origin:{latitude:27.95,longitude:-82.45},fuelGrade:'premium',radiusMiles:10};
    assert.notEqual(buildFuelSearchRequestKey(base),buildFuelSearchRequestKey({...base,requiresE85:true}));
    assert.notEqual(buildFuelSearchRequestKey(base),buildFuelSearchRequestKey({...base,preferredBrands:['Shell']}));
    assert.equal(buildFuelSearchRequestKey({...base,preferredBrands:['Shell','BP']}),buildFuelSearchRequestKey({...base,preferredBrands:['bp',' shell ']}));
    assert.deepEqual(normalizePreferredBrands([' Shell ','SHELL',false,'',null]),['shell']);
    assert.equal(normalizeFuelSearchPreferences({requiresE85:'false'}).requiresE85,false);
});
test('clean setup and relaunch retain grade, radius, brands and E85 together', async()=>{
    const values=new Map();
    const storage={getItem:async key=>values.get(key),setItem:async(key,value)=>values.set(key,value)};
    const first=createPreferencesStore(storage); await first.load();
    await first.update({hasCompletedOnboarding:true,preferredOctane:'premium',searchRadiusMiles:7,preferredBrands:['Shell','BP'],requiresE85:true});
    const second=createPreferencesStore(storage); await second.load();
    assert.deepEqual(second.getSnapshot().preferences,JSON.parse(values.get(PREFERENCES_STORAGE_KEY)));
    assert.deepEqual(second.getSnapshot().preferences.preferredBrands,['bp','shell']);
    assert.equal(second.getSnapshot().preferences.requiresE85,true);
});
