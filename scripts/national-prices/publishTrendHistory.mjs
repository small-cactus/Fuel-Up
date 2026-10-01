// Rebuild compact chart totals from verified immutable archives, never the provider.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { auditArchive } from './auditArchive.mjs';
const [output, ...localRoots] = process.argv.slice(2);
const project = ['--linked', '--project-ref', 'vjindchxfebaltbslqwc'];
const cli = args => execFileSync('npx', ['--no-install', 'supabase@2.118.0', ...args], {encoding:'utf8',maxBuffer:16_000_000,stdio:['ignore','pipe','pipe']});
// Keep service credentials in memory only; never print or persist them.
const apiKeys = JSON.parse(cli(['projects','api-keys','--project-ref','vjindchxfebaltbslqwc','--output','json']));
const serviceKey = apiKeys.find(key => key.name === 'service_role')?.api_key;
if(!serviceKey)throw Error('Protected database access unavailable');
const query = sql => JSON.parse(cli(['db','query',...project,sql,'--output','json'])).rows;
const runs = query(`select id from fuel_national_runs r where status='complete' and slot_at>=now()-interval '7 days'
 and (select count(*) from fuel_national_jobs j join fuel_national_trend_batches t on t.job_id=j.id and t.source_sha256=j.sha256 where j.run_id=r.id)<r.expected_batches order by slot_at`);
const files = new Map();
const walk = path => {for(const e of readdirSync(path,{withFileTypes:true})){const full=join(path,e.name);if(e.isDirectory())walk(full);else if(e.name.endsWith('.json.gz'))files.set(e.name,full);}};
for(const root of localRoots) if(existsSync(root)) walk(root);
const dir = mkdtempSync(join(tmpdir(),'fuel-trend-history-'));
const verified = [];
try {
 for(const {id} of runs) {
  const {run,jobs} = query(`select jsonb_build_object('run',(select to_jsonb(r) from fuel_national_runs r where id=${Number(id)}),
   'jobs',(select jsonb_agg(to_jsonb(j)||jsonb_build_object('station_ids',b.station_ids,'assigned_region',b.execution_region)) from fuel_national_jobs j join fuel_national_batches b using(catalog_id,ordinal) where j.run_id=${Number(id)})) as manifest`)[0].manifest;
  if(run.status!=='complete'||jobs.length!==run.expected_batches||jobs.some(j=>j.status!=='succeeded'))throw Error('Incomplete sweep');
  if(jobs.some(j=>!files.has(basename(j.object_path)))){
   cli(['storage','cp','--recursive',`ss:///fuel-national/${id}`,dir,...project,'--experimental','--jobs','4']);walk(dir);
  }
  const seen = new Set();let stationCount=0;
  const publish = async (jobId,stations) => {
   const response=await fetch('https://vjindchxfebaltbslqwc.supabase.co/rest/v1/rpc/record_fuel_national_trend_batch',{
    method:'POST',headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,'Content-Type':'application/json'},
    body:JSON.stringify({p_job_id:jobId,p_stations:stations}),signal:AbortSignal.timeout(60000)});
   if(!response.ok)throw Error(`History publication failed for job ${jobId}: HTTP ${response.status}`);
   await response.text();
  };
  const batches=[];
  for(const job of jobs){
   if(job.assigned_region!==job.execution_region)throw Error('Wrong region');
   const bytes=readFileSync(files.get(basename(job.object_path)));
   const audit=auditArchive(bytes,job,run);
   for(const stationId of job.station_ids){if(seen.has(stationId))throw Error('Duplicate station across batches');seen.add(stationId);}
   const {stations}=JSON.parse(gunzipSync(bytes));
   await publish(Number(job.id),stations.map(({id,prices})=>({id,prices})));
   stationCount+=audit.stations;batches.push({jobId:job.id,sha256:job.sha256,stations:audit.stations,executionRegion:audit.executionRegion});
  }
  if(stationCount!==run.expected_stations)throw Error('Station coverage mismatch');
  verified.push({runId:id,slotAt:run.slot_at,stationCount,batches});
  console.log(JSON.stringify({runId:id,verifiedBatches:batches.length,stationCount}));
 }
 const report={verifiedAt:new Date().toISOString(),providerRequests:0,runs:verified,scope:'Derived fresh reported averages from complete archived sweeps; no estimates or verified pump truth.'};
 if(output)writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
}finally{rmSync(dir,{recursive:true,force:true});}
