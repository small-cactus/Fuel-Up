// Verify one immutable successful batch per region, even while a sweep is running.
// This is a recovery sample, never a claim that the entire hour is complete.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { auditArchive } from './auditArchive.mjs';
import { NATIONAL_REGIONS } from '../../supabase/functions/_shared/nationalRegions.mjs';

const [runId, output] = process.argv.slice(2);
if (!/^\d+$/.test(runId || '')) throw Error('Usage: auditRegionalSample.mjs RUN_ID [new-report.json]');
const project = ['--linked', '--project-ref', 'vjindchxfebaltbslqwc'];
const sql = `select jsonb_build_object(
 'run',(select to_jsonb(r) from fuel_national_runs r where id=${runId}),
 'jobs',(select jsonb_agg(sample) from (
  select distinct on (b.execution_region) to_jsonb(j)||jsonb_build_object(
   'station_ids',b.station_ids,'assigned_region',b.execution_region) as sample
  from fuel_national_jobs j join fuel_national_batches b using(catalog_id,ordinal)
  where j.run_id=${runId} and j.status='succeeded'
  order by b.execution_region,j.observed_at desc,j.id desc) selected)) as audit`;
const { run, jobs } = JSON.parse(execFileSync('npx', ['--no-install', 'supabase@2.118.0',
  'db', 'query', ...project, sql, '--output', 'json'],
{ encoding: 'utf8', maxBuffer: 2_000_000 })).rows[0].audit;
const expectedRegions = Object.keys(NATIONAL_REGIONS).sort();
if (String(run?.id) !== runId || JSON.stringify(jobs?.map(j => j.assigned_region).sort()) !== JSON.stringify(expectedRegions)) {
  throw Error('A successful batch from every assigned region is required');
}
const dir = mkdtempSync(join(tmpdir(), 'fuel-regional-audit-'));
try {
  const batches = [];
  for (const job of jobs) {
    if (job.execution_region !== job.assigned_region) throw Error('Wrong regional routing');
    const path = join(dir, `${job.id}.json.gz`);
    execFileSync('npx', ['--no-install', 'supabase@2.118.0', 'storage', 'cp',
      `ss:///fuel-national/${job.object_path}`, path, ...project, '--experimental'],
    { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1_000_000 });
    batches.push({ jobId: job.id, objectPath: job.object_path, sha256: job.sha256,
      ...auditArchive(readFileSync(path), job, run) });
  }
  const report = { auditedAt: new Date().toISOString(), runId: run.id, slotAt: run.slot_at,
    runStatusAtSelection: run.status, verified: true, providerRequests: 0, batches,
    limitation: 'One successful immutable batch per assigned region. Verifies hashes, exact IDs, prices schema and provenance; not full-hour completeness or pump truth.' };
  if (output) writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(report, null, 2));
} finally { rmSync(dir, { recursive: true, force: true }); }
