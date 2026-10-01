-- Compact, immutable derived totals; raw archives remain authoritative.
create table public.fuel_national_trend_batches (
 job_id bigint primary key references public.fuel_national_jobs(id),
 source_sha256 text not null,
 totals jsonb not null check(jsonb_typeof(totals)='array')
);
alter table public.fuel_national_trend_batches enable row level security;
revoke all on public.fuel_national_trend_batches from public,anon,authenticated;

create function public.record_fuel_national_trend_batch(p_job_id bigint,p_stations jsonb)
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
   select s->>'id' station_id,e->>'fuelProduct' product,
    (fuel_fresh_payment(e,job.observed_at)->>'price')::numeric price
   from jsonb_array_elements(p_stations) s cross join lateral jsonb_array_elements(s->'prices') e
  ), eligible as (
   select q.* from selected q where q.price>0 and not exists(
    select 1 from selected lower_grade where lower_grade.station_id=q.station_id
     and ((q.product='midgrade_gas' and lower_grade.product='regular_gas') or
      (q.product='premium_gas' and lower_grade.product in ('regular_gas','midgrade_gas')))
     and round(lower_grade.price,3)=round(q.price,3))
  )
  select q.product,filter_e85 as requires_e85,sum(q.price) price_sum,count(*) station_count
  from eligible q cross join unnest(array[false,true]) filter_e85
  where not filter_e85 or exists(select 1 from selected e where e.station_id=q.station_id and e.product='e85' and e.price>0)
  group by q.product,filter_e85
 ) t;
end $$;
revoke all on function public.record_fuel_national_trend_batch(bigint,jsonb) from public,anon,authenticated;
grant execute on function public.record_fuel_national_trend_batch(bigint,jsonb) to service_role;

-- Use the existing fenced publication transaction, without another provider request.
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
 perform record_fuel_national_trend_batch(p_job_id,p_stations);
 return affected;
end $$;


create function public.national_fuel_trend_history(p_fuel_type text,p_requires_e85 boolean default false)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare product text; result jsonb;
begin
 product := case p_fuel_type when 'regular' then 'regular_gas' when 'midgrade' then 'midgrade_gas'
  when 'premium' then 'premium_gas' when 'diesel' then 'diesel' when 'e85' then 'e85' end;
 if product is null then raise exception 'Invalid fuel type'; end if;
 select coalesce(jsonb_agg(to_jsonb(points) order by date),'[]'::jsonb) into result from (
  select r.slot_at as date,sum((t->>'price_sum')::numeric)/sum((t->>'station_count')::bigint) price,
   sum((t->>'station_count')::bigint) as "stationCount", min(j.started_at) as "observationStart",max(j.observed_at) as "observationEnd"
  from fuel_national_runs r join fuel_national_jobs j on j.run_id=r.id
   join fuel_national_trend_batches b on b.job_id=j.id and b.source_sha256=j.sha256
   cross join lateral jsonb_array_elements(b.totals) t
  where r.status='complete' and r.slot_at>=now()-interval '7 days'
   and (select count(*) from fuel_national_jobs all_jobs join fuel_national_trend_batches all_batches
    on all_batches.job_id=all_jobs.id and all_batches.source_sha256=all_jobs.sha256
    where all_jobs.run_id=r.id and all_jobs.status='succeeded')=r.expected_batches
   and t->>'product'=product and (t->>'requires_e85')::boolean=p_requires_e85
  group by r.id,r.slot_at having sum((t->>'station_count')::bigint)>0
 ) points;
 return result;
end $$;
revoke all on function public.national_fuel_trend_history(text,boolean) from public,anon,authenticated;
grant execute on function public.national_fuel_trend_history(text,boolean) to service_role;
