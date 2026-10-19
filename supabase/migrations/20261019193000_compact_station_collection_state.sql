-- Keep routine collection checks in a narrow, derived table. Original station
-- values, provider report times, raw archives, and budget guards remain intact.
create table public.fuel_station_collection_state (
 station_id text primary key references public.fuel_station_latest(station_id) on delete cascade,
 metadata_complete boolean not null,
 e85_listed boolean not null,
 price_only_compatible boolean not null,
 price_signature bytea,
 observed_at timestamptz,
 observation_catalog_id uuid,
 observation_ordinal integer
) with (fillfactor=80);
alter table public.fuel_station_collection_state enable row level security;
revoke all on public.fuel_station_collection_state from public,anon,authenticated,service_role;

create function public.sync_fuel_station_collection_state() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into fuel_station_collection_state as target
 values(new.station_id,new.metadata_observed_at is not null,new.e85_listed_at is not null,
  coalesce(new.station->'id'=to_jsonb(new.station_id),false),
  sha256(convert_to((new.station->'prices')::text,'UTF8')),
  new.observed_at,new.observation_catalog_id,new.observation_ordinal)
 on conflict(station_id) do update set metadata_complete=excluded.metadata_complete,e85_listed=excluded.e85_listed,
  price_only_compatible=excluded.price_only_compatible,price_signature=excluded.price_signature,
  observed_at=excluded.observed_at,observation_catalog_id=excluded.observation_catalog_id,observation_ordinal=excluded.observation_ordinal
 where (target.metadata_complete,target.e85_listed,target.price_only_compatible,target.price_signature,target.observed_at,target.observation_catalog_id,target.observation_ordinal)
 is distinct from (excluded.metadata_complete,excluded.e85_listed,excluded.price_only_compatible,excluded.price_signature,excluded.observed_at,excluded.observation_catalog_id,excluded.observation_ordinal);
 return new;
end $$;
revoke all on function public.sync_fuel_station_collection_state() from public,anon,authenticated,service_role;
create trigger fuel_station_collection_state_sync after insert or update of station,observed_at,metadata_observed_at,e85_listed_at,observation_catalog_id,observation_ordinal
 on public.fuel_station_latest for each row execute function public.sync_fuel_station_collection_state();

-- Bounded admin preparation. The lock excludes all station writers, including
-- metadata paths, so a stale snapshot cannot overwrite a newer compact state.
create function public.prepare_fuel_station_collection_state(p_catalog uuid,p_ordinal integer)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare affected integer;
begin
 lock table fuel_station_latest in share row exclusive mode;
 perform pg_advisory_xact_lock(hashtext('fuel_station_publication'));
 insert into fuel_station_collection_state as target
 select station_id,metadata_observed_at is not null,e85_listed_at is not null,coalesce(station->'id'=to_jsonb(station_id),false),
  sha256(convert_to((station->'prices')::text,'UTF8')),observed_at,observation_catalog_id,observation_ordinal
 from fuel_station_latest where observation_catalog_id=p_catalog and observation_ordinal=p_ordinal
 on conflict(station_id) do update set metadata_complete=excluded.metadata_complete,e85_listed=excluded.e85_listed,
  price_only_compatible=excluded.price_only_compatible,price_signature=excluded.price_signature,
  observed_at=excluded.observed_at,observation_catalog_id=excluded.observation_catalog_id,observation_ordinal=excluded.observation_ordinal
 where (target.metadata_complete,target.e85_listed,target.price_only_compatible,target.price_signature,target.observed_at,target.observation_catalog_id,target.observation_ordinal)
 is distinct from (excluded.metadata_complete,excluded.e85_listed,excluded.price_only_compatible,excluded.price_signature,excluded.observed_at,excluded.observation_catalog_id,excluded.observation_ordinal);
 get diagnostics affected=row_count;
 return affected;
end $$;
revoke all on function public.prepare_fuel_station_collection_state(uuid,integer) from public,anon,authenticated,service_role;

create or replace function public.fuel_station_metadata_needed(p_ids text[]) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from unnest(p_ids) id left join fuel_station_collection_state c on c.station_id=id
 where case when c.station_id is not null then not c.metadata_complete
 else not exists(select 1 from fuel_station_latest s where s.station_id=id and s.metadata_observed_at is not null) end);
$$;

revoke all on function public.fuel_station_metadata_needed(text[]) from public,anon,authenticated;
grant execute on function public.fuel_station_metadata_needed(text[]) to service_role;

