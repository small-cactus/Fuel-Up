-- One protected read avoids serial Edge-to-DB round trips. Complete-sweep
-- eligibility is counted once per run, instead of once per expanded total.
create or replace function public.national_fuel_trend_history(p_fuel_type text,p_requires_e85 boolean default false)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare product text; result jsonb;
begin
 product:=case p_fuel_type when 'regular' then 'regular_gas' when 'midgrade' then 'midgrade_gas'
  when 'premium' then 'premium_gas' when 'diesel' then 'diesel' when 'e85' then 'e85' end;
 if product is null then raise exception 'Invalid fuel type'; end if;
 with complete_runs as materialized (
  select r.id,r.slot_at from fuel_national_runs r
   join fuel_national_jobs j on j.run_id=r.id and j.status='succeeded'
   join fuel_national_trend_batches b on b.job_id=j.id and b.source_sha256=j.sha256
  where r.status='complete' and r.slot_at>=now()-interval '7 days'
  group by r.id,r.slot_at having count(*)=r.expected_batches
 ), points as (
  select r.slot_at as date,sum((t->>'price_sum')::numeric)/sum((t->>'station_count')::bigint) price,
   sum((t->>'station_count')::bigint) as "stationCount",min(j.started_at) as "observationStart",max(j.observed_at) as "observationEnd"
  from complete_runs r join fuel_national_jobs j on j.run_id=r.id
   join fuel_national_trend_batches b on b.job_id=j.id and b.source_sha256=j.sha256
   cross join lateral jsonb_array_elements(b.totals) t
  where t->>'product'=product and (t->>'requires_e85')::boolean=p_requires_e85
  group by r.id,r.slot_at having sum((t->>'station_count')::bigint)>0
 ) select coalesce(jsonb_agg(to_jsonb(points) order by date),'[]'::jsonb) into result from points;
 return result;
end $$;

create function public.national_fuel_trends(p_fuel_type text,p_requires_e85 boolean default false)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare stations jsonb; history jsonb; history_error text;
begin
 stations:=national_fuel_station_cache(p_fuel_type,p_requires_e85);
 begin
  history:=national_fuel_trend_history(p_fuel_type,p_requires_e85);
 exception when others then
  history:='[]'::jsonb; history_error:='Unable to load national price history.';
 end;
 return jsonb_build_object('stations',stations,'history',history,'historyError',history_error);
end $$;
revoke all on function public.national_fuel_trends(text,boolean) from public,anon,authenticated;
grant execute on function public.national_fuel_trends(text,boolean) to service_role;
