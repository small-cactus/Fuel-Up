-- Retry-After is authoritative. When absent, use bounded exponential backoff,
-- not a presumed one-hour provider window. Keys/quotas remain undocumented.
create function public.fuel_provider_retry_seconds(p_code text,p_requested integer) returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare failures integer; last_success timestamptz;
begin
  if coalesce(p_requested,0)>0 then return p_requested; end if;
  if p_code='UPSTREAM_HTTP_429' then
    select greatest((select max(completed_at) from fuel_national_jobs where status='succeeded'),
      (select max(completed_at) from fuel_discovery_jobs where status='succeeded')) into last_success;
    select count(*) into failures from fuel_national_events where code in ('UPSTREAM_HTTP_429','DISCOVERY_UPSTREAM_HTTP_429')
      and created_at>greatest(coalesce(last_success,now()-interval '24 hours'),now()-interval '24 hours');
    return least(3600,60*power(2,least(failures,6))::integer);
  end if;
  return case p_code when 'UPSTREAM_HTTP_401' then 86400 when 'UPSTREAM_HTTP_403' then 86400 when 'GRAPHQL_ERROR' then 3600 else 0 end;
end $$;
revoke all on function public.fuel_provider_retry_seconds(text,integer) from public,anon,authenticated,service_role;


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
      enabled=case when p_code in ('UPSTREAM_HTTP_403','UPSTREAM_HTTP_401','GRAPHQL_ERROR') then false else enabled end;
    -- Do not send the same blocked traffic through the pre-existing campaign.
    update fuel_research_campaigns set provider_backoff_until=greatest(coalesce(provider_backoff_until,now()),now()+make_interval(secs=>cooldown)) where status='active';
  end if;
  return true;
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
    update fuel_national_config set provider_backoff_until=greatest(coalesce(provider_backoff_until,now()),now()+make_interval(secs=>cooldown));
    update fuel_research_campaigns set provider_backoff_until=greatest(coalesce(provider_backoff_until,now()),now()+make_interval(secs=>cooldown)) where status='active';
  end if;
  if p_code in ('UPSTREAM_HTTP_401','UPSTREAM_HTTP_403','DISCOVERY_GRAPHQL_ERROR') then update fuel_discovery_config set enabled=false; end if;
  return true;
end $$;
