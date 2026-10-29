-- Daily per-station observations derived from archived batches, never user visits.
-- First eligible observation per UTC day; no interpolation or national fallback.
create table public.fuel_local_daily_prices (
 station_id text not null,
 day date not null,
 job_id bigint not null references public.fuel_national_jobs(id) on delete cascade,
 prices jsonb not null,
 primary key(station_id,day)
);
create index fuel_local_daily_prices_job on public.fuel_local_daily_prices(job_id);
create index fuel_local_daily_prices_day on public.fuel_local_daily_prices(day);
alter table public.fuel_local_daily_prices enable row level security;
revoke all on public.fuel_local_daily_prices from public,anon,authenticated,service_role;

create function public.record_fuel_local_daily_prices(p_job_id bigint,p_stations jsonb)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare job fuel_national_jobs; expected text[]; actual text[]; affected integer;
begin
 select * into job from fuel_national_jobs where id=p_job_id and status='succeeded';
 if not found then raise exception 'Verified archived batch required'; end if;
 -- Operational derived data only. Never change or republish the closed campaign.
 if job.observed_at<'2026-10-07T19:00:00Z' or job.observed_at<now()-interval '8 days' then return 0; end if;
 select station_ids into expected from fuel_national_batches where catalog_id=job.catalog_id and ordinal=job.ordinal;
 select array_agg(s->>'id' order by ord) into actual from jsonb_array_elements(p_stations) with ordinality a(s,ord);
 if actual is distinct from expected then raise exception 'Local history coverage mismatch'; end if;
 with samples as (
  select s->>'id' station_id,s->'prices' entries,e->>'fuelProduct' product,fuel_fresh_payment(e,job.observed_at) payment
  from jsonb_array_elements(p_stations) s cross join lateral jsonb_array_elements(s->'prices') e
  where not exists(select 1 from fuel_local_daily_prices h join fuel_national_jobs old on old.id=h.job_id
   join fuel_national_runs r on r.id=old.run_id where h.station_id=s->>'id'
   and h.day=(job.observed_at at time zone 'UTC')::date and old.observed_at<=job.observed_at and r.status<>'partial')
 ), eligible as (
  select s.* from samples s where s.payment is not null and not exists(
   select 1 from jsonb_array_elements(s.entries) lo where
    ((s.product='midgrade_gas' and lo->>'fuelProduct'='regular_gas') or
     (s.product='premium_gas' and lo->>'fuelProduct' in ('regular_gas','midgrade_gas')))
    and round((fuel_fresh_payment(lo,job.observed_at)->>'price')::numeric,3)=round((s.payment->>'price')::numeric,3))
 )
 insert into fuel_local_daily_prices as target(station_id,day,job_id,prices)
 select station_id,(job.observed_at at time zone 'UTC')::date,job.id,jsonb_object_agg(product,payment)
 from eligible group by station_id
 on conflict(station_id,day) do update set job_id=excluded.job_id,prices=excluded.prices
 where exists(select 1 from fuel_national_jobs old join fuel_national_runs r on r.id=old.run_id
  where old.id=target.job_id and (old.observed_at>job.observed_at or r.status='partial'));
 get diagnostics affected=row_count;
 return affected;
end $$;
revoke all on function public.record_fuel_local_daily_prices(bigint,jsonb) from public,anon,authenticated;
grant execute on function public.record_fuel_local_daily_prices(bigint,jsonb) to service_role;

-- Keep the deployed national aggregation intact; add the local projection after
-- its archive/coverage validation. Replays use the independently guarded helper.
do $migration$
declare definition text;
begin
 definition:=pg_get_functiondef('public.record_fuel_national_trend_batch(bigint,jsonb)'::regprocedure);
 if position('insert into fuel_national_trend_batches' in definition)=0 then raise exception 'Unexpected national projection definition'; end if;
 definition:=replace(definition,'insert into fuel_national_trend_batches',
  'perform record_fuel_local_daily_prices(p_job_id,p_stations);'||chr(10)||' insert into fuel_national_trend_batches');
 execute definition;
end $migration$;

-- Uses the same exact-radius station selection as Home. Callers still apply
-- their Home membership/rating filters to these station IDs.
create function public.local_fuel_trend_rows(p_latitude double precision,p_longitude double precision,p_radius_miles double precision,p_fuel_type text)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare product text; nearby jsonb;
begin
 product:=case p_fuel_type when 'regular' then 'regular_gas' when 'midgrade' then 'midgrade_gas'
  when 'premium' then 'premium_gas' when 'diesel' then 'diesel' when 'e85' then 'e85' end;
 if product is null then raise exception 'Invalid fuel type'; end if;
 nearby:=nearby_fuel_station_cache(p_latitude,p_longitude,p_radius_miles);
 return (select coalesce(jsonb_agg(jsonb_build_object(
  'station_id',h.station_id,'station_name',n->'station'->>'name','latitude',n->'station'->'latitude',
  'longitude',n->'station'->'longitude','provider_id','gasbuddy','fuel_type',p_fuel_type,
  'price',(h.prices->product->>'price')::numeric,'created_at',j.observed_at,
  'updated_at_source',h.prices->product->>'postedTime') order by j.observed_at,h.station_id),'[]'::jsonb)
 from jsonb_array_elements(nearby) n join fuel_local_daily_prices h on h.station_id=n->'station'->>'id'
 join fuel_national_jobs j on j.id=h.job_id join fuel_national_runs r on r.id=j.run_id
 where r.status='complete' and j.status='succeeded' and h.prices ? product
  and j.observed_at>=now()-interval '7 days');
end $$;
revoke all on function public.local_fuel_trend_rows(double precision,double precision,double precision,text) from public,anon,authenticated;
grant execute on function public.local_fuel_trend_rows(double precision,double precision,double precision,text) to service_role;

-- Bounded derived-only cleanup; original research and raw objects are untouched.
create function public.prune_fuel_local_daily_prices() returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare affected integer;
begin
 delete from fuel_local_daily_prices where (station_id,day) in (
  select station_id,day from fuel_local_daily_prices where day<(now() at time zone 'UTC')::date-7
  order by day limit 20000 for update skip locked);
 get diagnostics affected=row_count; return affected;
end $$;
revoke all on function public.prune_fuel_local_daily_prices() from public,anon,authenticated,service_role;
select cron.schedule('fuel-local-history-retention','17 * * * *','select public.prune_fuel_local_daily_prices()');
