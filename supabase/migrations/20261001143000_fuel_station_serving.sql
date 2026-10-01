-- App-facing projection. Immutable research archives remain the source of truth.
create table public.fuel_station_latest (
  station_id text primary key,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  station jsonb not null,
  observed_at timestamptz,
  job_id bigint references public.fuel_national_jobs(id)
);
create index fuel_station_latest_location on public.fuel_station_latest(latitude,longitude);
alter table public.fuel_station_latest enable row level security;
revoke all on public.fuel_station_latest from anon,authenticated;

-- Coordinates come from the already collected catalog, never an app-triggered lookup.
insert into public.fuel_station_latest(station_id,latitude,longitude,station)
with inventory as materialized (select distinct unnest(b.station_ids) id from public.fuel_national_batches b join public.fuel_national_config c on c.catalog_id=b.catalog_id)
select distinct on (s->>'id') s->>'id',(s->>'latitude')::double precision,
 (s->>'longitude')::double precision,s
from public.fuel_discovery_jobs d,
 lateral jsonb_array_elements(d.payload->'scopes') scope,
 lateral jsonb_array_elements(scope->'stations') s
where d.status='succeeded' and s->>'id' is not null
 and s->>'id' in (select id from inventory)
order by s->>'id',d.completed_at desc;

-- Preserve the metadata already known locally until scheduled batches enrich it.
update public.fuel_station_latest l set station=l.station || jsonb_strip_nulls(jsonb_build_object(
 'name',p.station_name,'brands',(select jsonb_agg(jsonb_build_object('name',brand)) from unnest(p.brand_names) brand),
 'starRating',p.rating,'ratingsCount',p.user_rating_count,'address',jsonb_build_object('line1',p.address)))
from (select distinct on (station_id) * from public.station_prices where provider_id='gasbuddy' order by station_id,created_at desc) p
where p.station_id=l.station_id;

create function public.publish_fuel_station_batch(p_job_id bigint,p_stations jsonb) returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare job fuel_national_jobs; expected text[]; actual text[]; affected integer;
begin
 select * into job from fuel_national_jobs where id=p_job_id and status='succeeded';
 if not found then raise exception 'Batch must be archived successfully first'; end if;
 select station_ids into expected from fuel_national_batches where catalog_id=job.catalog_id and ordinal=job.ordinal;
 if jsonb_typeof(p_stations) is distinct from 'array' then raise exception 'Invalid stations'; end if;
 select array_agg(s->>'id' order by ord) into actual from jsonb_array_elements(p_stations) with ordinality a(s,ord);
 if actual is distinct from expected then raise exception 'Serving coverage mismatch'; end if;
 if exists(select 1 from jsonb_array_elements(p_stations) s where jsonb_typeof(s->'prices') is distinct from 'array') then raise exception 'Missing prices'; end if;
 insert into fuel_station_latest as target(station_id,latitude,longitude,station,observed_at,job_id)
 select s->>'id',coalesce((s->>'latitude')::double precision,l.latitude),
   coalesce((s->>'longitude')::double precision,l.longitude),coalesce(l.station,'{}'::jsonb)||s,job.observed_at,job.id
 from jsonb_array_elements(p_stations) s left join fuel_station_latest l on l.station_id=s->>'id'
 on conflict(station_id) do update set latitude=excluded.latitude,longitude=excluded.longitude,
   station=excluded.station,observed_at=excluded.observed_at,job_id=excluded.job_id
 where target.observed_at is null or target.observed_at<excluded.observed_at;
 get diagnostics affected=row_count;
 return affected;
end $$;

-- Archive publication and serving update share one transaction and lease fence.
create function public.finish_fuel_national_serving_job(p_id bigint,p_token uuid,p_ids text[],p_started_at timestamptz,p_observed_at timestamptz,p_path text,p_bytes bigint,p_sha256 text,p_priced integer,p_stations jsonb)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not finish_fuel_national_job(p_id,p_token,p_ids,p_started_at,p_observed_at,p_path,p_bytes,p_sha256,p_priced) then return false; end if;
 perform publish_fuel_station_batch(p_id,p_stations);
 return true;
end $$;

-- A conservative latitude index range followed by exact great-circle distance.
-- Longitude uses angular wrap, so Alaska's date-line edge works as well.
-- JSON aggregation avoids PostgREST's default 1,000-row truncation.
create function public.nearby_fuel_station_cache(p_latitude double precision,p_longitude double precision,p_radius_miles double precision)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if p_latitude is null or not p_latitude between -90 and 90 or p_longitude is null or not p_longitude between -180 and 180
   or p_radius_miles is null or not p_radius_miles between 1 and 100 then raise exception 'Invalid radius query'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('station',station,'observedAt',observed_at,'jobId',job_id) order by station_id),'[]'::jsonb)
 from fuel_station_latest where observed_at is not null
   and latitude between p_latitude-degrees(p_radius_miles/3958.7613) and p_latitude+degrees(p_radius_miles/3958.7613)
   and 2*3958.7613*asin(sqrt(least(1.0,power(sin(radians(latitude-p_latitude)/2),2)
     +cos(radians(p_latitude))*cos(radians(latitude))*power(sin(radians(longitude-p_longitude)/2),2))))<=p_radius_miles);
end $$;

revoke all on function public.publish_fuel_station_batch(bigint,jsonb),
 public.finish_fuel_national_serving_job(bigint,uuid,text[],timestamptz,timestamptz,text,bigint,text,integer,jsonb),
 public.nearby_fuel_station_cache(double precision,double precision,double precision) from public,anon,authenticated;
grant execute on function public.publish_fuel_station_batch(bigint,jsonb),
 public.finish_fuel_national_serving_job(bigint,uuid,text[],timestamptz,timestamptz,text,bigint,text,integer,jsonb),
 public.nearby_fuel_station_cache(double precision,double precision,double precision) to service_role;
