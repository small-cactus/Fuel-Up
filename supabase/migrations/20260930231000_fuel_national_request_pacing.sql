-- Operator pacing, not a claimed provider quota. One global lease is retained.
alter table public.fuel_national_config add column request_interval_seconds integer not null default 15 check(request_interval_seconds between 5 and 300);
drop function public.claim_fuel_national_region_job(text);
create function public.claim_fuel_national_region_job(p_region text)
returns table(id bigint,run_id bigint,lease_token uuid,station_ids text[],execution_region text,request_interval_seconds integer)
language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg fuel_national_config; picked bigint;
begin
  if not exists(select 1 from fuel_national_regions where region=p_region and enabled) then raise exception 'Unknown or disabled execution region'; end if;
  select * into cfg from fuel_national_config where fuel_national_config.id for update;
  if not cfg.enabled or cfg.ends_at<=now() or cfg.provider_backoff_until>now() or cfg.last_request_at>now()-make_interval(secs=>cfg.request_interval_seconds) then return; end if;
  -- A denial already seen by the existing campaign also blocks national work.
  if exists(select 1 from fuel_research_campaigns where status='active' and provider_backoff_until>now()) then return; end if;
  if exists(select 1 from fuel_national_jobs where status='running' and lease_until>now())
    or exists(select 1 from fuel_discovery_jobs where status='running' and lease_until>now()) then return; end if;
  if (select coalesce(sum(archive_bytes),0) from fuel_national_jobs)+8000000>cfg.archive_budget_bytes then
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
end $$;
revoke all on function public.claim_fuel_national_region_job(text) from public,anon,authenticated,service_role;
grant execute on function public.claim_fuel_national_region_job(text) to service_role;
