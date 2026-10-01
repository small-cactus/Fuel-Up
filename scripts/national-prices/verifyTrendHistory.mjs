// Compare the public response with stored complete-sweep totals; cache-only.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { auditArchive } from './auditArchive.mjs';
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
 for(const p of expected){const got=result.history.find(x=>x.date===p.date);assert.deepEqual(got,{date:p.date,price:p.price,stationCount:p.stationCount});assert(got.price>0&&got.stationCount>0);}
 assert(result.quotes.length<=5);
 checks.push({fuelType,requiresE85,verifiedPoints:expected.length,latest:expected.at(-1)});
}
const archiveDirectory=process.argv[2];
let independentArchiveCheck=null;
if(archiveDirectory){
 const {run,jobs}=JSON.parse(readFileSync(join(archiveDirectory,'manifest.json')));
 const files=new Map();
 const walk=path=>{for(const e of readdirSync(path,{withFileTypes:true})){const full=join(path,e.name);if(e.isDirectory())walk(full);else files.set(e.name,full);}};walk(archiveDirectory);
 const totals=new Map();
 for(const job of jobs){
  const bytes=readFileSync(files.get(basename(job.object_path)));auditArchive(bytes,job,run);
  const now=Date.parse(job.observed_at);
  for(const station of JSON.parse(gunzipSync(bytes)).stations){
   const selected=new Map();
   for(const entry of station.prices){
    const quote=[entry.credit,entry.cash].find(q=>typeof q?.price==='number'&&q.price>0&&Number.isFinite(Date.parse(q.postedTime))&&Date.parse(q.postedTime)<=now&&now-Date.parse(q.postedTime)<=86400000);
    if(quote)selected.set(entry.fuelProduct,quote.price);
   }
   for(const grade of grades){
    const product=['regular','midgrade','premium'].includes(grade)?`${grade}_gas`:grade;
    const price=selected.get(product);if(!price)continue;
    const lower=grade==='premium'?['regular_gas','midgrade_gas']:grade==='midgrade'?['regular_gas']:[];
    if(lower.some(p=>Math.round(selected.get(p)*1000)===Math.round(price*1000)))continue;
    for(const requiresE85 of [false,true]){
     if(requiresE85&&!selected.has('e85'))continue;
     const key=`${grade}:${requiresE85}`,total=totals.get(key)||{sum:0,count:0};total.sum+=price;total.count++;totals.set(key,total);
    }
   }
  }
 }
 for(const row of rows){
  const point=row.history.find(p=>Date.parse(p.date)===Date.parse(run.slot_at));
  const expected=totals.get(`${row.grade}:${row.filter_e85}`);
  assert(point&&expected);assert.equal(point.stationCount,expected.count);
  assert(Math.abs(point.price-expected.sum/expected.count)<1e-9,'SQL average differs from independent raw-archive average');
 }
 independentArchiveCheck={runId:run.id,verifiedBatches:jobs.length,gradeAndE85Combinations:rows.length,matched:true};
}
console.log(JSON.stringify({verifiedAt:new Date().toISOString(),providerRequests:0,checks,independentArchiveCheck},null,2));
