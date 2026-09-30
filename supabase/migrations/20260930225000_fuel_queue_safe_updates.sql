-- PostgREST enables safe-update checks even for singleton tables. Always
-- name the singleton row; verify collection through the HTTP RPC path.

create or replace function public.begin_fuel_national_hour() returns bigint
language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg fuel_national_config; cat fuel_national_catalogs; run bigint;
begin
  select * into cfg from fuel_national_config where id for update;
  update fuel_national_jobs j set status='missed',lease_until=null,last_error=coalesce(last_error,'HOUR_DEADLINE_MISSED')
    from fuel_national_runs r where r.id=j.run_id and r.deadline_at<=now() and j.status in ('queued','running');
  update fuel_national_runs set status='partial',completed_at=now() where status='running' and deadline_at<=now();
  if not cfg.enabled then return null; end if;
  if cfg.ends_at<=now() then update fuel_national_config set enabled=false,halt_reason='COLLECTION_END' where fuel_national_config.id; return null; end if;
  select * into cat from fuel_national_catalogs where id=cfg.catalog_id;
  if cat.created_at<now()-interval '24 hours' or cat.station_count>cfg.approved_lookups_per_hour
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

create or replace function public.fail_fuel_national_job(p_id bigint,p_token uuid,p_code text,p_retry_after_seconds integer default 0)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare job fuel_national_jobs; cooldown integer;
begin
  -- Config first matches claim's lock order; no concurrent worker can slip into a cooldown.
  perform 1 from fuel_national_config where id for update;
  select * into job from fuel_national_jobs where id=p_id for update;
  if not found or job.status<>'running' or job.lease_token is distinct from p_token or job.lease_until<=now() then return false; end if;
  cooldown:=fuel_provider_retry_seconds(p_code,p_retry_after_seconds);
  insert into fuel_national_events(job_id,code,retry_after_seconds) values(p_id,left(p_code,100),cooldown);
  update fuel_national_jobs set status=case when attempts>=3 then 'missed' else 'queued' end,lease_until=null,last_error=left(p_code,100),next_attempt_at=now()+make_interval(secs=>greatest(cooldown,60*job.attempts)) where id=p_id;
  if cooldown>0 then
    update fuel_national_config set provider_backoff_until=greatest(coalesce(provider_backoff_until,now()),now()+make_interval(secs=>cooldown)),halt_reason=left(p_code,100),
      enabled=case when p_code in ('UPSTREAM_HTTP_403','UPSTREAM_HTTP_401','GRAPHQL_ERROR') then false else enabled end where fuel_national_config.id;
    -- Do not send the same blocked traffic through the pre-existing campaign.
    update fuel_research_campaigns set provider_backoff_until=greatest(coalesce(provider_backoff_until,now()),now()+make_interval(secs=>cooldown)) where status='active';
  end if;
  return true;
end $$;

create or replace function public.dispatch_fuel_national() returns bigint
language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg fuel_national_config; target fuel_national_regions; endpoint text; secret text; request_id bigint;
begin
  if not pg_try_advisory_xact_lock(71892051) then return null; end if;
  perform begin_fuel_national_hour();
  select * into cfg from fuel_national_config where id for update;
  if not cfg.enabled or cfg.provider_backoff_until>now() or cfg.last_dispatch_at>now()-interval '45 seconds'
    or exists(select 1 from fuel_research_campaigns where status='active' and provider_backoff_until>now())
    or exists(select 1 from fuel_national_jobs where status='running' and lease_until>now()) then return null; end if;
  select * into target from fuel_national_regions x where x.enabled and exists(
    select 1 from fuel_national_jobs j join fuel_national_runs r on r.id=j.run_id
      join fuel_national_batches b on b.catalog_id=j.catalog_id and b.ordinal=j.ordinal
    where b.execution_region=x.region and r.status='running' and r.deadline_at>now() and j.attempts<3
      and j.next_attempt_at<=now() and (j.status='queued' or (j.status='running' and j.lease_until<=now())))
    order by x.last_dispatch_at nulls first,x.region limit 1;
  if not found then return null; end if;
  select decrypted_secret into endpoint from vault.decrypted_secrets where name='fuel_national_endpoint';
  select decrypted_secret into secret from vault.decrypted_secrets where name='fuel_research_secret';
  if endpoint is null or secret is null or endpoint!~'/fuel-national$' then raise exception 'Regional scheduler configuration missing'; end if;
  endpoint:=regexp_replace(endpoint,'/fuel-national$','/'||target.function_name);
  select net.http_post(url:=endpoint,headers:=jsonb_build_object('Content-Type','application/json','x-fuel-research-key',secret,'x-region',target.region),
    body:='{"mode":"collect"}'::jsonb,timeout_milliseconds:=100000) into request_id;
  update fuel_national_config set last_dispatch_at=now() where fuel_national_config.id;
  update fuel_national_regions set last_dispatch_at=now() where region=target.region;
  return request_id;
