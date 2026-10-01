// Compare the public response with stored complete-sweep totals; cache-only.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const grades=['regular','midgrade','premium','diesel','e85'];
const sql=`select grade,filter_e85,national_fuel_trend_history(grade,filter_e85) history from unnest(array['regular','midgrade','premium','diesel','e85']) grade cross join unnest(array[false,true]) filter_e85`;
const rows=JSON.parse(execFileSync('npx',['--no-install','supabase@2.118.0','db','query','--linked','--project-ref','vjindchxfebaltbslqwc',sql,'--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']})).rows;
const {url,key}=JSON.parse(readFileSync('app.json')).expo.extra.supabase;
const checks=[];
for(const fuelType of grades)for(const requiresE85 of [false,true]){
 const response=await fetch(`${url}/functions/v1/gas-prices`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json','x-region':'us-east-2'},body:JSON.stringify({scope:'national',fuelType,requiresE85}),signal:AbortSignal.timeout(20000)});
 const result=await response.json();assert.equal(response.status,200);assert.equal(result.historyError,null);
 const expected=rows.find(r=>r.grade===fuelType&&r.filter_e85===requiresE85).history;
 assert(expected.length>=2,'National chart needs real history');
 // A new complete sweep may appear between reads; compare the fixed common history.
 for(const p of expected){const got=result.history.find(x=>x.date===p.date);assert.deepEqual(got,p);assert(got.price>0&&got.stationCount>0);}
 assert(result.quotes.length<=5);
 checks.push({fuelType,requiresE85,verifiedPoints:expected.length,latest:expected.at(-1)});
}
console.log(JSON.stringify({verifiedAt:new Date().toISOString(),providerRequests:0,checks},null,2));
