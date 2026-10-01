// Seed/repair the app projection from existing immutable archives only.
// No provider calls, current-time relabelling, or modifications to raw history.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { auditArchive } from './auditArchive.mjs';

const project = ['--linked', '--project-ref', 'vjindchxfebaltbslqwc'];
const cli = args => execFileSync('npx', ['--no-install', 'supabase@2.118.0', ...args], {
  encoding: 'utf8', maxBuffer: 16_000_000, stdio: ['ignore', 'pipe', 'pipe'],
});
const sql = `select jsonb_agg(jsonb_build_object('job',to_jsonb(j)||jsonb_build_object('station_ids',b.station_ids),'run',to_jsonb(r))) as batches
from (select distinct on (j.catalog_id,j.ordinal) j.* from fuel_national_jobs j join fuel_national_config c on c.catalog_id=j.catalog_id
where j.status='succeeded' order by j.catalog_id,j.ordinal,j.observed_at desc) j
join fuel_national_batches b using(catalog_id,ordinal) join fuel_national_runs r on r.id=j.run_id`;
const batches = JSON.parse(cli(['db', 'query', ...project, sql, '--output', 'json'])).rows[0].batches;
if (!batches?.length) throw Error('No archived batches available');
const dir = mkdtempSync(join(tmpdir(), 'fuel-serving-'));
let verified = 0, published = 0;
try {
  for (const { job, run } of batches) {
    const path = join(dir, `batch-${job.id}.json.gz`);
    cli(['storage', 'cp', `ss:///fuel-national/${job.object_path}`, path, ...project, '--experimental']);
    const bytes = readFileSync(path);
    auditArchive(bytes, job, run);
    const { stations } = JSON.parse(gunzipSync(bytes));
    // Values are SQL literals, not shell text. This also safely handles names
    // containing quotes; no station content is executed or interpolated by a shell.
    const literal = JSON.stringify(stations).replaceAll("'", "''");
    const queryFile = join(dir, 'publish.sql');
    writeFileSync(queryFile, `select publish_fuel_station_batch(${Number(job.id)},'${literal}'::jsonb) as published;`);
    const result = JSON.parse(cli(['db', 'query', ...project, '--file', queryFile, '--output', 'json']));
    verified += stations.length; published += result.rows[0].published;
    console.log(JSON.stringify({ batch: job.ordinal, job: job.id, verified, published }));
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
} finally { rmSync(dir, { recursive: true, force: true }); }
console.log(JSON.stringify({ complete: true, batches: batches.length, verified, published }));
