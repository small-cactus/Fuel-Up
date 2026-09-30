-- Price freshness stays hourly. A verified station-ID cohort can be explicitly
-- retained through a bounded research window without pretending it was re-enumerated.
alter table public.fuel_national_config add column starts_at timestamptz;
alter table public.fuel_national_config add column catalog_valid_until timestamptz;
create or replace function public.begin_fuel_national_hour() returns bigint
language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg fuel_national_config; cat fuel_national_catalogs; run bigint;
begin
  select * into cfg from fuel_national_config where id for update;
  update fuel_national_jobs j set status='missed',lease_until=null,last_error=coalesce(last_error,'HOUR_DEADLINE_MISSED')
    from fuel_national_runs r where r.id=j.run_id and r.deadline_at<=now() and j.status in ('queued','running');
  update fuel_national_runs set status='partial',completed_at=now() where status='running' and deadline_at<=now();
  if not cfg.enabled or cfg.starts_at>now() then return null; end if;
  if cfg.ends_at is null or cfg.catalog_id is null then
    update fuel_national_config set enabled=false,halt_reason='INVALID_COLLECTION_CONFIGURATION' where fuel_national_config.id; return null;
  end if;
  if cfg.ends_at<=now() then update fuel_national_config set enabled=false,halt_reason='COLLECTION_END' where fuel_national_config.id; return null; end if;
  select * into cat from fuel_national_catalogs where id=cfg.catalog_id;
  if cat.id is null or least(coalesce(cfg.catalog_valid_until,cat.created_at+interval '24 hours'),cat.created_at+interval '8 days')<=now() or cat.station_count>cfg.approved_lookups_per_hour
    or cat.batch_count>cfg.max_requests_per_hour then
    update fuel_national_config set enabled=false,halt_reason='CATALOG_STALE_OR_BUDGET_INSUFFICIENT' where fuel_national_config.id; return null;
  end if;
  insert into fuel_national_runs(slot_at,deadline_at,catalog_id,expected_stations,expected_batches)
    values(date_trunc('hour',now()),least(date_trunc('hour',now())+interval '1 hour',cfg.ends_at),cat.id,cat.station_count,cat.batch_count)
    on conflict(slot_at) do nothing;
  select id into run from fuel_national_runs where slot_at=date_trunc('hour',now());
  insert into fuel_national_jobs(run_id,catalog_id,ordinal)
    select run,b.catalog_id,b.ordinal from fuel_national_batches b join fuel_national_runs r on r.catalog_id=b.catalog_id where r.id=run
    on conflict(run_id,ordinal) do nothing;
  return run;
end $$;

create function public.watchdog_fuel_national() returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from fuel_national_config where enabled and ends_at>now()) then return false; end if;
 if not exists(select 1 from cron.job where jobname='fuel-national-dispatch') then
   perform cron.schedule('fuel-national-dispatch','* * * * *','select public.dispatch_fuel_national()');
   insert into fuel_national_events(code) values('MAIN_SCHEDULE_RESTORED');
   return true;
 end if;
 return false;
end $$;
revoke all on function public.watchdog_fuel_national() from public,anon,authenticated,service_role;
