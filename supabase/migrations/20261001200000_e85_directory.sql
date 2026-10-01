-- Availability metadata is separate from prices and immutable research history.
create table public.fuel_e85_directory (
 source_id text primary key,
 name text not null,
 street text not null,
 city text not null,
 state text not null,
 postal_code text,
 latitude double precision not null check(latitude between -90 and 90),
 longitude double precision not null check(longitude between -180 and 180),
 confirmed_at date,
 source_updated_at timestamptz,
 fetched_at timestamptz not null,
 active boolean not null default true,
 matched_station_id text,
 match_rule text,
 access_hours text
);
create index fuel_e85_directory_latitude on public.fuel_e85_directory(latitude) where active;
create index fuel_e85_directory_match on public.fuel_e85_directory(matched_station_id) where active;
alter table public.fuel_e85_directory enable row level security;
revoke all on public.fuel_e85_directory from public,anon,authenticated;
grant all on public.fuel_e85_directory to service_role;

create or replace function public.nearby_fuel_station_cache(p_latitude double precision,p_longitude double precision,p_radius_miles double precision)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if p_latitude is null or not p_latitude between -90 and 90 or p_longitude is null or not p_longitude between -180 and 180
   or p_radius_miles is null or not p_radius_miles between 1 and 100 then raise exception 'Invalid radius query'; end if;
 return (with candidates as (
  select l.station_id,l.latitude,l.longitude,l.observed_at,l.job_id,
   l.station||jsonb_build_object('offersE85',l.e85_listed_at is not null or exists(
    select 1 from fuel_e85_directory d where d.active and d.matched_station_id=l.station_id)) station
  from fuel_station_latest l where l.observed_at is not null
   and l.latitude between p_latitude-degrees(p_radius_miles/3958.7613) and p_latitude+degrees(p_radius_miles/3958.7613)
  union all
  select 'afdc:'||d.source_id,d.latitude,d.longitude,d.fetched_at,null::bigint,
   jsonb_build_object('id','afdc:'||d.source_id,'name',d.name,'latitude',d.latitude,'longitude',d.longitude,
    'address',jsonb_build_object('line1',d.street,'locality',d.city,'region',d.state,'postalCode',d.postal_code),
    'prices','[]'::jsonb,'offersE85',true,'availabilitySource','afdc')
  from fuel_e85_directory d where d.active
   and (d.matched_station_id is null or not exists(select 1 from fuel_station_latest l where l.station_id=d.matched_station_id and l.observed_at is not null))
   and d.latitude between p_latitude-degrees(p_radius_miles/3958.7613) and p_latitude+degrees(p_radius_miles/3958.7613)
 ) select coalesce(jsonb_agg(jsonb_build_object('station',station,'observedAt',observed_at,'jobId',job_id) order by station_id),'[]'::jsonb)
 from candidates where 2*3958.7613*asin(sqrt(least(1.0,power(sin(radians(latitude-p_latitude)/2),2)
     +cos(radians(p_latitude))*cos(radians(latitude))*power(sin(radians(longitude-p_longitude)/2),2))))<=p_radius_miles);
end $$;
