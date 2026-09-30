-- Independent seven-day research collection. Never writes app cache/prices.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create table public.fuel_research_campaigns (
  id text primary key,
  starts_at timestamptz not null, ends_at timestamptz not null,
  status text not null default 'active' check(status in ('active','complete','paused')),
  cities jsonb not null check(jsonb_typeof(cities)='array'),
  last_dispatch_at timestamptz, last_request_id bigint, provider_backoff_until timestamptz,
  created_at timestamptz not null default now(),
  check(ends_at > starts_at and ends_at <= starts_at + interval '7 days')
);
create unique index fuel_research_one_active on public.fuel_research_campaigns((true)) where status='active';
create table public.fuel_research_jobs (
  id bigint generated always as identity primary key,
  campaign_id text not null references public.fuel_research_campaigns(id),
  city_id text not null, latitude double precision not null, longitude double precision not null,
  slot_at timestamptz not null, due_at timestamptz not null, deadline_at timestamptz not null,
  status text not null default 'queued' check(status in ('queued','running','succeeded','missed')),
  attempts integer not null default 0, next_attempt_at timestamptz not null,
  lease_token uuid, lease_until timestamptz, last_error text,
  completed_at timestamptz, station_count integer,
  unique(campaign_id,city_id,slot_at), check(deadline_at > due_at)
);
create index fuel_research_due on public.fuel_research_jobs(next_attempt_at) where status in ('queued','running');
create table public.fuel_research_snapshots (
  job_id bigint primary key references public.fuel_research_jobs(id),
  started_at timestamptz not null, observed_at timestamptz not null,
  payload jsonb not null check(jsonb_typeof(payload->'stations')='array'),
  saved_at timestamptz not null default now()
);
alter table public.fuel_research_campaigns enable row level security;
alter table public.fuel_research_jobs enable row level security;
alter table public.fuel_research_snapshots enable row level security;
revoke all on public.fuel_research_campaigns,public.fuel_research_jobs,public.fuel_research_snapshots from public,anon,authenticated;
grant all on public.fuel_research_campaigns,public.fuel_research_jobs,public.fuel_research_snapshots to service_role;
grant usage,select on sequence public.fuel_research_jobs_id_seq to service_role;

create function public.start_fuel_research(p_id text,p_cities jsonb,p_start timestamptz default date_trunc('minute',now())+interval '1 minute')
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare inserted integer;
begin
  if jsonb_array_length(p_cities) < 21 or jsonb_array_length(p_cities) > 30 then raise exception 'Require 21-30 cities'; end if;
  if p_start < now()-interval '1 minute' or p_start > now()+interval '1 day' then raise exception 'Invalid start'; end if;
  if exists(select 1 from fuel_research_campaigns where id=p_id) then
    return (select count(*)::integer from fuel_research_jobs where campaign_id=p_id);
  end if;
  if exists(select 1 from jsonb_array_elements(p_cities) c where c->>'id' is null
    or not ((c->>'latitude')::double precision between -90 and 90)
    or not ((c->>'longitude')::double precision between -180 and 180)) then raise exception 'Invalid city'; end if;
  insert into fuel_research_campaigns(id,starts_at,ends_at,cities) values(p_id,p_start,p_start+interval '7 days',p_cities);
  insert into fuel_research_jobs(campaign_id,city_id,latitude,longitude,slot_at,due_at,deadline_at,next_attempt_at)
    select p_id,c->>'id',(c->>'latitude')::double precision,(c->>'longitude')::double precision,
      p_start+h*interval '1 hour',p_start+h*interval '1 hour'+(ordinal-1)*interval '1 minute',
      p_start+(h+1)*interval '1 hour',p_start+h*interval '1 hour'+(ordinal-1)*interval '1 minute'
    from jsonb_array_elements(p_cities) with ordinality as city(c,ordinal),generate_series(0,167) h;
  get diagnostics inserted=row_count;
  return inserted;
end; $$;

create function public.claim_fuel_research_jobs(p_limit integer default 2)
returns setof public.fuel_research_jobs language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update fuel_research_jobs set status='missed',last_error=coalesce(last_error,'DEADLINE_MISSED'),lease_until=null
    where status in ('queued','running') and (deadline_at<=now() or (attempts>=6 and (lease_until is null or lease_until<=now())));
  return query update fuel_research_jobs j set status='running',attempts=j.attempts+1,
      lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes'
    where j.id in (select q.id from fuel_research_jobs q join fuel_research_campaigns c on c.id=q.campaign_id
      where c.status='active' and now()<c.ends_at and (c.provider_backoff_until is null or c.provider_backoff_until<=now()) and q.due_at<=now() and q.deadline_at>now()
      and q.next_attempt_at<=now() and q.attempts<6
      and (q.status='queued' or (q.status='running' and q.lease_until<=now()))
      order by q.due_at for update of q skip locked limit least(greatest(p_limit,1),2)) returning j.*;
end; $$;

create function public.finish_fuel_research_job(p_id bigint,p_token uuid,p_started_at timestamptz,p_observed_at timestamptz,p_payload jsonb)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare job fuel_research_jobs; station_total integer;
begin
  select * into job from fuel_research_jobs where id=p_id for update;
  if not found or job.status<>'running' or job.lease_token is distinct from p_token or job.lease_until<=now() or job.deadline_at<=now() then return false; end if;
  if p_started_at<job.due_at or p_observed_at<p_started_at or p_observed_at>now()+interval '1 minute'
    or p_observed_at>=job.deadline_at then raise exception 'Invalid observation time'; end if;
  station_total:=jsonb_array_length(p_payload->'stations');
  if station_total is null or station_total<1 or station_total>200 or octet_length(p_payload::text)>2000000 then raise exception 'Invalid payload'; end if;
  insert into fuel_research_snapshots(job_id,started_at,observed_at,payload) values(p_id,p_started_at,p_observed_at,p_payload);
  update fuel_research_jobs set status='succeeded',completed_at=now(),station_count=station_total,lease_until=null,last_error=null where id=p_id;
  return true;
