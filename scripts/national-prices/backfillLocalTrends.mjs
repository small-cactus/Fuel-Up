// Populate only derived local daily history from retained, hash-verified archives.
// No provider access; leaves research, raw objects and national summaries untouched.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { auditArchive } from './auditArchive.mjs';
const output = process.argv[2];
if (!output) throw Error('An evidence output path is required');
const cli = args => JSON.parse(execFileSync('npx',['--no-install','supabase@2.118.0',...args,'--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:8000000}));
const query = sql => cli(['db','query','--linked','--project-ref','vjindchxfebaltbslqwc',sql]).rows;
const keys = cli(['projects','api-keys','--project-ref','vjindchxfebaltbslqwc']);
const key = keys.find(k=>k.name==='service_role')?.api_key;
if (!key) throw Error('Protected access unavailable');
const headers={apikey:key,Authorization:`Bearer ${key}`};
const base='https://vjindchxfebaltbslqwc.supabase.co';
const runs=query(`select distinct on ((slot_at at time zone 'UTC')::date) * from fuel_national_runs r
 where status='complete' and slot_at>=now()-interval '46 hours'
 and not exists(select 1 from fuel_national_jobs j where j.run_id=r.id and (j.status<>'succeeded' or j.archive_deleted_at is not null))
 order by (slot_at at time zone 'UTC')::date,slot_at`);
const report={at:new Date().toISOString(),providerRequests:0,sampling:'first available complete retained sweep per UTC day',runs:[]};
for(const run of runs){
 const jobs=query(`select j.*,b.station_ids,b.execution_region assigned_region from fuel_national_jobs j join fuel_national_batches b using(catalog_id,ordinal) where run_id=${Number(run.id)} order by ordinal`);
 if(jobs.length!==run.expected_batches||jobs.some(j=>j.execution_region!==j.assigned_region))throw Error('Incomplete or misrouted manifest');
 const result={runId:run.id,slotAt:run.slot_at,batches:[],inserted:0};
 // Serial publication keeps replay pressure bounded on the shared database.
 for(const job of jobs){
  const response=await fetch(`${base}/storage/v1/object/authenticated/fuel-national/${job.object_path}`,{headers,signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error(`Archive read HTTP ${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer()); auditArchive(bytes,job,run);
  const {stations}=JSON.parse(gunzipSync(bytes));
  const started=performance.now();
  const saved=await fetch(`${base}/rest/v1/rpc/record_fuel_local_daily_prices`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({p_job_id:job.id,p_stations:stations.map(({id,prices})=>({id,prices}))}),signal:AbortSignal.timeout(45000)});
  if(!saved.ok)throw Error(`Derived history publication HTTP ${saved.status}: ${await saved.text()}`);
  const inserted=await saved.json();result.inserted+=inserted;
  result.batches.push({jobId:job.id,sha256:job.sha256,stations:stations.length,inserted,ms:Math.round(performance.now()-started)});
  console.log(JSON.stringify({runId:run.id,ordinal:job.ordinal,inserted,ms:result.batches.at(-1).ms}));
 }
 report.runs.push(result);
 writeFileSync(output,JSON.stringify(report,null,2)+'\n');
}
