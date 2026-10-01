-- Fetch names/address/ratings once within scheduled batches, not every hour.
-- This keeps hourly archive size and provider field resolutions bounded.
alter table public.fuel_station_latest add column metadata_observed_at timestamptz;
create function public.fuel_station_metadata_needed(p_ids text[]) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from unnest(p_ids) id left join fuel_station_latest s on s.station_id=id where s.metadata_observed_at is null);
$$;
revoke all on function public.fuel_station_metadata_needed(text[]) from public,anon,authenticated;
grant execute on function public.fuel_station_metadata_needed(text[]) to service_role;

create or replace function public.publish_fuel_station_batch(p_job_id bigint,p_stations jsonb) returns integer
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
 insert into fuel_station_latest as target(station_id,latitude,longitude,station,observed_at,job_id,metadata_observed_at)
 select s->>'id',coalesce((s->>'latitude')::double precision,l.latitude),
   coalesce((s->>'longitude')::double precision,l.longitude),coalesce(l.station,'{}'::jsonb)||s,job.observed_at,job.id,
   case when s ? 'latitude' and s ? 'name' then job.observed_at else l.metadata_observed_at end
 from jsonb_array_elements(p_stations) s left join fuel_station_latest l on l.station_id=s->>'id'
 on conflict(station_id) do update set latitude=excluded.latitude,longitude=excluded.longitude,
   station=excluded.station,observed_at=excluded.observed_at,job_id=excluded.job_id,metadata_observed_at=excluded.metadata_observed_at
 where target.observed_at is null or target.observed_at<excluded.observed_at;
 get diagnostics affected=row_count;
 return affected;
end $$;

