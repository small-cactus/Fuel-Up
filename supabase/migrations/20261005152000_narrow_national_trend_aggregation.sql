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
  where not filter_e85 or exists(select 1 from fuel_station_latest l where l.station_id=q.station_id and l.e85_listed_at is not null)
  group by q.product,filter_e85
 ) t;
end $function$;
