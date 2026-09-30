import { execFileSync } from 'node:child_process';
const sql = `select jsonb_build_object(
 'config',(select to_jsonb(c) from public.fuel_national_config c),
 'regions',(select jsonb_agg(r) from public.fuel_national_regions r),
 'regional_hours',(select jsonb_agg(h) from (select * from public.fuel_national_regional_health order by slot_at desc limit 72) h),
 'cron',(select jsonb_agg(jsonb_build_object('name',jobname,'active',active,'schedule',schedule)) from cron.job where jobname='fuel-national-dispatch'),
 'hours',(select jsonb_agg(h) from (select * from public.fuel_national_health order by slot_at desc limit 24) h),
 'events',(select jsonb_agg(e) from (select created_at,job_id,code,retry_after_seconds from public.fuel_national_events order by id desc limit 20) e)
) as status;`;
const result = execFileSync('npx', ['--no-install','supabase','db','query','--linked','--project-ref','vjindchxfebaltbslqwc',sql,'--output','json'], { encoding: 'utf8' });
console.log(JSON.stringify(JSON.parse(result).rows[0].status, null, 2));
