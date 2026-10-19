-- Explicit, expiring allowance for a user-authorized extra live verification.
-- Installing this migration does not authorize or start any provider requests.
create table public.fuel_national_verification_allowances (
 run_id bigint primary key references public.fuel_national_runs(id) on delete cascade,
 hour_at timestamptz not null,
 expires_at timestamptz not null,
 max_requests integer not null check(max_requests between 1 and 1000),
 max_lookups integer not null check(max_lookups>0),
 reason text not null,
 check(hour_at=date_trunc('hour',hour_at)),
 check(expires_at>hour_at and expires_at<=hour_at+interval '1 hour')
);
alter table public.fuel_national_verification_allowances enable row level security;
revoke all on public.fuel_national_verification_allowances from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.claim_fuel_national_region_job(p_region text)
 RETURNS TABLE(id bigint, run_id bigint, lease_token uuid, station_ids text[], execution_region text, request_interval_seconds integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare cfg fuel_national_config; picked bigint; allowance fuel_national_verification_allowances; picked_run bigint; picked_size integer; extra_requests integer; extra_lookups integer;
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
  select j.run_id,cardinality(b.station_ids) into picked_run,picked_size from fuel_national_jobs j
    join fuel_national_batches b using(catalog_id,ordinal) where j.id=picked;
  select * into allowance from fuel_national_verification_allowances a where a.run_id=picked_run;
  if found then
    if allowance.expires_at<=now() or allowance.hour_at<>date_trunc('hour',now()) then return; end if;
  end if;
    if (select coalesce(sum(attempts),0) from fuel_national_jobs j where j.run_id=picked_run)>=coalesce(allowance.max_requests,cfg.max_requests_per_hour)
      or (select coalesce(sum(j.attempts*cardinality(b.station_ids)),0) from fuel_national_jobs j
        join fuel_national_batches b using(catalog_id,ordinal) where j.run_id=picked_run)+picked_size>coalesce(allowance.max_lookups,cfg.approved_lookups_per_hour) then return; end if;
  select coalesce(sum(max_requests),0),coalesce(sum(max_lookups),0) into extra_requests,extra_lookups
    from fuel_national_verification_allowances where hour_at=date_trunc('hour',now()) and expires_at>now();
  -- Include off-hour verification runs in the real hourly budget. Never use the
  -- old equality filter, which would silently omit those requests from accounting.
  if (select coalesce(sum(j.attempts),0) from fuel_national_jobs j join fuel_national_runs r on r.id=j.run_id
      where r.slot_at>=date_trunc('hour',now()) and r.slot_at<date_trunc('hour',now())+interval '1 hour')>=cfg.max_requests_per_hour+extra_requests
    or (select coalesce(sum(j.attempts*cardinality(b.station_ids)),0) from fuel_national_jobs j
      join fuel_national_runs r on r.id=j.run_id join fuel_national_batches b on b.catalog_id=j.catalog_id and b.ordinal=j.ordinal
      where r.slot_at>=date_trunc('hour',now()) and r.slot_at<date_trunc('hour',now())+interval '1 hour')+picked_size>cfg.approved_lookups_per_hour+extra_lookups then return; end if;
  update fuel_national_config set last_request_at=now() where fuel_national_config.id;
  return query update fuel_national_jobs j set execution_region=p_region,status='running',attempts=j.attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '90 seconds'
    from fuel_national_batches b where j.id=picked and b.catalog_id=j.catalog_id and b.ordinal=j.ordinal returning j.id,j.run_id,j.lease_token,b.station_ids,b.execution_region,cfg.request_interval_seconds;
end $function$;
