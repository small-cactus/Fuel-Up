-- Separate dispatcher locks avoid skipped discovery ticks while price collection
-- is paused. The shared config row lock and mutually exclusive enabled checks
-- still serialize provider admission across both queues.
create or replace function public.dispatch_fuel_discovery() returns bigint
language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg fuel_national_config; discovery fuel_discovery_config; target fuel_national_regions; endpoint text; secret text; request_id bigint;
begin
  if not pg_try_advisory_xact_lock(71892052) then return null; end if;
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
