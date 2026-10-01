import test from 'node:test';
import assert from 'node:assert/strict';
import { canUseFuelStation, normalizeFuelMemberships, requiredFuelMembership } from '../src/lib/fuelMemberships.js';
import { buildVisibleStations } from '../src/lib/visibleStations.js';
import { rankStationQuotes } from '../src/lib/stationPreferences.js';
import { US_STATES, normalizeUSState } from '../src/lib/usStates.js';
import { buildFuelSearchRequestKey } from '../src/lib/fuelSearchState.js';
import { createPreferencesStore } from '../src/lib/preferencesStore.js';
const q = (id,name,price,extra={}) => ({ stationId:id,stationName:name,price,fuelType:'regular',providerTier:'station',latitude:28,longitude:-82,updatedAt:new Date().toISOString(),...extra });
test('unselected clubs are excluded, Walmart+ grants Sam’s access, public lookalikes stay available',()=>{
 for(const name of ['Costco','Costco Gasoline',"Sam’s Club",'Sams Club Fuel',"BJ's", "BJ’s Wholesale Club",'BJs Gas']) assert.equal(canUseFuelStation(q('1',name,3)),false,name);
 assert.equal(canUseFuelStation(q('1',"Sam's Club",3),['walmart-plus']),true);
 assert.equal(canUseFuelStation(q('1','Costco',3),['walmart-plus']),false);
 for(const name of ["BJ's Quick Mart","Sam's Market",'Shell','Maverik']) assert.equal(canUseFuelStation(q('1',name,3)),true,name);
 assert.equal(requiredFuelMembership(q('1','Fuel',3,{brandNames:['Costco']})),'costco');
});
test('Home applies membership, radius and fresh raw quote gates before ranking',()=>{
 const stations=[q('club',"Sam's Club",2),q('public','Other',3),q('preferred','Shell',3.19),q('far','Shell',1,{latitude:29}),q('stale','Shell',1,{updatedAt:new Date(Date.now()-86400001).toISOString()})];
 const args={origin:{latitude:28,longitude:-82},radiusMiles:10,preferredBrands:['shell']};
 assert.deepEqual(buildVisibleStations({topStations:stations},args).map(s=>s.id),['preferred','public']);
 assert.deepEqual(buildVisibleStations({topStations:stations},{...args,fuelMemberships:['sams']}).map(s=>s.id),['club','preferred','public']);
 assert.equal(stations[2].price,3.19);
});
test('20-cent boundary honors preference only within advantage, with raw lower price winning exact ties',()=>{
 for(const [price,first] of [[3.199,'preferred'],[3.20,'cheap'],[3.201,'cheap'],[4,'cheap']]) {
  const result=rankStationQuotes([q('cheap','Other',3),q('preferred','Shell',price)],{preferredBrands:['shell']});
  assert.equal(result[0].stationId,first);assert.equal(result.find(q=>q.stationId==='preferred').price,price);
 }
});
test('all fifty states and DC normalize; unrelated regions never fall back to another state',()=>{
 assert.equal(US_STATES.length,51);
 for(const {code,name} of US_STATES){assert.equal(normalizeUSState(name),code);assert.equal(normalizeUSState(code.toLowerCase()),code);}
 assert.equal(normalizeUSState('Ontario'),null);
});
test('membership edits persist, normalize, and partition user-facing search keys',async()=>{
 let saved=null; const storage={getItem:async()=>saved,setItem:async(_,s)=>{saved=s;}};
 const store=createPreferencesStore(storage);await store.load();assert.deepEqual(store.getSnapshot().preferences.fuelMemberships,[]);
 await store.update({fuelMemberships:['sams','sams','invalid']});
 const next=createPreferencesStore(storage);await next.load();assert.deepEqual(next.getSnapshot().preferences.fuelMemberships,['sams']);
 assert.deepEqual(normalizeFuelMemberships(null),[]);
 const base={origin:{latitude:28,longitude:-82}};
 assert.notEqual(buildFuelSearchRequestKey(base),buildFuelSearchRequestKey({...base,fuelMemberships:['sams']}));
});