create or replace function public.publish_fuel_station_batch(p_job_id bigint,p_stations jsonb) returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare job fuel_national_jobs; expected text[]; actual text[]; affected integer;
begin
 -- Serialize competing projections, including overlapping catalog transitions.
 -- These locks also exclude the completed-Trends publisher, even on a no-change batch.
 lock table fuel_station_latest in row exclusive mode;
 lock table fuel_station_batch_checks in row exclusive mode;
 perform pg_advisory_xact_lock(hashtext('fuel_station_publication'));
 select * into job from fuel_national_jobs where id=p_job_id and status='succeeded';
 if not found or job.observed_at is null then raise exception 'Batch must be archived successfully first'; end if;
 select station_ids into expected from fuel_national_batches where catalog_id=job.catalog_id and ordinal=job.ordinal;
 if jsonb_typeof(p_stations) is distinct from 'array' then raise exception 'Invalid stations'; end if;
 select array_agg(s->>'id' order by ord) into actual from jsonb_array_elements(p_stations) with ordinality a(s,ord);
 if actual is distinct from expected then raise exception 'Serving coverage mismatch'; end if;
 if exists(select 1 from jsonb_array_elements(p_stations) s where jsonb_typeof(s->'prices') is distinct from 'array') then raise exception 'Missing prices'; end if;
 -- Materialization makes the compact check finish before touching wide rows.
 -- Only the ordinary id/prices payload can take the fingerprint fast path;
 -- metadata, new stations/catalogs, and unknown fields use the exact old merge.
 with incoming as materialized (
  select s from jsonb_array_elements(p_stations) s
  left join fuel_station_collection_state c on c.station_id=s->>'id'
  left join fuel_station_batch_checks b on b.catalog_id=c.observation_catalog_id and b.ordinal=c.observation_ordinal
  where c.station_id is null or (
   (greatest(c.observed_at,b.observed_at) is null or greatest(c.observed_at,b.observed_at)<job.observed_at)
   and (c.observed_at is null or not c.price_only_compatible
    or jsonb_typeof(s->'id') is distinct from 'string'
    or (s-array['id','prices'])<>'{}'::jsonb
    or c.observation_catalog_id is distinct from job.catalog_id or c.observation_ordinal is distinct from job.ordinal
    or c.price_signature is distinct from sha256(convert_to((s->'prices')::text,'UTF8'))))
 )
 insert into fuel_station_latest as target(station_id,latitude,longitude,station,observed_at,job_id,metadata_observed_at,
   observation_catalog_id,observation_ordinal)
 select s->>'id',coalesce((s->>'latitude')::double precision,l.latitude),
   coalesce((s->>'longitude')::double precision,l.longitude),coalesce(l.station,'{}'::jsonb)||s,job.observed_at,job.id,
   case when s ? 'latitude' and s ? 'name' then job.observed_at else l.metadata_observed_at end,
   job.catalog_id,job.ordinal
 from incoming
 left join fuel_station_latest l on l.station_id=s->>'id'
 left join fuel_station_batch_checks b on b.catalog_id=l.observation_catalog_id and b.ordinal=l.observation_ordinal
 where (greatest(l.observed_at,b.observed_at) is null or greatest(l.observed_at,b.observed_at)<job.observed_at)
 and (l.station_id is null or l.observed_at is null
   or l.station is distinct from (coalesce(l.station,'{}'::jsonb)||s)
   or l.latitude is distinct from coalesce((s->>'latitude')::double precision,l.latitude)
   or l.longitude is distinct from coalesce((s->>'longitude')::double precision,l.longitude)
   or (l.metadata_observed_at is null and s ? 'latitude' and s ? 'name')
   or l.observation_catalog_id is distinct from job.catalog_id or l.observation_ordinal is distinct from job.ordinal)
 on conflict(station_id) do update set latitude=excluded.latitude,longitude=excluded.longitude,
   station=excluded.station,observed_at=excluded.observed_at,job_id=excluded.job_id,metadata_observed_at=excluded.metadata_observed_at,
   observation_catalog_id=excluded.observation_catalog_id,observation_ordinal=excluded.observation_ordinal
 where target.observed_at is null or target.observed_at<excluded.observed_at;
 get diagnostics affected=row_count;
 perform record_fuel_national_trend_batch(p_job_id,p_stations);
 -- Publish freshness only after content and summary succeeded in this transaction.
 insert into fuel_station_batch_checks as target(catalog_id,ordinal,observed_at,job_id,content_rows_changed)
 values(job.catalog_id,job.ordinal,job.observed_at,job.id,affected)
 on conflict(catalog_id,ordinal) do update set observed_at=excluded.observed_at,job_id=excluded.job_id,content_rows_changed=excluded.content_rows_changed
 where target.observed_at<excluded.observed_at;
 return affected;
end $$;


-- E85 availability is also part of compact state, avoiding a wide-row read
-- for each product during batch trend aggregation. Missing state falls back.
-- Reduce hourly projection memory and temporary IO without changing any
-- observation, price eligibility, E85 availability, archive, or ranking policy.
CREATE OR REPLACE FUNCTION public.record_fuel_national_trend_batch(p_job_id bigint, p_stations jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
   select s->>'id' station_id,s->'prices' prices,e->>'fuelProduct' product,
    (fuel_fresh_payment(e,job.observed_at)->>'price')::numeric price
   from jsonb_array_elements(p_stations) s cross join lateral jsonb_array_elements(s->'prices') e
  ), eligible as materialized (
   -- Materialize only these narrow values. Keeping the complete station/price
   -- JSON here spills the two-pass E85 aggregation to disk on small instances.
   select q.station_id,q.product,q.price from selected q where q.price>0 and not exists(
    select 1 from jsonb_array_elements(q.prices) lower_grade where
     ((q.product='midgrade_gas' and lower_grade->>'fuelProduct'='regular_gas') or
      (q.product='premium_gas' and lower_grade->>'fuelProduct' in ('regular_gas','midgrade_gas')))
     and round((fuel_fresh_payment(lower_grade,job.observed_at)->>'price')::numeric,3)=round(q.price,3))
  )
  select q.product,filter_e85 as requires_e85,sum(q.price) price_sum,count(*) station_count
  from eligible q cross join unnest(array[false,true]) filter_e85
  where not filter_e85 or coalesce(
   (select c.e85_listed from fuel_station_collection_state c where c.station_id=q.station_id),
   (select l.e85_listed_at is not null from fuel_station_latest l where l.station_id=q.station_id),false)
  group by q.product,filter_e85
 ) t;
