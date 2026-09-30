-- Uses synthetic national catalog in a rolled-back transaction; no provider calls.
begin;
do $$
declare manifest jsonb; cat uuid; run bigint; job record; other record; saved boolean; path text; host text;
begin
  if exists(select 1 from fuel_national_jobs) or exists(select 1 from fuel_national_config where enabled) then raise exception 'Run only against an empty paused national queue'; end if;
  select jsonb_build_object('regions',jsonb_agg(jsonb_build_object('code',code,'complete',true,'coverageBasis','SQL test only','observedAt',now(),'expectedCount',1,'ids',jsonb_build_array(ordinal::text)))) into manifest
    from unnest(array['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY']) with ordinality s(code,ordinal);
  begin perform install_fuel_national_catalog(jsonb_set(manifest,'{regions,0,expectedCount}','2')); raise exception 'Expected incomplete rejection'; exception when others then if sqlerrm='Expected incomplete rejection' then raise; end if; end;
  begin perform install_fuel_national_catalog(jsonb_set(manifest,'{regions,1,ids}','["1"]')); raise exception 'Expected ambiguous owner rejection'; exception when others then if sqlerrm='Expected ambiguous owner rejection' then raise; end if; end;
  cat:=install_fuel_national_catalog(manifest);
  if (select count(*) from fuel_national_state_routes)<>51 or (select count(distinct execution_region) from fuel_national_batches where catalog_id=cat)<>3 then raise exception 'Incomplete regional mapping'; end if;
  if begin_fuel_national_hour() is not null then raise exception 'Disabled collector created a run'; end if;
  update fuel_national_config set catalog_id=cat,enabled=true,ends_at=now()+interval '2 hours',approved_lookups_per_hour=500,provider_backoff_until=null,last_request_at=null;
  update fuel_research_campaigns set provider_backoff_until=null;
  run:=begin_fuel_national_hour();
  if run<>begin_fuel_national_hour() or (select count(*) from fuel_national_jobs where run_id=run)<>3 then raise exception 'Non-idempotent hour'; end if;
  select * into job from claim_fuel_national_region_job('us-east-1');
  if job.id is null or cardinality(job.station_ids)<>38 then raise exception 'Claim missing coverage'; end if;
  if job.execution_region<>'us-east-1' or '2'=any(job.station_ids) then raise exception 'East worker claimed Alaska'; end if;
  update fuel_national_config set last_request_at=now()-interval '1 minute';
  if exists(select 1 from claim_fuel_national_region_job('us-east-1')) then raise exception 'Concurrent provider request'; end if;
  if finish_fuel_national_job(job.id,gen_random_uuid(),job.station_ids,now(),now(),'bad',100,repeat('a',64),0) then raise exception 'Accepted stale token'; end if;
  path:=job.run_id||'/'||job.id||'/'||job.lease_token||'.json.gz';
  if finish_fuel_national_job(job.id,job.lease_token,job.station_ids,null,now(),path,100,repeat('a',64),0) then raise exception 'Accepted missing timestamp'; end if;
  begin perform finish_fuel_national_job(job.id,job.lease_token,array['1'],now(),now(),path,100,repeat('a',64),0); raise exception 'Expected coverage rejection'; exception when others then if sqlerrm='Expected coverage rejection' then raise; end if; end;
  if not fail_fuel_national_job(job.id,job.lease_token,'UPSTREAM_HTTP_429',7200) then raise exception 'Failed cooldown write'; end if;
  if (select provider_backoff_until from fuel_national_config)<now()+interval '7200 seconds' then raise exception 'Retry-After shortened'; end if;
  if exists(select 1 from claim_fuel_national_region_job('us-east-1')) then raise exception 'Ignored cooldown'; end if;
  if exists(select 1 from claim_fuel_national_region_job('us-west-1')) then raise exception 'Cooldown routed around through West'; end if;
  if not exists(select 1 from fuel_national_events where job_id=job.id and code='UPSTREAM_HTTP_429') then raise exception 'Lost error evidence'; end if;
  update fuel_national_config set provider_backoff_until=null,last_request_at=null;
  update fuel_research_campaigns set provider_backoff_until=null;
  update fuel_national_jobs set next_attempt_at=now() where id=job.id;
  select * into job from claim_fuel_national_region_job('us-east-1');
  -- Simulate crashed worker and reclaim after lease expiry.
  update fuel_national_jobs set lease_until=now()-interval '1 second' where id=job.id;
  update fuel_national_config set last_request_at=null;
  select * into other from claim_fuel_national_region_job('us-east-1');
  if other.id<>job.id or other.lease_token=job.lease_token then raise exception 'Failed lease recovery'; end if;
  if finish_fuel_national_job(job.id,job.lease_token,job.station_ids,now(),now(),path,100,repeat('a',64),0) then raise exception 'Old worker overwrote reclaimed lease'; end if;
  path:=other.run_id||'/'||other.id||'/'||other.lease_token||'.json.gz';
  saved:=finish_fuel_national_job(other.id,other.lease_token,other.station_ids,now(),now(),path,100,repeat('b',64),1);
  if not saved or (select status from fuel_national_runs where id=run)<>'running' then raise exception 'Partial regional run marked complete'; end if;
  if finish_fuel_national_job(other.id,other.lease_token,other.station_ids,now(),now(),path,100,repeat('b',64),1) then raise exception 'Duplicate completion accepted'; end if;
  update fuel_national_config set last_request_at=now();
  if exists(select 1 from claim_fuel_national_region_job('us-west-1')) then raise exception 'Ignored shared request pacing'; end if;
  foreach host in array array['us-west-1','us-west-2'] loop
    update fuel_national_config set last_request_at=null;
    select * into other from claim_fuel_national_region_job(host);
    if other.id is null or other.execution_region<>host then raise exception 'Wrong regional claim'; end if;
    path:=other.run_id||'/'||other.id||'/'||other.lease_token||'.json.gz';
    if not finish_fuel_national_job(other.id,other.lease_token,other.station_ids,now(),now(),path,100,repeat('c',64),0) then raise exception 'Regional completion failed'; end if;
  end loop;
  if (select status from fuel_national_runs where id=run)<>'complete' then raise exception 'Complete run not published'; end if;
  if (select observed_stations from fuel_national_health where id=run)<>51 or (select priced_stations from fuel_national_health where id=run)<>1 then raise exception 'Missing-price coverage lost'; end if;
  -- A new incomplete expired run is partial, never a successful empty hour.
  update fuel_national_runs set slot_at=date_trunc('hour',now())-interval '2 hours',deadline_at=now()-interval '1 second',status='running' where id=run;
  update fuel_national_jobs set status='queued' where run_id=run;
  perform begin_fuel_national_hour();
  if (select status from fuel_national_runs where id=run)<>'partial' or (select status from fuel_national_jobs where id=job.id)<>'missed' then raise exception 'Lost expired hour'; end if;
  update fuel_national_config set approved_lookups_per_hour=1;
  perform begin_fuel_national_hour();
  if (select enabled from fuel_national_config) then raise exception 'Enabled below lookup budget'; end if;
  if has_function_privilege('anon','public.claim_fuel_national_region_job(text)','execute') or has_table_privilege('authenticated','public.fuel_national_jobs','select')
    or has_function_privilege('service_role','public.install_fuel_national_catalog(jsonb)','execute') then raise exception 'Privilege leak'; end if;
end $$;

do $$ begin
 update fuel_national_config set enabled=true,approved_lookups_per_hour=500,starts_at=now()+interval '1 hour',catalog_valid_until=now()+interval '5 days';
 if begin_fuel_national_hour() is not null then raise exception 'Started before requested collection window'; end if;
 update fuel_national_config set starts_at=null;
 update fuel_national_catalogs set created_at=now()-interval '2 days' where id=(select catalog_id from fuel_national_config);
 if begin_fuel_national_hour() is null then raise exception 'Bounded fixed inventory window not honored'; end if;
 perform cron.unschedule('fuel-national-dispatch');
 if not watchdog_fuel_national() then raise exception 'Missing schedule not recovered'; end if;
 if not exists(select 1 from cron.job where jobname='fuel-national-dispatch' and username='postgres') then raise exception 'Recovered schedule has wrong owner'; end if;
 update fuel_national_config set catalog_valid_until=null;
 perform begin_fuel_national_hour();
 if (select enabled from fuel_national_config) then raise exception 'Default catalog freshness gate weakened'; end if;
 if watchdog_fuel_national() then raise exception 'Watchdog restarted paused collection'; end if;
end $$;

rollback;