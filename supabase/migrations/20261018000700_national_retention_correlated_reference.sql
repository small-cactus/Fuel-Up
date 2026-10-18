-- Preserve every retention boundary and protection; constrain only query planning.
CREATE OR REPLACE FUNCTION public.reconcile_fuel_national_retention()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare marked integer; removed integer:=0; picked bigint;
begin
 if not pg_try_advisory_xact_lock(71892300) then return jsonb_build_object('busy',true); end if;
 update fuel_national_jobs j set archive_deleted_at=now()
 from fuel_national_runs r,fuel_national_config c
 where j.run_id=r.id and c.continuous and r.slot_at>=c.operational_starts_at
  and r.slot_at>='2026-10-07T19:00:00Z'::timestamptz
  and r.deadline_at<now()-make_interval(hours=>c.operational_raw_hours)
  and r.status in ('complete','partial') and j.object_path is not null and j.archive_deleted_at is null
  and not exists(select 1 from storage.objects o where o.bucket_id='fuel-national' and o.name=j.object_path)
  and not exists(select 1 from fuel_national_trends_cache cache where cache.run_id=r.id);
 get diagnostics marked=row_count;
 -- Retain eight days of derived history for the seven-day app chart. Protect
 -- serving references and failed-run evidence; the compact historic research
 -- rows never enter this path. At most four old operational hours per invocation.
 for picked in select r.id from fuel_national_runs r cross join fuel_national_config c
  where c.continuous and r.slot_at>=c.operational_starts_at
   and r.slot_at>='2026-10-07T19:00:00Z'::timestamptz and r.deadline_at<now()-interval '8 days'
   and r.status in ('complete','partial')
   and not exists(select 1 from storage.objects o where o.bucket_id='fuel-national' and split_part(o.name,'/',1)=r.id::text)
   and not exists(select 1 from fuel_national_trends_cache cache where cache.run_id=r.id)
   -- Keep this existence check correlated to one candidate run. Without the
   -- optimization fence, a merge plan scans the entire current station cache.
   and not exists(select 1 from fuel_station_latest s join fuel_national_jobs j on j.id=s.job_id where j.run_id=r.id offset 0)
   and not exists(select 1 from fuel_national_jobs j join fuel_projection_repairs p on p.job_id=j.id where j.run_id=r.id and p.lease_until>now())
  order by r.slot_at limit 4 for update of r
 loop
  -- Preserve error evidence compactly without dangling foreign keys.
  update fuel_national_events set retained_job_id=job_id,retained_run_id=picked,job_id=null where job_id in(select id from fuel_national_jobs where run_id=picked);
  delete from fuel_projection_repairs where job_id in(select id from fuel_national_jobs where run_id=picked);
  delete from fuel_national_trend_batches where job_id in(select id from fuel_national_jobs where run_id=picked);
  delete from fuel_national_jobs where run_id=picked;
  delete from fuel_national_runs where id=picked;
  removed:=removed+1;
 end loop;
 return jsonb_build_object('marked_archives',marked,'removed_operational_hours',removed);
end $function$
;
