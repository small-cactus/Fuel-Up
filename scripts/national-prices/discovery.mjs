// Admin-only discovery controls. Provider access happens exclusively inside the
// region-pinned Supabase functions; this process never contacts GasBuddy.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { NATIONAL_REGIONS } from '../../supabase/functions/_shared/nationalRegions.mjs';
const query = sql => JSON.parse(execFileSync('npx', ['--no-install','supabase','db','query','--linked','--project-ref','vjindchxfebaltbslqwc',sql,'--output','json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })).rows;
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const action = process.argv[2] || 'status';
if (action === 'seed') {
  const tasks = [];
  for (const [region, { states }] of Object.entries(NATIONAL_REGIONS)) {
    for (let i=0; i<states.length; i+=4) tasks.push({ key: `bootstrap-20260930-${region}-${i}`, descriptor: { kind: 'states', states: states.slice(i,i+4) } });
  }
  const texas = JSON.parse(gunzipSync(readFileSync('docs/research/2026-09-30-national-prices/partial-texas-catalog.json.gz')));
  for (let i=0; i<texas.remainingBrands.length; i+=8) tasks.push({ key: `bootstrap-20260930-TX-brands-${i}`, descriptor: { kind: 'brands', state: 'TX', brandIds: texas.remainingBrands.slice(i,i+8).map(b=>Number(b.brandId)) } });
  const sql = 'begin;\n' + tasks.map(t=>`select enqueue_fuel_discovery(${literal(t.key)},${literal(JSON.stringify(t.descriptor))}::jsonb);`).join('\n')+'\ncommit;';
  query(sql); console.log(JSON.stringify({ seededTasks: tasks.length, enabled: false }));
} else if (action === 'status') {
  const rows = query(`select jsonb_build_object(
    'config',(select to_jsonb(c) from fuel_discovery_config c),
    'cooldown',(select provider_backoff_until from fuel_national_config),
    'jobs',(select jsonb_agg(jsonb_build_object('id',j.id,'key',task_key,'region',execution_region,'status',status,'attempts',attempts,'error',last_error,
      'scopes',(select jsonb_agg(s-'stations') from jsonb_array_elements(j.payload->'scopes') s))) from fuel_discovery_jobs j),
    'recentAttempts',(select jsonb_agg(a) from (select * from fuel_discovery_attempts order by id desc limit 20) a)
    ) as discovery;`);
  console.log(JSON.stringify(rows[0].discovery,null,2));
} else if (action === 'export') {
  const directory = process.argv[3]; if (!directory) throw Error('Export directory required');
  mkdirSync(directory,{recursive:true});
  const jobs = query('select id,task_key from fuel_discovery_jobs where status=\'succeeded\' order by id');
  for (const job of jobs) {
    const [{ payload }] = query(`select payload from fuel_discovery_jobs where id=${Number(job.id)}`);
    writeFileSync(`${directory}/${job.task_key}.json.gz`,gzipSync(JSON.stringify(payload)),{flag:'wx'});
    console.log(JSON.stringify({id:job.id,scopes:payload.scopes.map(s=>({state:s.state,returned:s.returnedCount,expected:s.reportedCount}))}));
  }
} else throw Error('Use seed, status, or export');