end; $$;

create function public.fail_fuel_research_job(p_id bigint,p_token uuid,p_code text,p_retry_after_seconds integer default 0)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare changed integer; cooldown integer;
begin
  cooldown:=greatest(0,least(coalesce(p_retry_after_seconds,0),604800),case p_code when 'UPSTREAM_HTTP_429' then 900 when 'UPSTREAM_HTTP_403' then 3600 else 0 end);
  update fuel_research_jobs set status=case when attempts>=6 or deadline_at<=now() then 'missed' else 'queued' end,
    next_attempt_at=now()+make_interval(secs=>greatest(cooldown,60*least(30,(power(2,least(attempts-1,5)))::integer))),
    lease_until=null,last_error=left(p_code,100)
    where id=p_id and lease_token=p_token and status='running' and lease_until>now();
  get diagnostics changed=row_count;
  if changed=1 and cooldown>0 then
    update fuel_research_campaigns set provider_backoff_until=greatest(coalesce(provider_backoff_until,now()),now()+make_interval(secs=>cooldown))
      where id=(select campaign_id from fuel_research_jobs where id=p_id);
  end if;
  return changed=1;
end; $$;

create function public.dispatch_fuel_research() returns bigint
language plpgsql security definer set search_path=public,pg_temp as $$
declare campaign fuel_research_campaigns; request_id bigint; endpoint text; secret text;
begin
  if not pg_try_advisory_xact_lock(71892050) then return null; end if;
  update fuel_research_jobs set status='missed',last_error=coalesce(last_error,'DEADLINE_MISSED'),lease_until=null
    where status in ('queued','running') and deadline_at<=now();
  update fuel_research_campaigns set status='complete' where status='active' and ends_at<=now();
  select * into campaign from fuel_research_campaigns where status='active' and starts_at<=now() limit 1 for update;
  if not found then
    if exists(select 1 from fuel_research_campaigns) and not exists(select 1 from fuel_research_campaigns where status='active') then
      perform cron.unschedule(jobid) from cron.job where jobname in ('fuel-research-dispatch','fuel-research-watchdog');
    end if;
    return null;
  end if;
  if campaign.last_dispatch_at>now()-interval '45 seconds' then return null; end if;
  update fuel_research_campaigns set last_dispatch_at=now() where id=campaign.id;
  if campaign.provider_backoff_until>now() then return null; end if;
  if not exists(select 1 from fuel_research_jobs where campaign_id=campaign.id and due_at<=now() and deadline_at>now()
    and next_attempt_at<=now() and attempts<6 and (status='queued' or (status='running' and lease_until<=now()))) then return null; end if;
  select decrypted_secret into endpoint from vault.decrypted_secrets where name='fuel_research_endpoint';
  select decrypted_secret into secret from vault.decrypted_secrets where name='fuel_research_secret';
  if endpoint is null or secret is null then raise exception 'Research scheduler configuration missing'; end if;
  select net.http_post(url:=endpoint,headers:=jsonb_build_object('Content-Type','application/json','x-fuel-research-key',secret),
    body:='{}'::jsonb,timeout_milliseconds:=45000) into request_id;
  update fuel_research_campaigns set last_request_id=request_id where id=campaign.id;
  return request_id;
end; $$;

create function public.watchdog_fuel_research() returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if exists(select 1 from fuel_research_campaigns where status='active' and ends_at>now()) then
    if not exists(select 1 from cron.job where jobname='fuel-research-dispatch' and active) then
      perform cron.schedule('fuel-research-dispatch','* * * * *','select public.dispatch_fuel_research();');
    end if;
  end if;
  perform public.dispatch_fuel_research();
end; $$;

create view public.fuel_research_health with (security_invoker=true) as
  select c.id,c.status,c.starts_at,c.ends_at,c.last_dispatch_at,c.provider_backoff_until,
    count(j.id) as planned_city_hours,
    count(j.id) filter(where j.status='succeeded') as succeeded,
    count(j.id) filter(where j.status='missed') as missed,
    count(j.id) filter(where j.status='running') as running,
    count(j.id) filter(where j.status='queued' and j.due_at<=now() and j.deadline_at>now()) as queued_due,
    max(j.completed_at) as last_success_at,
    coalesce(sum(j.station_count),0) as station_observations,
    count(distinct j.city_id) filter(where j.status='succeeded') as cities_observed
  from public.fuel_research_campaigns c left join public.fuel_research_jobs j on j.campaign_id=c.id group by c.id;
revoke all on public.fuel_research_health from public,anon,authenticated;
grant select on public.fuel_research_health to service_role;

revoke all on function public.start_fuel_research(text,jsonb,timestamptz),public.claim_fuel_research_jobs(integer),
  public.finish_fuel_research_job(bigint,uuid,timestamptz,timestamptz,jsonb),public.fail_fuel_research_job(bigint,uuid,text,integer),
  public.dispatch_fuel_research(),public.watchdog_fuel_research() from public,anon,authenticated;
grant execute on function public.claim_fuel_research_jobs(integer),
  public.finish_fuel_research_job(bigint,uuid,timestamptz,timestamptz,jsonb),public.fail_fuel_research_job(bigint,uuid,text,integer) to service_role;
-- Start, Vault configuration, and scheduling are deliberate deployment steps.
-- No campaign begins just because a migration is applied.
