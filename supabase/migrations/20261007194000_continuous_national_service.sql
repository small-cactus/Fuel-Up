-- Continuous app service is separate from the immutable completed research window.
-- Migration alone does not activate collection or change any provider budget.
alter table public.fuel_national_config
 add column continuous boolean not null default false,
 add column operational_starts_at timestamptz,
 add column operational_raw_hours integer not null default 48 check(operational_raw_hours=48),
 add constraint fuel_national_operational_boundary check(not continuous or
  (operational_starts_at is not null and operational_starts_at >= '2026-10-07T19:00:00Z'::timestamptz));
alter table public.fuel_national_jobs add column archive_deleted_at timestamptz;
alter table public.fuel_national_events add column retained_job_id bigint, add column retained_run_id bigint;

CREATE OR REPLACE FUNCTION public.begin_fuel_national_hour()
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare cfg fuel_national_config; cat fuel_national_catalogs; run bigint;
begin
  select * into cfg from fuel_national_config where id for update;
  update fuel_national_jobs j set status='missed',lease_until=null,last_error=coalesce(last_error,'HOUR_DEADLINE_MISSED')
    from fuel_national_runs r where r.id=j.run_id and r.deadline_at<=now() and j.status in ('queued','running');
  update fuel_national_runs set status='partial',completed_at=now() where status='running' and deadline_at<=now();
  if not cfg.enabled or cfg.starts_at>now() or (cfg.continuous and cfg.operational_starts_at>now()) then return null; end if;
  if cfg.ends_at is null or cfg.catalog_id is null then
    update fuel_national_config set enabled=false,halt_reason='INVALID_COLLECTION_CONFIGURATION' where fuel_national_config.id; return null;
  end if;
  if not cfg.continuous and cfg.ends_at<=now() then update fuel_national_config set enabled=false,halt_reason='COLLECTION_END' where fuel_national_config.id; return null; end if;
  select * into cat from fuel_national_catalogs where id=cfg.catalog_id;
  if cat.id is null or (not cfg.continuous and least(coalesce(cfg.catalog_valid_until,cat.created_at+interval '24 hours'),cat.created_at+interval '8 days')<=now()) or cat.station_count>cfg.approved_lookups_per_hour
    or cat.batch_count>cfg.max_requests_per_hour then
    update fuel_national_config set enabled=false,halt_reason='CATALOG_STALE_OR_BUDGET_INSUFFICIENT' where fuel_national_config.id; return null;
  end if;
  insert into fuel_national_runs(slot_at,deadline_at,catalog_id,expected_stations,expected_batches)
    values(date_trunc('hour',now()),case when cfg.continuous then date_trunc('hour',now())+interval '1 hour' else least(date_trunc('hour',now())+interval '1 hour',cfg.ends_at) end,cat.id,cat.station_count,cat.batch_count)
    on conflict(slot_at) do nothing;
  select id into run from fuel_national_runs where slot_at=date_trunc('hour',now());
  insert into fuel_national_jobs(run_id,catalog_id,ordinal)
    select run,b.catalog_id,b.ordinal from fuel_national_batches b join fuel_national_runs r on r.catalog_id=b.catalog_id where r.id=run
    on conflict(run_id,ordinal) do nothing;
  return run;
