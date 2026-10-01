-- E85 access is independent of price freshness. An omitted hourly quote does
-- not establish that a station removed its E85 pumps. Keep provider listing evidence.
alter table public.fuel_station_latest add column e85_listed_at timestamptz;
create function public.remember_station_e85() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
 if TG_OP='UPDATE' then new.e85_listed_at:=old.e85_listed_at; end if;
 if exists(select 1 from jsonb_array_elements(new.station->'prices') e where e->>'fuelProduct'='e85') then
  new.e85_listed_at:=greatest(new.e85_listed_at,coalesce(new.observed_at,now()));
 end if;
 return new;
end $$;
create trigger remember_station_e85 before insert or update of station on public.fuel_station_latest
 for each row execute function public.remember_station_e85();
revoke all on function public.remember_station_e85() from public,anon,authenticated;
update public.fuel_station_latest set e85_listed_at=coalesce(observed_at,now())
 where exists(select 1 from jsonb_array_elements(station->'prices') e where e->>'fuelProduct'='e85');
-- Discovery responses explicitly filtered to E85 provide independent listing
-- evidence too, including stations whose price response has never contained E85.
update public.fuel_station_latest l set e85_listed_at=greatest(l.e85_listed_at,d.observed_at)
from (select s->>'id' station_id,max(j.completed_at) observed_at
 from public.fuel_discovery_jobs j cross join lateral jsonb_array_elements(j.payload->'scopes') scope
 cross join lateral jsonb_array_elements(scope->'stations') s
 where j.status='succeeded' and scope->>'fuelId'='5' and scope->>'scopeMatches'='true'
 group by s->>'id') d where l.station_id=d.station_id;

create or replace function public.nearby_fuel_station_cache(p_latitude double precision,p_longitude double precision,p_radius_miles double precision)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if p_latitude is null or not p_latitude between -90 and 90 or p_longitude is null or not p_longitude between -180 and 180
   or p_radius_miles is null or not p_radius_miles between 1 and 100 then raise exception 'Invalid radius query'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('station',station||jsonb_build_object('offersE85',e85_listed_at is not null),'observedAt',observed_at,'jobId',job_id) order by station_id),'[]'::jsonb)
 from fuel_station_latest where observed_at is not null
   and latitude between p_latitude-degrees(p_radius_miles/3958.7613) and p_latitude+degrees(p_radius_miles/3958.7613)
   and 2*3958.7613*asin(sqrt(least(1.0,power(sin(radians(latitude-p_latitude)/2),2)
     +cos(radians(p_latitude))*cos(radians(latitude))*power(sin(radians(longitude-p_longitude)/2),2))))<=p_radius_miles);
end $$;


create or replace function public.national_fuel_station_cache(p_fuel_type text,p_requires_e85 boolean default false)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare product text; as_of timestamptz := now(); result jsonb;
begin
 product := case p_fuel_type when 'regular' then 'regular_gas' when 'midgrade' then 'midgrade_gas'
  when 'premium' then 'premium_gas' when 'diesel' then 'diesel' when 'e85' then 'e85' end;
 if product is null then raise exception 'Invalid fuel type'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('station',station,'observedAt',observed_at) order by price,station_id),'[]'::jsonb)
 into result from (
  select l.station_id,l.station||jsonb_build_object('offersE85',l.e85_listed_at is not null) station,l.observed_at,q.price
  from fuel_station_price_lookup q join fuel_station_latest l using(station_id)
  where q.fuel_product=product and q.reported_at between as_of-interval '24 hours' and as_of
   and l.observed_at is not null and l.latitude between -90 and 90 and l.longitude between -180 and 180
   and (q.payment='credit' or not exists(select 1 from fuel_station_price_lookup credit
    where credit.station_id=q.station_id and credit.fuel_product=product and credit.payment='credit'
    and credit.reported_at between as_of-interval '24 hours' and as_of))
   and not exists(select 1 from jsonb_array_elements(l.station->'prices') lower_grade
    where ((p_fuel_type='midgrade' and lower_grade->>'fuelProduct'='regular_gas') or
     (p_fuel_type='premium' and lower_grade->>'fuelProduct' in ('regular_gas','midgrade_gas')))
    and round((fuel_fresh_payment(lower_grade,as_of)->>'price')::numeric,3)=round(q.price,3))
   and (not p_requires_e85 or l.e85_listed_at is not null)
  order by q.price,q.station_id limit 5
 ) ranked;
 return result;
