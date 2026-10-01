import test from 'node:test';
import assert from 'node:assert/strict';
import {getNationalLeaderboard} from '../supabase/functions/_shared/nationalLeaderboard.mjs';
const row=(id,price,age=1000)=>({station:{id,name:'Fixture',latitude:40,longitude:-100,prices:[{fuelProduct:'regular_gas',credit:{price,postedTime:new Date(Date.now()-age).toISOString()}}]},observedAt:new Date().toISOString()});
test('national serving uses only the protected cache RPC and preserves fresh reported values',async()=>{
 let calls=0;
 const result=await getNationalLeaderboard({input:{fuelType:'regular',requiresE85:true},db:{rpc:async(name,args)=>{
  calls++;if(name==='national_fuel_trend_history') return {data:[{date:'2026-10-01T00:00:00Z',price:3.25,stationCount:90000}]};assert.equal(name,'national_fuel_station_cache');assert.deepEqual(args,{p_fuel_type:'regular',p_requires_e85:true});
  return {data:[row('b',3.2),row('a',3.1),row('old',1,86400001)]};
 }}});
 assert.equal(calls,2);assert.equal(result.history[0].stationCount,90000);assert.equal(result.scope,'national');assert.deepEqual(result.quotes.map(q=>q.price),[3.1,3.2]);
 assert(result.quotes.every(q=>!('distanceMiles' in q)&&!q.isEstimated&&!q.validation));
});
test('national requests reject invalid grades and filters before reading the database',async()=>{
 for(const input of [{fuelType:'bogus'},{fuelType:'regular',requiresE85:'true'}])
  await assert.rejects(getNationalLeaderboard({input,db:{rpc(){assert.fail('invalid input reached DB');}}}),{code:'INVALID_INPUT'});
});
test('national empty data stays empty and failures do not use a provider fallback',async()=>{
 assert.deepEqual((await getNationalLeaderboard({input:{},db:{rpc:async()=>({data:[]})}})).quotes,[]);
 await assert.rejects(getNationalLeaderboard({input:{},db:{rpc:async()=>({error:{code:'down'}})}}),{code:'CACHE_UNAVAILABLE'});
});

test('history failures preserve the fresh leaderboard without inventing a chart',async()=>{
 const result=await getNationalLeaderboard({input:{},db:{rpc:async name=>name==='national_fuel_station_cache'?{data:[row('a',3)]}:{error:{code:'down'}}}});
 assert.equal(result.quotes.length,1);assert.deepEqual(result.history,[]);assert(result.historyError);
});
