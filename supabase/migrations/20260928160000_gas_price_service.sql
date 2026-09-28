-- Server-only cache, refresh leases, and durable repair jobs. No paid extensions.
create table if not exists public.fuel_query_cache (
  query_key text primary key,
  quotes jsonb not null,
  expires_at timestamptz not null
);
create table if not exists public.fuel_refresh_locks (
  query_key text primary key, token uuid not null, expires_at timestamptz not null
);
create table if not exists public.fuel_provider_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(), success boolean not null, code text not null
);
create index if not exists fuel_provider_events_time on public.fuel_provider_events(created_at);
create table if not exists public.fuel_repair_jobs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed')),
  code text not null, attempts integer not null default 0,
  lease_token uuid, lease_until timestamptz, result jsonb
);
create unique index if not exists fuel_one_active_repair on public.fuel_repair_jobs ((true)) where status in ('queued','running');
alter table public.fuel_query_cache enable row level security;
alter table public.fuel_refresh_locks enable row level security;
alter table public.fuel_provider_events enable row level security;
alter table public.fuel_repair_jobs enable row level security;
revoke all on public.fuel_query_cache, public.fuel_refresh_locks, public.fuel_provider_events, public.fuel_repair_jobs from anon, authenticated;
grant all on public.fuel_query_cache, public.fuel_refresh_locks, public.fuel_provider_events, public.fuel_repair_jobs to service_role;
grant usage, select on sequence public.fuel_provider_events_id_seq to service_role;

create or replace function public.claim_fuel_refresh(p_key text) returns uuid
language plpgsql security definer set search_path = public as $$
declare claimed uuid;
begin
  insert into fuel_refresh_locks(query_key, token, expires_at) values(p_key, gen_random_uuid(), now()+interval '25 seconds')
  on conflict(query_key) do update set token=excluded.token, expires_at=excluded.expires_at
  where fuel_refresh_locks.expires_at < now() returning token into claimed;
  return claimed;
end; $$;
create or replace function public.release_fuel_refresh(p_key text, p_token uuid) returns void
language sql security definer set search_path = public as $$
  delete from fuel_refresh_locks where query_key=p_key and token=p_token;
$$;
create or replace function public.record_fuel_provider_result(p_success boolean, p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare failures integer; total integer;
begin
  insert into fuel_provider_events(success,code) values(p_success,left(p_code,100));
  -- Bound storage on the free plan. The cache is disposable, repair evidence is retained.
  delete from fuel_provider_events where created_at < now()-interval '1 day';
  delete from fuel_query_cache where expires_at < now()-interval '1 day';
  delete from fuel_refresh_locks where expires_at < now()-interval '1 hour';
  if p_success then return; end if;
  select count(*), count(*) filter(where not success) into total,failures
    from fuel_provider_events where created_at > now()-interval '5 minutes';
  if failures >= 5 and failures::numeric / greatest(total,1) >= 0.5 then
    perform pg_advisory_xact_lock(71892041);
    if not exists(select 1 from fuel_repair_jobs where status in ('queued','running') or created_at > now()-interval '1 hour') then
      insert into fuel_repair_jobs(code) values(left(p_code,100));
    end if;
  end if;
end; $$;
create or replace function public.claim_fuel_repair() returns setof public.fuel_repair_jobs
language plpgsql security definer set search_path = public as $$
begin
  update fuel_repair_jobs set status='failed',updated_at=now()
    where status='running' and lease_until < now() and attempts >= 3;
  return query update fuel_repair_jobs set status='running',attempts=attempts+1,
    lease_token=gen_random_uuid(),lease_until=now()+interval '3 minutes',updated_at=now()
    where id=(select id from fuel_repair_jobs where (status='queued' or (status='running' and lease_until<now()))
      and attempts<3 order by created_at for update skip locked limit 1) returning *;
end; $$;
create or replace function public.update_fuel_repair(p_id uuid,p_token uuid,p_status text,p_result jsonb default null) returns boolean
language plpgsql security definer set search_path = public as $$
declare changed integer;
begin
  if p_status not in ('queued','running','succeeded','failed') then raise exception 'Invalid status'; end if;
  update fuel_repair_jobs set status=p_status,updated_at=now(),lease_until=now()+interval '3 minutes',result=coalesce(p_result,result)
    where id=p_id and lease_token=p_token and status='running' and lease_until>now();
  get diagnostics changed=row_count; return changed=1;
end; $$;
revoke all on function public.claim_fuel_refresh(text),public.release_fuel_refresh(text,uuid),
  public.record_fuel_provider_result(boolean,text),public.claim_fuel_repair(),public.update_fuel_repair(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.claim_fuel_refresh(text),public.release_fuel_refresh(text,uuid),
  public.record_fuel_provider_result(boolean,text),public.claim_fuel_repair(),public.update_fuel_repair(uuid,uuid,text,jsonb) to service_role;
-- Existing cache-fill writers continue populating station_prices.
create index if not exists station_prices_gasbuddy_area_recent on public.station_prices
  (search_latitude_rounded,search_longitude_rounded,fuel_type,created_at desc) where provider_id='gasbuddy';