end $$;

-- New summaries use availability; existing research summaries stay untouched.
create or replace function public.record_fuel_national_trend_batch(p_job_id bigint,p_stations jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare job fuel_national_jobs; expected text[]; actual text[];
begin
 select * into job from fuel_national_jobs where id=p_job_id and status='succeeded';
 if not found then raise exception 'Verified archived batch required'; end if;
 if exists(select 1 from fuel_national_trend_batches where job_id=p_job_id) then return; end if;
 select station_ids into expected from fuel_national_batches where catalog_id=job.catalog_id and ordinal=job.ordinal;
 select array_agg(s->>'id' order by ord) into actual from jsonb_array_elements(p_stations) with ordinality a(s,ord);
 if actual is distinct from expected then raise exception 'Trend coverage mismatch'; end if;
 insert into fuel_national_trend_batches(job_id,source_sha256,totals)
 select p_job_id,job.sha256,coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (
  with selected as (
   select s station,e->>'fuelProduct' product,
    (fuel_fresh_payment(e,job.observed_at)->>'price')::numeric price
   from jsonb_array_elements(p_stations) s cross join lateral jsonb_array_elements(s->'prices') e
  ), eligible as (
   select q.* from selected q where q.price>0 and not exists(
    select 1 from jsonb_array_elements(q.station->'prices') lower_grade where
     ((q.product='midgrade_gas' and lower_grade->>'fuelProduct'='regular_gas') or
      (q.product='premium_gas' and lower_grade->>'fuelProduct' in ('regular_gas','midgrade_gas')))
     and round((fuel_fresh_payment(lower_grade,job.observed_at)->>'price')::numeric,3)=round(q.price,3))
  )
  select q.product,filter_e85 as requires_e85,sum(q.price) price_sum,count(*) station_count
  from eligible q cross join unnest(array[false,true]) filter_e85
  where not filter_e85 or exists(select 1 from fuel_station_latest l where l.station_id=q.station->>'id' and l.e85_listed_at is not null)
  group by q.product,filter_e85
 ) t;
end $$;

-- Re-publish safely once the station projection is from a completed sweep.
-- Keep the prior published cache available while a sweep is in progress.
alter table public.fuel_national_trends_cache add column e85_availability_version integer not null default 0;
create or replace function public.publish_completed_national_trends() returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare latest fuel_national_runs; grade text; filter_e85 boolean;
begin
 if not pg_try_advisory_xact_lock(hashtext('publish_completed_national_trends')) then return false; end if;
 select r.* into latest from fuel_national_runs r join fuel_national_config c on c.catalog_id=r.catalog_id
 where r.status='complete' order by r.slot_at desc limit 1;
 if not found then return false; end if;
 if (select count(*) from fuel_national_trends_cache where run_id=latest.id and e85_availability_version=1)=10 then return false; end if;
 -- The last worker commits its archive, station projection and summary together.
 if (select count(*) from fuel_national_jobs j join fuel_national_trend_batches b
     on b.job_id=j.id and b.source_sha256=j.sha256
     where j.run_id=latest.id and j.status='succeeded')<>latest.expected_batches then return false; end if;
 -- Hold the projection steady during the short publication transaction. If a
 -- newer sweep has already written prices, wait for it rather than publish a mix.
 lock table fuel_station_latest in share mode;
 if exists(select 1 from fuel_station_latest l join fuel_national_jobs j on j.id=l.job_id
     join fuel_national_runs r on r.id=j.run_id where r.slot_at>latest.slot_at) then return false; end if;
 foreach grade in array array['regular','midgrade','premium','diesel','e85'] loop
  foreach filter_e85 in array array[false,true] loop
   insert into fuel_national_trends_cache(fuel_type,requires_e85,run_id,completed_at,payload,e85_availability_version)
   values(grade,filter_e85,latest.id,latest.completed_at,jsonb_build_object(
     'stations',national_fuel_station_cache(grade,filter_e85),
     'history',national_fuel_trend_history(grade,filter_e85),'historyError',null),1)
   on conflict(fuel_type,requires_e85) do update set run_id=excluded.run_id,
     completed_at=excluded.completed_at,published_at=now(),payload=excluded.payload,e85_availability_version=1;
  end loop;
 end loop;
 return true;
end $$;
select public.publish_completed_national_trends();
