-- Run after the migration inside a transaction that ends in ROLLBACK.
-- Fixture substitutions never survive this transaction.
delete from public.fuel_national_trend_batches;
do $$
declare j fuel_national_jobs; ids text[]; payload jsonb; totals jsonb; history jsonb;
begin
 select jobs.* into j from fuel_national_jobs jobs join fuel_national_runs r on r.id=jobs.run_id
 where r.status='complete' and r.slot_at>now()-interval '7 days' order by jobs.id limit 1;
 if j.id is null then raise exception 'A completed research sweep is required for this rollback test'; end if;
 select station_ids into ids from fuel_national_batches where catalog_id=j.catalog_id and ordinal=j.ordinal;
 select jsonb_agg(jsonb_build_object('id',id,'prices',case ord
  when 1 then jsonb_build_array(jsonb_build_object('fuelProduct','regular_gas','credit',jsonb_build_object('price',3,'postedTime',j.observed_at),'cash',jsonb_build_object('price',2,'postedTime',j.observed_at)),jsonb_build_object('fuelProduct','e85','credit',jsonb_build_object('price',2,'postedTime',j.observed_at)))
  when 2 then jsonb_build_array(jsonb_build_object('fuelProduct','regular_gas','credit',jsonb_build_object('price',100,'postedTime',j.observed_at-interval '25 hours'),'cash',jsonb_build_object('price',4,'postedTime',j.observed_at)),jsonb_build_object('fuelProduct','premium_gas','credit',jsonb_build_object('price',4,'postedTime',j.observed_at)))
  when 3 then jsonb_build_array(jsonb_build_object('fuelProduct','regular_gas','credit',jsonb_build_object('price',1,'postedTime',j.observed_at+interval '1 hour')))
  else '[]'::jsonb end) order by ord) into payload from unnest(ids) with ordinality t(id,ord);
 perform record_fuel_national_trend_batch(j.id,payload);
 select b.totals into totals from fuel_national_trend_batches b where job_id=j.id;
 if not totals @> '[{"product":"regular_gas","requires_e85":false,"price_sum":7,"station_count":2},{"product":"regular_gas","requires_e85":true,"price_sum":3,"station_count":1}]'::jsonb then raise exception 'Fresh/payment/E85 totals failed: %',totals; end if;
 if exists(select 1 from jsonb_array_elements(totals) t where t->>'product'='premium_gas') then raise exception 'Duplicate grade leaked'; end if;
 perform record_fuel_national_trend_batch(j.id,payload);
 if (select count(*) from fuel_national_trend_batches where job_id=j.id)<>1 then raise exception 'Replay duplicated a batch'; end if;
 if jsonb_array_length(national_fuel_trend_history('regular',false))<>0 then raise exception 'Incomplete summary coverage leaked'; end if;
 insert into fuel_national_trend_batches(job_id,source_sha256,totals) select id,sha256,'[]'::jsonb from fuel_national_jobs where run_id=j.run_id and id<>j.id;
 history:=national_fuel_trend_history('regular',false);
 if jsonb_array_length(history)<>1 or (history->0->>'price')::numeric<>3.5 or (history->0->>'stationCount')::integer<>2 then raise exception 'Weighted national average failed: %',history; end if;
 -- Mismatched manifest evidence must make the hour unavailable.
 update fuel_national_trend_batches set source_sha256='wrong' where job_id=j.id;
 if jsonb_array_length(national_fuel_trend_history('regular',false))<>0 then raise exception 'Mismatched hash leaked'; end if;
end $$;
