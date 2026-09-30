-- Durable bootstrap inventory. Uses the same global provider cooldown as prices,
-- but cannot run concurrently with the national price scheduler.
create table public.fuel_discovery_config (
  id boolean primary key default true check(id), enabled boolean not null default false,
  ends_at timestamptz, min_interval_seconds integer not null default 60 check(min_interval_seconds>=30),
  max_requests_per_hour integer not null default 30 check(max_requests_per_hour between 1 and 60),
  last_dispatch_at timestamptz
);
insert into public.fuel_discovery_config(id) values(true);
create table public.fuel_discovery_jobs (
  id bigint generated always as identity primary key,
  task_key text not null unique, descriptor jsonb not null,
  execution_region text not null references public.fuel_national_regions(region),
  status text not null default 'queued' check(status in ('queued','running','succeeded','failed')),
  attempts integer not null default 0, next_attempt_at timestamptz not null default now(),
  lease_token uuid, lease_until timestamptz, last_error text,
  created_at timestamptz not null default now(), completed_at timestamptz, payload jsonb
);
create table public.fuel_discovery_attempts (
  id bigint generated always as identity primary key, job_id bigint not null references public.fuel_discovery_jobs(id),
  attempted_at timestamptz not null default now(), execution_region text not null,
  outcome text not null default 'started', retry_after_seconds integer not null default 0
);
alter table public.fuel_discovery_config enable row level security;
alter table public.fuel_discovery_jobs enable row level security;
alter table public.fuel_discovery_attempts enable row level security;
revoke all on public.fuel_discovery_config,public.fuel_discovery_jobs,public.fuel_discovery_attempts from public,anon,authenticated,service_role;
grant select on public.fuel_discovery_config,public.fuel_discovery_jobs,public.fuel_discovery_attempts to service_role;

create function public.enqueue_fuel_discovery(p_key text,p_descriptor jsonb) returns bigint
language plpgsql security definer set search_path=public,pg_temp as $$
declare states text[]; target text; inserted bigint;
begin
  if p_descriptor->>'kind'='states' then
    select array_agg(s) into states from jsonb_array_elements_text(p_descriptor->'states') s;
    if cardinality(states) not between 1 and 4 then raise exception 'Invalid state batch'; end if;
  elsif p_descriptor->>'kind' in ('brands','nearby') then states:=array[p_descriptor->>'state'];
  else raise exception 'Invalid discovery task'; end if;
  if exists(select 1 from unnest(states) s where not exists(select 1 from fuel_national_state_routes r where r.state_code=s))
    or (select count(distinct execution_region) from fuel_national_state_routes where state_code=any(states))<>1 then raise exception 'Invalid or mixed region'; end if;
  select execution_region into target from fuel_national_state_routes where state_code=states[1];
  insert into fuel_discovery_jobs(task_key,descriptor,execution_region) values(p_key,p_descriptor,target)
    on conflict(task_key) do nothing returning id into inserted;
  if inserted is null then
    select id into inserted from fuel_discovery_jobs where task_key=p_key and descriptor=p_descriptor;
    if inserted is null then raise exception 'Task identity conflict'; end if;
  end if;
  return inserted;
end $$;

create function public.claim_fuel_discovery_job(p_region text)
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
  update fuel_national_config set last_request_at=now();
  insert into fuel_discovery_attempts(job_id,execution_region) values(picked,p_region);
  return query update fuel_discovery_jobs j set status='running',attempts=j.attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '90 seconds'
    where j.id=picked returning j.id,j.lease_token,j.descriptor,j.execution_region;
end $$;

create function public.finish_fuel_discovery_job(p_id bigint,p_token uuid,p_payload jsonb) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare job fuel_discovery_jobs;
begin
  select * into job from fuel_discovery_jobs where id=p_id for update;
  if not found or job.status<>'running' or job.lease_token is distinct from p_token or job.lease_until<=now() then return false; end if;
  if p_payload->>'executionRegion' is distinct from job.execution_region or p_payload->'task' is distinct from job.descriptor
    or jsonb_typeof(p_payload->'scopes') is distinct from 'array' or jsonb_array_length(p_payload->'scopes')=0
    or octet_length(p_payload::text)>8000000 then raise exception 'Invalid discovery result'; end if;
  update fuel_discovery_jobs set status='succeeded',payload=p_payload,completed_at=now(),lease_until=null where id=p_id;
  update fuel_discovery_attempts set outcome='succeeded' where id=(select max(id) from fuel_discovery_attempts where job_id=p_id);
  return true;
end $$;

create function public.fail_fuel_discovery_job(p_id bigint,p_token uuid,p_code text,p_retry_after_seconds integer default 0) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare job fuel_discovery_jobs; cooldown integer;
begin
  perform 1 from fuel_national_config where id for update;
  select * into job from fuel_discovery_jobs where id=p_id for update;
  if not found or job.status<>'running' or job.lease_token is distinct from p_token or job.lease_until<=now() then return false; end if;
  cooldown:=greatest(0,coalesce(p_retry_after_seconds,0),case p_code when 'UPSTREAM_HTTP_429' then 3600 when 'UPSTREAM_HTTP_401' then 86400 when 'UPSTREAM_HTTP_403' then 86400 else 0 end);
  update fuel_discovery_jobs set status=case when attempts>=3 or p_code in ('DISCOVERY_GRAPHQL_ERROR','UPSTREAM_HTTP_401','UPSTREAM_HTTP_403') then 'failed' else 'queued' end,
    last_error=left(p_code,100),lease_until=null,next_attempt_at=now()+make_interval(secs=>greatest(cooldown,60*job.attempts)) where id=p_id;
  update fuel_discovery_attempts set outcome=left(p_code,100),retry_after_seconds=cooldown where id=(select max(id) from fuel_discovery_attempts where job_id=p_id);
  insert into fuel_national_events(code,retry_after_seconds) values('DISCOVERY_'||left(p_code,90),cooldown);
  if cooldown>0 then
    update fuel_national_config set provider_backoff_until=greatest(coalesce(provider_backoff_until,now()),now()+make_interval(secs=>cooldown));
    update fuel_research_campaigns set provider_backoff_until=greatest(coalesce(provider_backoff_until,now()),now()+make_interval(secs=>cooldown)) where status='active';
  end if;
  if p_code in ('UPSTREAM_HTTP_401','UPSTREAM_HTTP_403','DISCOVERY_GRAPHQL_ERROR') then update fuel_discovery_config set enabled=false; end if;
  return true;
end $$;

create function public.dispatch_fuel_discovery() returns bigint
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
  update fuel_discovery_config set last_dispatch_at=now();
  update fuel_national_regions set last_dispatch_at=now() where region=target.region;
  return request_id;
end $$;

revoke all on function public.enqueue_fuel_discovery(text,jsonb),public.claim_fuel_discovery_job(text),public.finish_fuel_discovery_job(bigint,uuid,jsonb),public.fail_fuel_discovery_job(bigint,uuid,text,integer),public.dispatch_fuel_discovery() from public,anon,authenticated,service_role;
grant execute on function public.claim_fuel_discovery_job(text),public.finish_fuel_discovery_job(bigint,uuid,jsonb),public.fail_fuel_discovery_job(bigint,uuid,text,integer) to service_role;