end $function$;

-- The exact manifest sum stays live, but no longer needs all wide job pages.
-- Uploaded orphan objects are still included by the independent Storage sum.
create index fuel_national_live_archive_bytes on public.fuel_national_jobs(archive_bytes)
 where archive_deleted_at is null and archive_bytes is not null;
create or replace function public.fuel_national_archive_bytes() returns bigint
language sql stable security definer set search_path=public,pg_temp as $$
 select greatest(
  (select coalesce(sum(archive_bytes),0) from public.fuel_national_jobs where archive_deleted_at is null and archive_bytes is not null),
  (select coalesce(sum(case when metadata->>'size' ~ '^[0-9]+$' then (metadata->>'size')::bigint else 8000000 end),0)
   from storage.objects where bucket_id='fuel-national')
 )::bigint;
$$;
revoke all on function public.fuel_national_archive_bytes() from public,anon,authenticated,service_role;

-- Filter geographically before reading and serializing unrelated station data.
create or replace function public.nearby_fuel_station_cache(p_latitude double precision,p_longitude double precision,p_radius_miles double precision)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare longitude_span double precision;
begin
 if p_latitude is null or not p_latitude between -90 and 90 or p_longitude is null or not p_longitude between -180 and 180
   or p_radius_miles is null or not p_radius_miles between 1 and 100 then raise exception 'Invalid radius query'; end if;
 -- Conservative longitude bound for the existing spherical distance formula.
 -- Pole-crossing circles cover all longitudes; shifted intervals handle dateline wrap.
 longitude_span:=case when abs(p_latitude)+degrees(p_radius_miles/3958.7613)>=90 then 180
 else degrees(asin(least(1.0,sin(p_radius_miles/3958.7613)/cos(radians(p_latitude)))))+1e-9 end;
 return (with candidates as (
  select l.station_id,l.latitude,l.longitude,l.observed_at,l.job_id,
   l.station||jsonb_build_object('offersE85',l.e85_listed_at is not null or exists(
    select 1 from fuel_e85_directory d where d.active and d.matched_station_id=l.station_id)) station
  from fuel_station_current l where l.observed_at is not null
   and l.latitude between p_latitude-degrees(p_radius_miles/3958.7613) and p_latitude+degrees(p_radius_miles/3958.7613)
   and (l.longitude between p_longitude-longitude_span and p_longitude+longitude_span
    or l.longitude between p_longitude-longitude_span+360 and p_longitude+longitude_span+360
    or l.longitude between p_longitude-longitude_span-360 and p_longitude+longitude_span-360)
  union all
  select case when d.source='afdc' then 'afdc:'||d.source_id else d.source_id end,d.latitude,d.longitude,d.fetched_at,null::bigint,
   jsonb_build_object('id',case when d.source='afdc' then 'afdc:'||d.source_id else d.source_id end,'name',d.name,'latitude',d.latitude,'longitude',d.longitude,
    'address',jsonb_build_object('line1',d.street,'locality',d.city,'region',d.state,'postalCode',d.postal_code),
    'prices','[]'::jsonb,'offersE85',true,'availabilitySource',d.source)
  from fuel_e85_directory d where d.active and (d.canonical_source_id is null or d.canonical_source_id=d.source_id)
   and (d.matched_station_id is null or not exists(select 1 from fuel_station_current l where l.station_id=d.matched_station_id and l.observed_at is not null))
   and d.latitude between p_latitude-degrees(p_radius_miles/3958.7613) and p_latitude+degrees(p_radius_miles/3958.7613)
   and (d.longitude between p_longitude-longitude_span and p_longitude+longitude_span
    or d.longitude between p_longitude-longitude_span+360 and p_longitude+longitude_span+360
    or d.longitude between p_longitude-longitude_span-360 and p_longitude+longitude_span-360)
 ) select coalesce(jsonb_agg(jsonb_build_object('station',station,'observedAt',observed_at,'jobId',job_id) order by station_id),'[]'::jsonb)
 from candidates where 2*3958.7613*asin(sqrt(least(1.0,power(sin(radians(latitude-p_latitude)/2),2)
     +cos(radians(p_latitude))*cos(radians(latitude))*power(sin(radians(longitude-p_longitude)/2),2))))<=p_radius_miles);
end $$;

