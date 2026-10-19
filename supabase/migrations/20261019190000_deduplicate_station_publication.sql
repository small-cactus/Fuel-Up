-- Separate mutable station contents from the most recent verified batch check.
-- No provider, routing, raw archive, price-age, or research-window changes.
-- Membership is attached lazily on the next successful publication: no bulk
-- rewrite or fabricated observation is needed during deployment.
alter table public.fuel_station_latest
 add column observation_catalog_id uuid,
 add column observation_ordinal integer,
 add constraint fuel_station_observation_batch_fk foreign key(observation_catalog_id,observation_ordinal)
 references public.fuel_national_batches(catalog_id,ordinal),
 add constraint fuel_station_observation_pair check ((observation_catalog_id is null)=(observation_ordinal is null));
create index fuel_station_observation_batch on public.fuel_station_latest(observation_catalog_id,observation_ordinal);

create table public.fuel_station_batch_checks (
 catalog_id uuid not null,
 ordinal integer not null,
 observed_at timestamptz not null,
 content_rows_changed integer not null check(content_rows_changed>=0),
 job_id bigint not null references public.fuel_national_jobs(id),
 primary key(catalog_id,ordinal),
 foreign key(catalog_id,ordinal) references public.fuel_national_batches(catalog_id,ordinal)
);
create index fuel_station_batch_checks_job on public.fuel_station_batch_checks(job_id);
alter table public.fuel_station_batch_checks enable row level security;
revoke all on public.fuel_station_batch_checks from public,anon,authenticated,service_role;

-- Old content may stay unchanged past the eight-day metadata window. Expiring
-- its old job reference must not retain whole runs forever or delete station data.
-- The last successful check remains protected independently by the receipt FK.
alter table public.fuel_station_latest drop constraint fuel_station_latest_job_id_fkey;
alter table public.fuel_station_latest add constraint fuel_station_latest_job_id_fkey
 foreign key(job_id) references public.fuel_national_jobs(id) on delete set null;

-- Base observed_at/job_id describe the last content write. All app observations
-- resolve through this view so identical prices still report a recent check.
create view public.fuel_station_current as
 select l.station_id,l.latitude,l.longitude,l.station,
 greatest(l.observed_at,b.observed_at) observed_at,
 case when b.observed_at>=l.observed_at or l.observed_at is null then b.job_id else l.job_id end job_id,
 l.metadata_observed_at,l.e85_listed_at
 from public.fuel_station_latest l left join public.fuel_station_batch_checks b
 on b.catalog_id=l.observation_catalog_id and b.ordinal=l.observation_ordinal;
revoke all on public.fuel_station_current from public,anon,authenticated,service_role;

-- Admin-only, bounded preparation of existing observations. Copies membership
-- from the actual content job; never advances a timestamp or rewrites prices.
create function public.attach_fuel_station_observation_batch(p_catalog uuid,p_ordinal integer)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare affected integer;
begin
 lock table fuel_station_latest in row exclusive mode;
 perform pg_advisory_xact_lock(hashtext('fuel_station_publication'));
 update fuel_station_latest s set observation_catalog_id=j.catalog_id,observation_ordinal=j.ordinal
 from fuel_national_jobs j where s.job_id=j.id and s.observation_catalog_id is null
 and s.observed_at=j.observed_at and j.catalog_id=p_catalog and j.ordinal=p_ordinal;
 get diagnostics affected=row_count;
 return affected;
end $$;
revoke all on function public.attach_fuel_station_observation_batch(uuid,integer) from public,anon,authenticated,service_role;

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
 insert into fuel_station_latest as target(station_id,latitude,longitude,station,observed_at,job_id,metadata_observed_at,
   observation_catalog_id,observation_ordinal)
 select s->>'id',coalesce((s->>'latitude')::double precision,l.latitude),
   coalesce((s->>'longitude')::double precision,l.longitude),coalesce(l.station,'{}'::jsonb)||s,job.observed_at,job.id,
   case when s ? 'latitude' and s ? 'name' then job.observed_at else l.metadata_observed_at end,
   job.catalog_id,job.ordinal
 from jsonb_array_elements(p_stations) s
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

