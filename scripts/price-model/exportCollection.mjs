import { execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { createGzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const output = process.argv[2];
if (!output) throw new Error('Usage: node scripts/price-model/exportCollection.mjs /absolute/output.json.gz');
const query = sql => JSON.parse(execFileSync('npx', ['--no-install', 'supabase@2.118.0', 'db', 'query', '--linked', '--project-ref',
    'vjindchxfebaltbslqwc', sql, '--output', 'json'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })).rows;
const campaign = 'hourly-24-cities-20260930-v1';
const metadata = query(`select now() as cutoff,(select to_jsonb(h) from public.fuel_research_health h where id='${campaign}') as health;`)[0];
const cutoff = new Date(metadata.cutoff).toISOString();
let count = 0;
async function* records() {
    yield `{"version":1,"campaign":${JSON.stringify(campaign)},"exportCutoff":${JSON.stringify(cutoff)},"health":${JSON.stringify(metadata.health)},"snapshots":[`;
    let lastId = 0;
    while (true) {
        const rows = query(`select s.job_id,j.city_id,j.latitude,j.longitude,j.slot_at,j.due_at,s.started_at,s.observed_at,s.payload
          from public.fuel_research_snapshots s join public.fuel_research_jobs j on j.id=s.job_id
          where j.campaign_id='${campaign}' and s.saved_at<='${cutoff}' and s.job_id>${lastId}
          order by s.job_id limit 100;`);
        if (!rows.length) break;
        for (const row of rows) { yield (count++ ? ',' : '') + JSON.stringify(row); }
        lastId = Number(rows.at(-1).job_id);
        if (!Number.isSafeInteger(lastId)) throw new Error('Invalid pagination cursor');
    }
    yield ']}\n';
}
await pipeline(Readable.from(records()), createGzip(), createWriteStream(output, { flags: 'wx', mode: 0o600 }));
console.log(JSON.stringify({ output, snapshots: count, exportCutoff: cutoff }));