end $$;

create or replace function public.claim_fuel_national_region_job(p_region text)
returns table(id bigint,run_id bigint,lease_token uuid,station_ids text[],execution_region text)
language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg fuel_national_config; picked bigint;
begin
  if not exists(select 1 from fuel_national_regions where region=p_region and enabled) then raise exception 'Unknown or disabled execution region'; end if;
  select * into cfg from fuel_national_config where fuel_national_config.id for update;
  if not cfg.enabled or cfg.ends_at<=now() or cfg.provider_backoff_until>now() or cfg.last_request_at>now()-interval '2 seconds' then return; end if;
  -- A denial already seen by the existing campaign also blocks national work.
  if exists(select 1 from fuel_research_campaigns where status='active' and provider_backoff_until>now()) then return; end if;
  if exists(select 1 from fuel_national_jobs where status='running' and lease_until>now()) then return; end if;
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
    from fuel_national_batches b where j.id=picked and b.catalog_id=j.catalog_id and b.ordinal=j.ordinal returning j.id,j.run_id,j.lease_token,b.station_ids,b.execution_region;
end $$;

create or replace function public.claim_fuel_discovery_job(p_region text)
returns table(id bigint,lease_token uuid,descriptor jsonb,execution_region text)
language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg fuel_national_config; discovery fuel_discovery_config; picked bigint;
begin
  select * into cfg from fuel_national_config where fuel_national_config.id for update;
  select * into discovery from fuel_discovery_config where fuel_discovery_config.id;
  if cfg.enabled or not discovery.enabled or discovery.ends_at is null or discovery.ends_at<=now()
    or cfg.provider_backoff_until>now() or cfg.last_request_at>now()-make_interval(secs=>discovery.min_interval_seconds) then return; end if;
  if not exists(select 1 from fuel_national_regions where region=p_region and enabled) then raise exception 'Invalid execution region'; end if;
  if exists(select 1 from fuel_research_campaigns where status='active' and provider_backoff_until>now())
    or exists(select 1 from fuel_discovery_jobs where status='running' and lease_until>now())
    or exists(select 1 from fuel_national_jobs where status='running' and lease_until>now()) then return; end if;
  if (select count(*) from fuel_discovery_attempts where attempted_at>now()-interval '1 hour')>=discovery.max_requests_per_hour then return; end if;
  select j.id into picked from fuel_discovery_jobs j where j.execution_region=p_region and j.attempts<3 and j.next_attempt_at<=now()
    and (j.status='queued' or (j.status='running' and j.lease_until<=now())) order by j.id limit 1 for update;
  if picked is null then return; end if;
  update fuel_national_config set last_request_at=now() where fuel_national_config.id;
  insert into fuel_discovery_attempts(job_id,execution_region) values(picked,p_region);
  return query update fuel_discovery_jobs j set status='running',attempts=j.attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '90 seconds'
    where j.id=picked returning j.id,j.lease_token,j.descriptor,j.execution_region;
end $$;

