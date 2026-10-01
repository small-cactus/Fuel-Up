// Provider-free comparison of public serving against exact stored observations.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
const cities=[['Clearwater',27.9659,-82.8001],['Tampa',27.9506,-82.4572],['New York',40.7128,-74.006],['Los Angeles',34.0522,-118.2437],['Seattle',47.6062,-122.3321],['Honolulu',21.3099,-157.8581],['Anchorage',61.2181,-149.9003]];
const sql='select * from ('+cities.map(([city,lat,lon])=>`select '${city}' as city, nearby_fuel_station_cache(${lat},${lon},15) as stations`).join(' union all ')+') checks';
const stored=JSON.parse(execFileSync('npx',['--no-install','supabase@2.118.0','db','query','--linked','--project-ref','vjindchxfebaltbslqwc',sql,'--output','json'],{encoding:'utf8',maxBuffer:32*1024*1024,stdio:['ignore','pipe','ignore']})).rows;
const {url,key}=JSON.parse(readFileSync('app.json')).expo.extra.supabase;
const checks=[];
for(const [city,latitude,longitude] of cities){
  const rows=stored.find(r=>r.city===city).stations;
  const startedAt=Date.now();
  const response=await fetch(url+'/functions/v1/gas-prices',{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json','x-region':'us-east-2'},body:JSON.stringify({latitude,longitude,radiusMiles:15,fuelType:'regular'}),signal:AbortSignal.timeout(30000)});
  assert.equal(response.status,200);
  const result=await response.json(), finishedAt=Date.now();
  const eligible=(q,now)=>Number.isFinite(q?.price)&&q.price>0&&Number.isFinite(Date.parse(q.postedTime))&&Date.parse(q.postedTime)<=now&&now-Date.parse(q.postedTime)<=86400000;
  const expected=new Map();let reported=0;
  for(const {station:s} of rows){
    const p=s.prices?.find(p=>p.fuelProduct==='regular_gas');
    if(p?.credit?.price>0||p?.cash?.price>0)reported++;
    const q=eligible(p?.credit,finishedAt)?p.credit:eligible(p?.cash,finishedAt)?p.cash:null;
    // Refuse an ambiguous boundary comparison rather than count it as a pass.
    for(const payment of [p?.credit,p?.cash])if(payment?.postedTime){const t=Date.parse(payment.postedTime)+86400000;assert(!(t>startedAt&&t<=finishedAt),'Report expired during comparison; rerun');}
    if(q)expected.set(String(s.id),q);
  }
  assert.equal(result.summary.pricePolicy,'reported-last-24-hours');
  assert.deepEqual(result.quotes.map(q=>q.stationId).sort(),[...expected.keys()].sort());
  for(const q of result.quotes){
    const raw=expected.get(q.stationId);assert.equal(q.price,raw.price);assert.equal(Date.parse(q.updatedAt),Date.parse(raw.postedTime));
    assert(!q.validation?.usedPrediction&&!q.isEstimated);
  }
  checks.push({city,radiusMiles:15,storedStations:rows.length,stationsWithRegularPrice:reported,eligibleReports:expected.size,served:result.quotes.length,exactIdsPricesAndTimestamps:true});
}
const report={verifiedAt:new Date().toISOString(),providerRequests:0,checks};
console.log(JSON.stringify(report,null,2));
if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');
