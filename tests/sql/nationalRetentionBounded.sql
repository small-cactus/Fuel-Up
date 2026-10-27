-- A large unchanged-content cohort must drain across bounded transactions,
-- preserve current public observations, and retain jobs while references remain.
do $$
declare cat uuid; old_job bigint; new_job bigint; old_run bigint; payload jsonb;
 result jsonb; before_value jsonb; after_value jsonb;
begin
 insert into fuel_national_catalogs(station_count,region_count,coverage,batch_count)
 values(101,51,'{}',1) returning id into cat;
 insert into fuel_national_batches select cat,0,array_agg('bounded-'||i order by i) from generate_series(1,101)i;
 select jsonb_agg(jsonb_build_object('id','bounded-'||i,'name','Bounded test',
  'latitude',10,'longitude',10,'prices','[]'::jsonb) order by i) into payload from generate_series(1,101)i;
 old_job:=test_job(cat,0,'2026-10-08T04:00:00Z');
 perform publish_fuel_station_batch(old_job,payload);
 select run_id into old_run from fuel_national_jobs where id=old_job;
 update fuel_national_runs set status='complete' where id=old_run;
 new_job:=test_job(cat,0,now()+interval '30 hours');
 perform publish_fuel_station_batch(new_job,payload);
 select jsonb_agg(to_jsonb(s) order by station_id) into before_value from fuel_station_current s where station_id like 'bounded-%';
 -- A missing or stale receipt must prevent detachment and pruning.
 update fuel_station_batch_checks set observed_at='2026-10-08T03:00:00Z' where catalog_id=cat;
 result:=reconcile_fuel_national_retention();
 perform test_assert((select count(*)=101 from fuel_station_latest where job_id=old_job),'Stale receipt allowed detachment');
 update fuel_station_batch_checks set observed_at=now()+interval '30 hours' where catalog_id=cat;
 result:=reconcile_fuel_national_retention();
 perform test_assert((result->>'detached_content_references')::integer=100,'Detachment budget not enforced');
 perform test_assert((select count(*)=1 from fuel_station_latest where job_id=old_job),'Wrong remaining reference count');
 perform test_assert(exists(select 1 from fuel_national_jobs where id=old_job),'Referenced job deleted before drain');
 select jsonb_agg(to_jsonb(s) order by station_id) into after_value from fuel_station_current s where station_id like 'bounded-%';
 perform test_assert(before_value=after_value,'Partial cleanup changed public station data');
 result:=reconcile_fuel_national_retention();
 perform test_assert((result->>'detached_content_references')::integer=1,'Final reference not detached');
 perform test_assert(not exists(select 1 from fuel_national_runs where id=old_run),'Drained hour was not pruned');
 select jsonb_agg(to_jsonb(s) order by station_id) into after_value from fuel_station_current s where station_id like 'bounded-%';
 perform test_assert(before_value=after_value,'Completed cleanup changed public station data');
end $$;
-- One uncovered reference must keep the whole job alive even when another
-- reference in the same old run can safely be detached.
do $$
declare cat uuid; old_job bigint; new_job bigint; old_run bigint; payload jsonb; result jsonb;
begin
 insert into fuel_national_catalogs(station_count,region_count,coverage,batch_count)
 values(2,51,'{}',1) returning id into cat;
 insert into fuel_national_batches values(cat,0,array['mixed-safe','mixed-uncovered']);
 payload:='[{"id":"mixed-safe","latitude":10,"longitude":10,"prices":[]},{"id":"mixed-uncovered","latitude":10,"longitude":10,"prices":[]}]';
 old_job:=test_job(cat,0,'2026-10-08T06:00:00Z');
 perform publish_fuel_station_batch(old_job,payload);
 select run_id into old_run from fuel_national_jobs where id=old_job;
 update fuel_national_runs set status='complete' where id=old_run;
 new_job:=test_job(cat,0,now()+interval '32 hours');
 perform publish_fuel_station_batch(new_job,payload);
 update fuel_station_latest set observed_at=now()+interval '33 hours' where station_id='mixed-uncovered';
 result:=reconcile_fuel_national_retention();
 perform test_assert((result->>'detached_content_references')::integer=1,'Safe subset was not detached');
 perform test_assert((select job_id=old_job from fuel_station_latest where station_id='mixed-uncovered'),'Uncovered reference cleared');
 perform test_assert(exists(select 1 from fuel_national_jobs where id=old_job),'Uncovered reference did not protect job');
 result:=reconcile_fuel_national_retention();
 perform test_assert((result->>'detached_content_references')::integer=0,'Repeated cleanup bypassed receipt protection');
 perform test_assert((select job_id=new_job from fuel_station_current where station_id='mixed-safe'),'Safe station lost current receipt');
 update fuel_station_batch_checks set observed_at=now()+interval '34 hours' where catalog_id=cat;
 result:=reconcile_fuel_national_retention();
 perform test_assert(not exists(select 1 from fuel_national_runs where id=old_run),'New coverage did not release deferred hour');
end $$;
select jsonb_build_object('bounded_retention_passed',true,'checks','stale receipt protection, 100-reference budget, deferred job retention, resumed pruning, exact public data equality') as result;