create or replace function public.fail_fuel_discovery_job(p_id bigint,p_token uuid,p_code text,p_retry_after_seconds integer default 0) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare job fuel_discovery_jobs; cooldown integer;
begin
  perform 1 from fuel_national_config where id for update;
  select * into job from fuel_discovery_jobs where id=p_id for update;
  if not found or job.status<>'running' or job.lease_token is distinct from p_token or job.lease_until<=now() then return false; end if;
  cooldown:=fuel_provider_retry_seconds(p_code,p_retry_after_seconds);
  update fuel_discovery_jobs set status=case when attempts>=3 or p_code in ('DISCOVERY_GRAPHQL_ERROR','UPSTREAM_HTTP_401','UPSTREAM_HTTP_403') then 'failed' else 'queued' end,
    last_error=left(p_code,100),lease_until=null,next_attempt_at=now()+make_interval(secs=>greatest(cooldown,60*job.attempts)) where id=p_id;
  update fuel_discovery_attempts set outcome=left(p_code,100),retry_after_seconds=cooldown where id=(select max(id) from fuel_discovery_attempts where job_id=p_id);
  insert into fuel_national_events(code,retry_after_seconds) values('DISCOVERY_'||left(p_code,90),cooldown);
  if cooldown>0 then
    update fuel_national_config set provider_backoff_until=greatest(coalesce(provider_backoff_until,now()),now()+make_interval(secs=>cooldown)) where fuel_national_config.id;
    update fuel_research_campaigns set provider_backoff_until=greatest(coalesce(provider_backoff_until,now()),now()+make_interval(secs=>cooldown)) where status='active';
  end if;
  if p_code in ('UPSTREAM_HTTP_401','UPSTREAM_HTTP_403','DISCOVERY_GRAPHQL_ERROR') then update fuel_discovery_config set enabled=false where fuel_discovery_config.id; end if;
  return true;
end $$;

create or replace function public.dispatch_fuel_discovery() returns bigint
language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg fuel_national_config; discovery fuel_discovery_config; target fuel_national_regions; endpoint text; secret text; request_id bigint;
begin
  if not pg_try_advisory_xact_lock(71892051) then return null; end if;
  select * into cfg from fuel_national_config where id for update;
  select * into discovery from fuel_discovery_config where id for update;
  if cfg.enabled or not discovery.enabled or discovery.ends_at is null or discovery.ends_at<=now()
    or cfg.provider_backoff_until>now() or discovery.last_dispatch_at>now()-interval '55 seconds'
    or cfg.last_request_at>now()-make_interval(secs=>discovery.min_interval_seconds)
    or exists(select 1 from fuel_research_campaigns where status='active' and provider_backoff_until>now())
    or exists(select 1 from fuel_discovery_jobs where status='running' and lease_until>now())
    or exists(select 1 from fuel_national_jobs where status='running' and lease_until>now())
    or (select count(*) from fuel_discovery_attempts where attempted_at>now()-interval '1 hour')>=discovery.max_requests_per_hour then return null; end if;
  -- Exhausted/crashed work remains visible instead of waiting forever.
  update fuel_discovery_jobs set status='failed',last_error='LEASE_EXHAUSTED' where status='running' and lease_until<=now() and attempts>=3;
  select * into target from fuel_national_regions r where r.enabled and exists(select 1 from fuel_discovery_jobs j
    where j.execution_region=r.region and j.attempts<3 and j.next_attempt_at<=now()
      and (j.status='queued' or (j.status='running' and j.lease_until<=now()))) order by r.last_dispatch_at nulls first,r.region limit 1;
  if not found then return null; end if;
  select decrypted_secret into endpoint from vault.decrypted_secrets where name='fuel_national_endpoint';
  select decrypted_secret into secret from vault.decrypted_secrets where name='fuel_research_secret';
  if endpoint is null or secret is null or endpoint!~'/fuel-national$' then raise exception 'Scheduler configuration missing'; end if;
  endpoint:=regexp_replace(endpoint,'/fuel-national$','/'||target.function_name);
  select net.http_post(url:=endpoint,headers:=jsonb_build_object('Content-Type','application/json','x-fuel-research-key',secret,'x-region',target.region),
    body:='{"mode":"discover"}'::jsonb,timeout_milliseconds:=55000) into request_id;
  update fuel_discovery_config set last_dispatch_at=now() where fuel_discovery_config.id;
  update fuel_national_regions set last_dispatch_at=now() where region=target.region;
  return request_id;
end $$;
