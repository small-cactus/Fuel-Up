// Incident-specific replay of four missing derived totals. Run from repository root.
// Existing RPC is insert-only/idempotent; no raw or serving prices are changed.
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {auditArchive} from '../../../scripts/national-prices/auditArchive.mjs';
const project='vjindchxfebaltbslqwc', runId=10114;
const cli=args=>execFileSync('npx',['--no-install','supabase@2.118.0',...args],{encoding:'utf8',maxBuffer:8_000_000,stdio:['ignore','pipe','pipe'],timeout:90000});
const query=sql=>JSON.parse(cli(['db','query','--linked','--project-ref',project,sql,'--output','json'])).rows;
const {run,jobs}=query(`select jsonb_build_object('run',(select to_jsonb(r) from fuel_national_runs r where id=${runId}), 'jobs',(select jsonb_agg(to_jsonb(j)||jsonb_build_object('station_ids',b.station_ids,'assigned_region',b.execution_region,'summary_present',t.job_id is not null)) from fuel_national_jobs j join fuel_national_batches b using(catalog_id,ordinal) left join fuel_national_trend_batches t on t.job_id=j.id and t.source_sha256=j.sha256 where j.run_id=${runId})) as manifest`)[0].manifest;
if(run.status!=='complete'||run.slot_at!=='2026-10-08T14:00:00+00:00'||jobs.length!==72||jobs.some(j=>j.status!=='succeeded'))throw Error('Unexpected or incomplete sweep');
const allowed=new Set([726235,726236,726237,726239]), missing=jobs.filter(j=>!j.summary_present);
if(missing.some(j=>!allowed.has(j.id))||missing.length>4)throw Error('Missing batches exceed incident scope');
const keys=JSON.parse(cli(['projects','api-keys','--project-ref',project,'--output','json']));
const key=keys.find(k=>k.name==='service_role')?.api_key;if(!key)throw Error('Protected access unavailable');
const directory=mkdtempSync(join(tmpdir(),'fuel-1447-replay-')), results=[];
try {
 for(const job of missing){
  if(job.assigned_region!==job.execution_region)throw Error('Wrong region');
  const path=join(directory,`${job.id}.json.gz`);
  cli(['storage','cp',`ss:///fuel-national/${job.object_path}`,path,'--linked','--project-ref',project,'--experimental']);
  const bytes=readFileSync(path),verified=auditArchive(bytes,job,run);
  const {stations}=JSON.parse(gunzipSync(bytes));
  const response=await fetch(`https://${project}.supabase.co/rest/v1/rpc/record_fuel_national_trend_batch`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({p_job_id:job.id,p_stations:stations.map(({id,prices})=>({id,prices}))}),signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error(`Summary ${job.id} failed HTTP ${response.status}`);
  await response.text();results.push({jobId:job.id,sha256:job.sha256,...verified});
 }
 const readback=query(`select count(*)::int as matching_batches from fuel_national_jobs j join fuel_national_trend_batches t on t.job_id=j.id and t.source_sha256=j.sha256 where j.run_id=${runId}`)[0];
 if(readback.matching_batches!==72)throw Error('Summary read-back incomplete');
 const report={verifiedAt:new Date().toISOString(),runId,providerRequests:0,rawWrites:0,servingPriceWrites:0,matchingBatches:readback.matching_batches,replayed:results};
 writeFileSync('docs/operations/2026-10-08-1447-database-stall/summary-repair.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({runId,replayed:results.length,matchingBatches:72,providerRequests:0}));
}finally{rmSync(directory,{recursive:true,force:true});}