end $function$
;
CREATE OR REPLACE FUNCTION public.claim_fuel_national_region_job(p_region text)
 RETURNS TABLE(id bigint, run_id bigint, lease_token uuid, station_ids text[], execution_region text, request_interval_seconds integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare cfg fuel_national_config; picked bigint;
begin
  if not exists(select 1 from fuel_national_regions where region=p_region and enabled) then raise exception 'Unknown or disabled execution region'; end if;
  select * into cfg from fuel_national_config where fuel_national_config.id for update;
  if not cfg.enabled or (not cfg.continuous and cfg.ends_at<=now()) or cfg.provider_backoff_until>now() or cfg.last_request_at>now()-make_interval(secs=>cfg.request_interval_seconds) then return; end if;
  -- A denial already seen by the existing campaign also blocks national work.
  if exists(select 1 from fuel_research_campaigns where status='active' and provider_backoff_until>now()) then return; end if;
  if exists(select 1 from fuel_national_jobs where status='running' and lease_until>now())
    or exists(select 1 from fuel_discovery_jobs where status='running' and lease_until>now()) then return; end if;
  if public.fuel_national_archive_bytes()+8000000>cfg.archive_budget_bytes then
    update fuel_national_config set enabled=false,halt_reason='ARCHIVE_BUDGET_REACHED' where fuel_national_config.id; return;
  end if;
  select j.id into picked from fuel_national_jobs j join fuel_national_runs r on r.id=j.run_id join fuel_national_batches b on b.catalog_id=j.catalog_id and b.ordinal=j.ordinal
    where b.execution_region=p_region and r.status='running' and r.deadline_at>now() and j.next_attempt_at<=now() and j.attempts<3
      and (j.status='queued' or (j.status='running' and j.lease_until<=now())) order by j.id limit 1 for update of j;
  if picked is null then return; end if;
  if (select coalesce(sum(j.attempts),0) from fuel_national_jobs j join fuel_national_runs r on r.id=j.run_id where r.slot_at=date_trunc('hour',now()))>=cfg.max_requests_per_hour
    or (select coalesce(sum(j.attempts*cardinality(b.station_ids)),0) from fuel_national_jobs j join fuel_national_runs r on r.id=j.run_id join fuel_national_batches b on b.catalog_id=j.catalog_id and b.ordinal=j.ordinal where r.slot_at=date_trunc('hour',now()))
      +(select cardinality(b.station_ids) from fuel_national_jobs j join fuel_national_batches b on b.catalog_id=j.catalog_id and b.ordinal=j.ordinal where j.id=picked)>cfg.approved_lookups_per_hour then return; end if;
  update fuel_national_config set last_request_at=now() where fuel_national_config.id;
  return query update fuel_national_jobs j set execution_region=p_region,status='running',attempts=j.attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '90 seconds'
    from fuel_national_batches b where j.id=picked and b.catalog_id=j.catalog_id and b.ordinal=j.ordinal returning j.id,j.run_id,j.lease_token,b.station_ids,b.execution_region,cfg.request_interval_seconds;
end $function$
;
CREATE OR REPLACE FUNCTION public.watchdog_fuel_national()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
 if not exists(select 1 from fuel_national_config where enabled and (continuous or ends_at>now())) then return false; end if;
 if not exists(select 1 from cron.job where jobname='fuel-national-dispatch') then
   perform cron.schedule('fuel-national-dispatch','* * * * *','select public.dispatch_fuel_national()');
   insert into fuel_national_events(code) values('MAIN_SCHEDULE_RESTORED');
   return true;
 end if;
 return false;
end $function$
;
CREATE OR REPLACE FUNCTION public.fuel_national_archive_bytes()
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 select greatest(
   (select coalesce(sum(archive_bytes),0) from public.fuel_national_jobs where archive_deleted_at is null),
   (select coalesce(sum(case when metadata->>'size' ~ '^[0-9]+$' then (metadata->>'size')::bigint else 8000000 end),0)
    from storage.objects where bucket_id='fuel-national')
 )::bigint;
$function$
;

-- A single immutable boundary protects all original research objects, including
-- orphaned uploads. Never infer eligibility from Storage age alone.
create function public.fuel_national_retention_candidates() returns table(object_path text,slot_at timestamptz,deadline_at timestamptz,operational_starts_at timestamptz)
language sql stable security definer set search_path=public,pg_temp as $$
 select o.name,r.slot_at,r.deadline_at,c.operational_starts_at from storage.objects o
 join fuel_national_runs r on split_part(o.name,'/',1)=r.id::text
 cross join fuel_national_config c
 where c.continuous and r.slot_at>=c.operational_starts_at
  and r.slot_at>='2026-10-07T19:00:00Z'::timestamptz
  and r.deadline_at < now()-make_interval(hours=>c.operational_raw_hours)
  and r.status in ('complete','partial')
  and o.bucket_id='fuel-national' and o.name ~ '^[0-9]+/[0-9]+/[a-f0-9-]+\.json\.gz$'
  and not exists(select 1 from fuel_national_trends_cache cache where cache.run_id=r.id)
  and not exists(select 1 from fuel_national_jobs j join fuel_projection_repairs p on p.job_id=j.id
    where j.run_id=r.id and p.lease_until>now())
 order by r.slot_at,o.name limit 200;
$$;

-- Storage deletion goes through its API. Only acknowledge proven absent objects.
-- Retries after deletion but before this transaction are reconciled idempotently.
create function public.reconcile_fuel_national_retention() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
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
   and not exists(select 1 from fuel_station_latest s join fuel_national_jobs j on j.id=s.job_id where j.run_id=r.id)
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
end $$;

create function public.dispatch_fuel_national_retention() returns bigint
language plpgsql security definer set search_path=public,pg_temp as $$
declare endpoint text; secret text; request_id bigint;
begin
 if not exists(select 1 from fuel_national_config where continuous) then return null; end if;
 select decrypted_secret into endpoint from vault.decrypted_secrets where name='fuel_national_endpoint';
 select decrypted_secret into secret from vault.decrypted_secrets where name='fuel_research_secret';
 if endpoint is null or secret is null or endpoint!~'/fuel-national$' then raise exception 'Retention configuration missing'; end if;
 select net.http_post(url:=regexp_replace(endpoint,'/fuel-national$','/fuel-national-retention'),
 headers:=jsonb_build_object('Content-Type','application/json','x-fuel-research-key',secret,'x-region','us-east-1'),
 body:='{}'::jsonb,timeout_milliseconds:=55000) into request_id;
 return request_id;
end $$;
revoke all on function public.fuel_national_retention_candidates(),public.reconcile_fuel_national_retention(),public.dispatch_fuel_national_retention() from public,anon,authenticated,service_role;
grant execute on function public.fuel_national_retention_candidates(),public.reconcile_fuel_national_retention() to service_role;
