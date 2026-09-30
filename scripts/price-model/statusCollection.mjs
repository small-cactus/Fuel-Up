import { execFileSync } from 'node:child_process';

const sql = `select jsonb_build_object(
 'health',(select to_jsonb(h) from public.fuel_research_health h where id='hourly-24-cities-20260930-v1'),
 'cron',(select jsonb_agg(jsonb_build_object('name',jobname,'schedule',schedule,'active',active)) from cron.job where jobname like 'fuel-research-%'),
 'cities',(select jsonb_agg(c) from (select city_id,count(*) filter(where status='succeeded') as succeeded,count(*) filter(where status='missed') as missed,max(completed_at) as last_success from public.fuel_research_jobs where campaign_id='hourly-24-cities-20260930-v1' group by city_id order by city_id) c),
 'recent_errors',(select jsonb_agg(e) from (select city_id,last_error,attempts,due_at,status from public.fuel_research_jobs where campaign_id='hourly-24-cities-20260930-v1' and last_error is not null order by due_at desc limit 12) e),
 'database_bytes',pg_database_size(current_database())) as collection_status;`;
const output = execFileSync('npx', ['--no-install', 'supabase', 'db', 'query', '--linked', '--project-ref',
    'vjindchxfebaltbslqwc', sql, '--output', 'json'], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
const result = JSON.parse(output).rows[0].collection_status;
console.log(JSON.stringify(result, null, 2));
