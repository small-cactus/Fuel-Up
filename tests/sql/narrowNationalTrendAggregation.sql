-- Integration test: invoke in a transaction and roll back. The comparison
-- baseline is the deployed 20261001193000 function, loaded by the test runner.
-- Only three archived jobs' summaries are temporarily replaced; raw archives,
-- provider collection and the serving projection are never modified.
do $$
declare j fuel_national_jobs; ids text[]; payload jsonb; old_totals jsonb; new_totals jsonb; n integer:=0;
begin
 for j in select distinct on (execution_region) * from fuel_national_jobs
   where status='succeeded' and observed_at is not null
   order by execution_region,id desc
 loop
  select station_ids into ids from fuel_national_batches where catalog_id=j.catalog_id and ordinal=j.ordinal;
  select jsonb_agg(jsonb_build_object('id',a.id,'prices',coalesce(l.station->'prices','[]'::jsonb)) order by a.ord)
   into payload from unnest(ids) with ordinality a(id,ord) left join fuel_station_latest l on l.station_id=a.id;
  delete from fuel_national_trend_batches where job_id=j.id;
  perform pg_temp.record_fuel_national_trend_batch_baseline(j.id,payload);
  select jsonb_agg(x order by x->>'product',x->>'requires_e85') into old_totals
   from fuel_national_trend_batches b cross join lateral jsonb_array_elements(b.totals) x where b.job_id=j.id;
  delete from fuel_national_trend_batches where job_id=j.id;
  perform record_fuel_national_trend_batch(j.id,payload);
  select jsonb_agg(x order by x->>'product',x->>'requires_e85') into new_totals
   from fuel_national_trend_batches b cross join lateral jsonb_array_elements(b.totals) x where b.job_id=j.id;
  if old_totals is distinct from new_totals then raise exception 'Regional parity failed for %',j.execution_region; end if;
  n:=n+1;
 end loop;
 if n<>3 then raise exception 'Expected all three regional fixtures, found %',n; end if;

 -- Explicit policy cases, independent of whichever live prices happen to exist.
 update fuel_station_latest set e85_listed_at=case when station_id=ids[1] then j.observed_at else null end where station_id=any(ids[1:3]);
 select jsonb_agg(jsonb_build_object('id',id,'prices',case ord
  when 1 then jsonb_build_array(jsonb_build_object('fuelProduct','regular_gas','credit',jsonb_build_object('price',3,'postedTime',j.observed_at),'cash',jsonb_build_object('price',2,'postedTime',j.observed_at)))
  when 2 then jsonb_build_array(jsonb_build_object('fuelProduct','regular_gas','credit',jsonb_build_object('price',100,'postedTime',j.observed_at-interval '25 hours'),'cash',jsonb_build_object('price',4,'postedTime',j.observed_at)),jsonb_build_object('fuelProduct','premium_gas','credit',jsonb_build_object('price',4,'postedTime',j.observed_at)))
  when 3 then jsonb_build_array(jsonb_build_object('fuelProduct','regular_gas','credit',jsonb_build_object('price',1,'postedTime',j.observed_at+interval '1 hour')))
  else '[]'::jsonb end) order by ord) into payload from unnest(ids) with ordinality a(id,ord);
 delete from fuel_national_trend_batches where job_id=j.id;
 perform record_fuel_national_trend_batch(j.id,payload);
 select totals into new_totals from fuel_national_trend_batches where job_id=j.id;
 if not new_totals @> '[{"product":"regular_gas","requires_e85":false,"price_sum":7,"station_count":2},{"product":"regular_gas","requires_e85":true,"price_sum":3,"station_count":1}]'::jsonb
   or jsonb_array_length(new_totals)<>2 then raise exception 'Freshness, payment, duplicate-grade or E85 policy changed: %',new_totals; end if;
 perform record_fuel_national_trend_batch(j.id,'[]'::jsonb);
 if (select totals from fuel_national_trend_batches where job_id=j.id) is distinct from new_totals then raise exception 'Replay changed immutable summary'; end if;
 delete from fuel_national_trend_batches where job_id=j.id;
 begin
  perform record_fuel_national_trend_batch(j.id,'[]'::jsonb);
  raise exception 'Accepted coverage mismatch';
 exception when others then if sqlerrm<>'Trend coverage mismatch' then raise; end if; end;
 begin
  perform record_fuel_national_trend_batch(-1,payload);
  raise exception 'Accepted unarchived batch';
 exception when others then if sqlerrm<>'Verified archived batch required' then raise; end if; end;
end $$;
