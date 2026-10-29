// Public app credentials only; no signed-in user, disk cache, previous visit or provider call.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const load=require('../../tests/helpers/loadComponent.cjs');
const {url,key}=JSON.parse(readFileSync('app.json')).expo.extra.supabase;
const grades=await import('../../src/lib/fuelGrade.js');
const home=await import('../../src/lib/homeState.js');
const preferences=await import('../../src/lib/stationPreferences.js');
const search=await import('../../src/lib/fuelSearchState.js');
const report=[];
for(const area of [
 {label:'Tampa',latitude:27.95,longitude:-82.45},
 {label:'Los Angeles',latitude:34.05,longitude:-118.24},
 {label:'Des Moines',latitude:41.59,longitude:-93.62},
]) {
 const timings=[];
 const invoke=async(name,{body})=>{
  const started=performance.now();
  const response=await fetch(`${url}/functions/v1/${name}`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json','x-region':'us-east-2'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
  const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));
  timings.push({scope:body.scope||'nearby',ms:Math.round(performance.now()-started),rows:data.rows?.length,quotes:data.quotes?.length});
  return {data,error:null};
 };
 const service=load('src/services/fuel/trends.js',{
  '../../lib/supabase.js':{supabase:{functions:{invoke}}},
  '../../lib/fuelGrade.js':grades,'../../lib/homeState.js':home,'../../lib/stationPreferences.js':preferences,'../../lib/fuelSearchState.js':search,
  './trendSnapshotStore':{trendSnapshotStore:{get:async()=>null,set:async()=>{},clear:async()=>{}}},
  './index':{getCachedFuelPriceSnapshot:async()=>null,getInFlightFuelPriceSnapshot:()=>null,
   refreshFuelPriceSnapshot:async query=>({snapshot:{topStations:(await invoke('gas-prices',{body:query})).data.quotes,fetchedAt:new Date().toISOString()}})},
 });
 const params={latitude:area.latitude,longitude:area.longitude,radiusMiles:10,fuelType:'regular'};
 assert.equal(service.getCachedTrendData(service.buildTrendRequestKey(params)),null);
 const result=await service.prefetchTrendData(params);
 assert(result.averagePricesByDay.length>=2,'First visit must show historical local observations');
 assert(result.leaderboard.length>0,'First visit must show local station prices');
 assert(result.mapHeatmapPoints.every(point=>Math.abs(point.latitude-area.latitude)<0.2&&Math.abs(point.longitude-area.longitude)<0.3),'Remote station leaked');
 report.push({area:area.label,history:result.averagePricesByDay,leaderboard:result.leaderboard.length,historyStations:result.mapHeatmapPoints.length,timings});
}
console.log(JSON.stringify(report,null,2));
if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify({verifiedAt:new Date().toISOString(),authentication:'public app key only; no user session',initialCaches:'empty',providerRequests:0,areas:report},null,2)+'\n');
