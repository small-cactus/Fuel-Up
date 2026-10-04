// Immutable research-only export. No provider calls, configuration changes or holdout reads.
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
const root = resolve(process.argv[2]);
const cutoff = process.argv[3];
const holdout = '2026-10-05T18:19:00Z';
if (!cutoff || !Number.isFinite(Date.parse(cutoff)) || Date.parse(cutoff) > Date.parse(holdout)) throw Error('Invalid or reserved cutoff');
mkdirSync(root, { recursive: true });
const project = ['--linked', '--project-ref', 'vjindchxfebaltbslqwc'];
const manifestPath = join(root, 'manifest.json');
if (!existsSync(manifestPath)) {
 const sql = `select jsonb_build_object('exported_at',now(),'cutoff','${new Date(cutoff).toISOString()}',
 'batches',(select jsonb_agg(b) from fuel_national_batches b where catalog_id='4d220708-04f3-4c27-bdae-88d1aa45ebe2'),
 'runs',(select jsonb_agg(r order by slot_at) from fuel_national_runs r where slot_at<'${new Date(cutoff).toISOString()}' and deadline_at<='${new Date(cutoff).toISOString()}' and status in ('complete','partial')),
 'jobs',(select jsonb_agg(j) from (select j.id,j.run_id,j.ordinal,j.status,j.execution_region,j.started_at,j.observed_at,j.completed_at,j.object_path,j.sha256,j.archive_bytes,j.priced_count from fuel_national_jobs j join fuel_national_runs r on r.id=j.run_id where r.deadline_at<='${new Date(cutoff).toISOString()}' and r.status in ('complete','partial') and j.status='succeeded') j)) as manifest`;
 const data = JSON.parse(execFileSync('npx', ['--no-install','supabase@2.118.0','db','query',...project,sql,'--output','json'], {encoding:'utf8',maxBuffer:16e6,timeout:90000})).rows[0].manifest;
 writeFileSync(manifestPath, JSON.stringify(data), { flag:'wx' });
}
const manifest = JSON.parse(readFileSync(manifestPath));
if (Date.parse(manifest.cutoff) > Date.parse(cutoff)) throw Error('Existing export exceeds requested cutoff');
// Keys remain in process memory. Download directly from the authenticated Storage
// endpoint, avoiding the management gateway's per-file proxy and directory scan.
const keys = JSON.parse(execFileSync('npx',['--no-install','supabase@2.118.0','projects','api-keys','--project-ref','vjindchxfebaltbslqwc','--output','json'],{encoding:'utf8',timeout:60000}));
const serviceKey = keys.find(k => k.name === 'service_role')?.api_key;
if (!serviceKey) throw Error('Authorized Storage read credential unavailable');
const queue = [...manifest.runs];
const run = promisify(execFile);
let backoffUntil=0;
await Promise.all([0,1].map(async () => {
 while (queue.length) {
  const row = queue.shift();
  const marker = join(root, `${row.id}.downloaded`);
  if (existsSync(marker)) continue;
  if (!manifest.jobs.some(j => j.run_id === row.id)) {
   writeFileSync(marker, 'Empty preserved historical hour');
   continue;
  }
  for (const job of manifest.jobs.filter(j=>j.run_id===row.id)) {
   const path=join(root,job.object_path);
   const valid=bytes=>bytes.length===job.archive_bytes && createHash('sha256').update(bytes).digest('hex')===job.sha256;
   if(existsSync(path)&&valid(readFileSync(path)))continue;
   let saved=false;
   for(let attempt=0;attempt<4;attempt++) {
    const wait=backoffUntil-Date.now();if(wait>0)await new Promise(r=>setTimeout(r,wait));
    let response;
    try { response=await fetch(`https://vjindchxfebaltbslqwc.supabase.co/storage/v1/object/authenticated/fuel-national/${job.object_path}`,{headers:{Authorization:`Bearer ${serviceKey}`,apikey:serviceKey},signal:AbortSignal.timeout(60000)}); }
    catch {backoffUntil=Date.now()+2**attempt*5000;console.log(JSON.stringify({storage_retry:job.id,attempt:attempt+1,reason:'network_timeout'}));continue;}
    if(response.ok){const bytes=Buffer.from(await response.arrayBuffer());if(!valid(bytes))throw Error(`Archive integrity mismatch ${job.id}`);mkdirSync(resolve(path,'..'),{recursive:true});writeFileSync(path,bytes);saved=true;break;}
    if(response.status===401||response.status===403)throw Error(`Storage access denied ${response.status}`);
    const retry=response.headers.get('retry-after');const seconds=retry?(Number(retry)||Math.max(0,(Date.parse(retry)-Date.now())/1000)):2**attempt*5;
    backoffUntil=Date.now()+Math.max(5,seconds)*1000;
    if(response.status!==429&&response.status<500)throw Error(`Storage ${response.status} for ${job.id}`);
    await response.body?.cancel();
   }
   if(!saved)throw Error(`Storage retries exhausted ${job.id}`);
  }
  writeFileSync(marker, new Date().toISOString());
  console.log(JSON.stringify({downloaded:row.id,slot:row.slot_at,remaining:queue.length}));
 }
}));
