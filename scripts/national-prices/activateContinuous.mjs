// Explicit operator activation of the continuous app feed. It leaves the
// completed research window, identity, routing, pacing and budgets unchanged.
import { execFileSync } from 'node:child_process';
const sql = `begin;
do $$ declare cfg fuel_national_config; cat fuel_national_catalogs; begin
 select * into cfg from fuel_national_config where id for update;
 if cfg.enabled or cfg.continuous then raise exception 'Already active/configured; inspect instead of reactivating'; end if;
 if cfg.halt_reason<>'COLLECTION_END' or cfg.ends_at>now() then raise exception 'Only a completed campaign can enter operational mode'; end if;
 if cfg.provider_backoff_until>now() or exists(select 1 from fuel_research_campaigns where status='active' and provider_backoff_until>now()) then raise exception 'Shared cooldown is active'; end if;
 if exists(select 1 from fuel_national_events where code in ('UPSTREAM_HTTP_401','UPSTREAM_HTTP_403','UPSTREAM_GRAPHQL_ERROR','GRAPHQL_ERROR')
  and created_at>coalesce((select max(completed_at) from fuel_national_jobs where status='succeeded'),'-infinity'::timestamptz)) then raise exception 'Unresolved provider denial'; end if;
 if exists(select 1 from fuel_discovery_jobs where status='running' and lease_until>now()) then raise exception 'Discovery is in flight'; end if;
 select * into cat from fuel_national_catalogs where id=cfg.catalog_id;
 if cat.id is null or cat.region_count<>51 or cat.station_count>cfg.approved_lookups_per_hour or cat.batch_count>cfg.max_requests_per_hour then raise exception 'Invalid catalog or provider budget'; end if;
 if fuel_national_archive_bytes()+8000000>cfg.archive_budget_bytes then raise exception 'Storage capacity stop'; end if;
 if not exists(select 1 from vault.secrets where name='fuel_research_secret') then raise exception 'Worker authentication missing'; end if;
 update fuel_discovery_config set enabled=false where id;
 update fuel_national_config set continuous=true,enabled=true,halt_reason='ACTIVE_CONTINUOUS_FIXED_INVENTORY',
  operational_starts_at=case when date_trunc('hour',now())+interval '1 hour'-now()>interval '22 minutes'
    then date_trunc('hour',now()) else date_trunc('hour',now())+interval '1 hour' end where id;
 insert into fuel_national_events(code) values('CONTINUOUS_FIXED_INVENTORY_ACTIVATED');
end $$;
select cron.schedule('fuel-national-dispatch','* * * * *','select public.dispatch_fuel_national();');
select cron.schedule('fuel-national-watchdog','*/5 * * * *','select public.watchdog_fuel_national();');
select cron.schedule('fuel-national-retention','*/10 * * * *','select public.dispatch_fuel_national_retention();');
commit;
select enabled,continuous,operational_starts_at,operational_raw_hours,starts_at,ends_at,catalog_id,approved_lookups_per_hour,max_requests_per_hour,archive_budget_bytes from fuel_national_config;`;
console.log(execFileSync('npx', ['--no-install','supabase@2.118.0','db','query','--linked',
 '--project-ref','vjindchxfebaltbslqwc',sql,'--output','json'], { encoding: 'utf8' }));
