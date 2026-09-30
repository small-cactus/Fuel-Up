// Explicit admin activation after a complete catalog has been published.
// This changes scheduling only; provider traffic still originates in its region.
import {execFileSync} from 'node:child_process';
const until=process.argv[2],end=Date.parse(until);
if(!Number.isFinite(end)||end<=Date.now()||end>Date.now()+7*86400000)throw Error('Supply an end timestamp within the next seven days');
const sql=`begin;
do $$ declare cfg fuel_national_config; cat fuel_national_catalogs; begin
 select * into cfg from fuel_national_config where id for update;
 select * into cat from fuel_national_catalogs where id=cfg.catalog_id;
 if cat.id is null or cat.region_count<>51 or cat.created_at<now()-interval '24 hours' then raise exception 'Require freshly published complete catalog'; end if;
 if cfg.enabled then raise exception 'Already active; inspect existing schedule instead of extending it'; end if;
 if cfg.provider_backoff_until>now() or exists(select 1 from fuel_research_campaigns where status='active' and provider_backoff_until>now()) then raise exception 'Provider cooldown still active'; end if;
 if exists(select 1 from fuel_discovery_jobs where status='running' and lease_until>now()) then raise exception 'Discovery request still in flight'; end if;
 if not exists(select 1 from vault.secrets where name='fuel_research_secret') then raise exception 'Missing worker authentication'; end if;
 update fuel_discovery_config set enabled=false where id;
 update fuel_national_config set enabled=true,halt_reason='ACTIVE_BOUNDED_NATIONAL_RESEARCH',
  starts_at=case when extract(epoch from date_trunc('hour',now())+interval '1 hour'-now())>
    (select sum(ceil(n/5.0))*60+180 from (select count(*) n from fuel_national_batches where catalog_id=cat.id group by execution_region) regional_counts)
    then now() else date_trunc('hour',now())+interval '1 hour' end,
  ends_at='${new Date(end).toISOString()}',catalog_valid_until='${new Date(end).toISOString()}',
  approved_lookups_per_hour=cat.station_count+20000,max_requests_per_hour=cat.batch_count+20,
  archive_budget_bytes=900000000,request_interval_seconds=10 where id;
 insert into fuel_national_events(code) values('BOUNDED_NATIONAL_COLLECTION_ACTIVATED');
end $$;
select cron.schedule('fuel-national-dispatch','* * * * *','select public.dispatch_fuel_national();');
select cron.schedule('fuel-national-watchdog','*/5 * * * *','select public.watchdog_fuel_national();');
commit;
select enabled,starts_at,ends_at,catalog_valid_until,approved_lookups_per_hour,max_requests_per_hour,archive_budget_bytes from fuel_national_config;`;
const result=execFileSync('npx',['--no-install','supabase@2.118.0','db','query','--linked','--project-ref','vjindchxfebaltbslqwc',sql,'--output','json'],{encoding:'utf8'});
console.log(result);