create or replace function public.nearby_fuel_station_cache(p_latitude double precision,p_longitude double precision,p_radius_miles double precision)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if p_latitude is null or not p_latitude between -90 and 90 or p_longitude is null or not p_longitude between -180 and 180
   or p_radius_miles is null or not p_radius_miles between 1 and 100 then raise exception 'Invalid radius query'; end if;
 return (with candidates as (
  select l.station_id,l.latitude,l.longitude,l.observed_at,l.job_id,
   l.station||jsonb_build_object('offersE85',l.e85_listed_at is not null or exists(
    select 1 from fuel_e85_directory d where d.active and d.matched_station_id=l.station_id)) station
  from fuel_station_current l where l.observed_at is not null
   and l.latitude between p_latitude-degrees(p_radius_miles/3958.7613) and p_latitude+degrees(p_radius_miles/3958.7613)
  union all
  select case when d.source='afdc' then 'afdc:'||d.source_id else d.source_id end,d.latitude,d.longitude,d.fetched_at,null::bigint,
   jsonb_build_object('id',case when d.source='afdc' then 'afdc:'||d.source_id else d.source_id end,'name',d.name,'latitude',d.latitude,'longitude',d.longitude,
    'address',jsonb_build_object('line1',d.street,'locality',d.city,'region',d.state,'postalCode',d.postal_code),
    'prices','[]'::jsonb,'offersE85',true,'availabilitySource',d.source)
  from fuel_e85_directory d where d.active and (d.canonical_source_id is null or d.canonical_source_id=d.source_id)
   and (d.matched_station_id is null or not exists(select 1 from fuel_station_current l where l.station_id=d.matched_station_id and l.observed_at is not null))
   and d.latitude between p_latitude-degrees(p_radius_miles/3958.7613) and p_latitude+degrees(p_radius_miles/3958.7613)
 ) select coalesce(jsonb_agg(jsonb_build_object('station',station,'observedAt',observed_at,'jobId',job_id) order by station_id),'[]'::jsonb)
 from candidates where 2*3958.7613*asin(sqrt(least(1.0,power(sin(radians(latitude-p_latitude)/2),2)
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
  from fuel_station_price_lookup q join fuel_station_current l using(station_id)
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
 lock table fuel_station_batch_checks in share mode;
 if exists(select 1 from fuel_station_batch_checks b join fuel_national_jobs j on j.id=b.job_id
     join fuel_national_runs r on r.id=j.run_id where r.slot_at>latest.slot_at) then return false; end if;
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

-- Preserve every retention boundary and protection; constrain only query planning.
CREATE OR REPLACE FUNCTION public.reconcile_fuel_national_retention()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare marked integer; removed integer:=0; picked bigint;
begin
 if not pg_try_advisory_xact_lock(71892300) then return jsonb_build_object('busy',true); end if;
 update fuel_national_jobs j set archive_deleted_at=now()
 from fuel_national_runs r,fuel_national_config c
 where j.run_id=r.id and c.continuous and r.slot_at>=c.operational_starts_at
  and r.slot_at>='2026-10-07T19:00:00Z'::timestamptz
  and r.deadline_at<now()-make_interval(hours=>c.operational_raw_hours)
  and r.status in ('complete','partial') and j.object_path is not null and j.archive_deleted_at is null
  and not exists(select 1 from storage.objects o where o.bucket_id='fuel-national' and o.name=j.object_path)
  and not exists(select 1 from fuel_national_trends_cache cache where cache.run_id=r.id);
 get diagnostics marked=row_count;
 -- Retain eight days of derived history for the seven-day app chart. Protect
 -- serving references and failed-run evidence; the compact historic research
 -- rows never enter this path. At most four old operational hours per invocation.
 for picked in select r.id from fuel_national_runs r cross join fuel_national_config c
  where c.continuous and r.slot_at>=c.operational_starts_at
   and r.slot_at>='2026-10-07T19:00:00Z'::timestamptz and r.deadline_at<now()-interval '8 days'
   and r.status in ('complete','partial')
   and not exists(select 1 from storage.objects o where o.bucket_id='fuel-national' and split_part(o.name,'/',1)=r.id::text)
   and not exists(select 1 from fuel_national_trends_cache cache where cache.run_id=r.id)
   -- Keep this existence check correlated to one candidate run. Without the
   -- optimization fence, a merge plan scans the entire current station cache.
   and not exists(select 1 from fuel_station_batch_checks b join fuel_national_jobs j on j.id=b.job_id where j.run_id=r.id)
   and not exists(select 1 from fuel_station_latest s join fuel_national_jobs j on j.id=s.job_id
     where j.run_id=r.id and not exists(select 1 from fuel_station_batch_checks b
       where b.catalog_id=s.observation_catalog_id and b.ordinal=s.observation_ordinal and b.observed_at>=s.observed_at) offset 0)
   and not exists(select 1 from fuel_national_jobs j join fuel_projection_repairs p on p.job_id=j.id where j.run_id=r.id and p.lease_until>now())
  order by r.slot_at limit 4 for update of r
 loop
  -- Preserve error evidence compactly without dangling foreign keys.
  update fuel_national_events set retained_job_id=job_id,retained_run_id=picked,job_id=null where job_id in(select id from fuel_national_jobs where run_id=picked);
  delete from fuel_projection_repairs where job_id in(select id from fuel_national_jobs where run_id=picked);
  delete from fuel_national_trend_batches where job_id in(select id from fuel_national_jobs where run_id=picked);
  delete from fuel_national_jobs where run_id=picked;
  delete from fuel_national_runs where id=picked;
  removed:=removed+1;
 end loop;
 return jsonb_build_object('marked_archives',marked,'removed_operational_hours',removed);
end $function$
;
