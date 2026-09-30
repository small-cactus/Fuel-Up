import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { auditArchive } from './auditArchive.mjs';

const [runId,output] = process.argv.slice(2);
if(!/^\d+$/.test(runId||''))throw Error('Usage: node scripts/national-prices/auditHour.mjs RUN_ID [new-report.json]');
const project=['--linked','--project-ref','vjindchxfebaltbslqwc'];
const sql=`select jsonb_build_object('run',(select to_jsonb(r) from fuel_national_runs r where id=${runId}),
 'jobs',(select jsonb_agg(to_jsonb(j)||jsonb_build_object('station_ids',b.station_ids)) from fuel_national_jobs j join fuel_national_batches b using(catalog_id,ordinal) where j.run_id=${runId})) as audit`;
const {run,jobs}=JSON.parse(execFileSync('npx',['--no-install','supabase','db','query',...project,sql,'--output','json'],{encoding:'utf8',maxBuffer:8_000_000})).rows[0].audit;
if(run?.status!=='complete'||jobs?.length!==run.expected_batches||jobs.some(j=>j.status!=='succeeded'))throw Error('Hour is not complete');
const dir=mkdtempSync(join(tmpdir(),'fuel-national-audit-'));
try {
 execFileSync('npx',['--no-install','supabase','storage','cp','--recursive',`ss:///fuel-national/${runId}`,dir,...project,'--experimental','--jobs','4'],{stdio:['ignore','pipe','pipe'],maxBuffer:1_000_000});
 const files=new Map();
 const walk=path=>{for(const entry of readdirSync(path,{withFileTypes:true})){const full=join(path,entry.name);if(entry.isDirectory())walk(full);else {if(files.has(entry.name))throw Error('Ambiguous archive filename');files.set(entry.name,full);}}};walk(dir);
 const seen=new Set(),regional={};let bytes=0,priced=0;
 const batches=jobs.map(j=>{
  const path=files.get(basename(j.object_path));if(!path)throw Error(`Missing object for job ${j.id}`);
  const result=auditArchive(readFileSync(path),j,run);
  for(const id of j.station_ids){if(seen.has(id))throw Error('Duplicate station across batches');seen.add(id);}
  bytes+=result.bytes;priced+=result.priced;regional[j.execution_region]=(regional[j.execution_region]||0)+result.stations;
  return {jobId:j.id,sha256:j.sha256,...result};
 });
 if(seen.size!==run.expected_stations)throw Error('Nationwide coverage mismatch');
 const report={auditedAt:new Date().toISOString(),runId:run.id,slotAt:run.slot_at,verified:true,stationCount:seen.size,pricedCount:priced,
  unpricedCount:seen.size-priced,archiveBytes:bytes,regional,batches,
  limitation:'Verifies archived provider observations and regional provenance; does not verify current pump prices or undocumented provider inventory completeness.'};
 if(output)writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({...report,batches:report.batches.length},null,2));
}finally{rmSync(dir,{recursive:true,force:true});}
