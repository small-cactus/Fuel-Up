-- Real PostgreSQL tests in a disposable local cluster, never production fixtures.
create function test_assert(ok boolean,message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception '%',message; end if; end $$;
create function test_job(cat uuid,ord integer,observed timestamptz) returns bigint language plpgsql as $$
declare r bigint; j bigint;
begin
 insert into fuel_national_runs(slot_at,deadline_at,catalog_id,expected_stations,expected_batches)
 values(observed,observed+interval '1 hour',cat,(select cardinality(station_ids) from fuel_national_batches where catalog_id=cat and ordinal=ord),1) returning id into r;
 insert into fuel_national_jobs(run_id,catalog_id,ordinal,status,observed_at,sha256)
 values(r,cat,ord,'succeeded',observed,repeat('a',64)) returning id into j;
 return j;
end $$;
create temp table measurements(label text,baseline_rows integer,candidate_rows integer,baseline_wal_bytes numeric,candidate_wal_bytes numeric);
do $$
declare cat uuid; other_cat uuid; j1 bigint; j2 bigint; j3 bigint; j4 bigint; late bigint; j5 bigint;
 payload jsonb; changed jsonb; answer jsonb; original_tuple text; original_reported timestamptz:=now()-interval '4 hours'; saved_run bigint;
begin
 insert into fuel_national_catalogs(station_count,region_count,coverage,batch_count) values(3,51,'{}',1) returning id into cat;
 insert into fuel_national_batches values(cat,0,array['test-1','test-2','test-3']);
 update fuel_national_config set catalog_id=cat,continuous=true,operational_starts_at='2026-10-07T19:00:00Z';
 select jsonb_agg(jsonb_build_object('id','test-'||i,'name','Station '||i,'latitude',0,'longitude',0,
 'prices',jsonb_build_array(jsonb_build_object('fuelProduct',case when i=3 then 'e85' else 'regular_gas' end,
 'credit',jsonb_build_object('price',3+i::numeric/10,'postedTime',original_reported))))) into payload from generate_series(1,3)i;
 j1:=test_job(cat,0,now()-interval '3 hours');
 perform test_assert(publish_fuel_station_batch(j1,payload)=3,'First publication must write all stations');
 select ctid::text into original_tuple from fuel_station_latest where station_id='test-1';
 update fuel_national_runs set status='complete',completed_at=now() where id=(select run_id from fuel_national_jobs where id=j1);
 perform test_assert(publish_completed_national_trends(),'First complete sweep must publish');
 select max(run_id) into saved_run from fuel_national_trends_cache;
 j2:=test_job(cat,0,now()-interval '2 hours');
 perform test_assert(publish_fuel_station_batch(j2,payload)=0,'Unchanged observation rewrote station contents');
 perform test_assert((select ctid::text=original_tuple from fuel_station_latest where station_id='test-1'),'Unchanged station tuple changed');
 perform test_assert((select job_id=j2 and observed_at=now()-interval '2 hours' from fuel_station_current where station_id='test-1'),'Fresh check was lost');
 perform test_assert((select reported_at=original_reported from fuel_station_price_lookup where station_id='test-1'),'Provider report time was falsely refreshed');
 answer:=nearby_fuel_station_cache(0,0,5);
 perform test_assert(jsonb_array_length(answer)=3 and (answer->0->>'jobId')::bigint=j2,'Nearby API failed to resolve batch check');
 perform test_assert((national_fuel_station_cache('regular',false)->0->>'observedAt')::timestamptz=now()-interval '2 hours','Leaderboard check timestamp is stale');
 delete from fuel_national_trends_cache where fuel_type='diesel';
 perform test_assert(not publish_completed_national_trends(),'Unchanged partial newer sweep leaked into completed Trends');
 update fuel_national_runs set status='complete',completed_at=now() where id=(select run_id from fuel_national_jobs where id=j2);
 perform test_assert(publish_completed_national_trends(),'Complete unchanged sweep failed to publish');
 perform test_assert((select count(*)=10 from fuel_national_trends_cache),'Ten cache scopes required');
 late:=test_job(cat,0,now()-interval '150 minutes');
 changed:=jsonb_set(payload,'{0,prices,0,credit,price}','9');
 perform test_assert(publish_fuel_station_batch(late,changed)=0,'Late changed archive overwrote newer unchanged check');
 perform test_assert((select job_id=j2 from fuel_station_current where station_id='test-1'),'Late receipt moved freshness backwards');
 perform test_assert(publish_fuel_station_batch(j2,changed)=0,'Same-observation retry overwrote prices');
 j3:=test_job(cat,0,now()-interval '1 hour');
 changed:=jsonb_set(payload,'{1,prices,0,credit,price}','4');
 changed:=jsonb_set(changed,'{2,prices}','[]');
 perform test_assert(publish_fuel_station_batch(j3,changed)=2,'Changed price/removal did not write exactly two stations');
 perform test_assert(not exists(select 1 from fuel_station_price_lookup where station_id='test-3'),'Removed quote survived in lookup');
 perform test_assert((select e85_listed_at is not null from fuel_station_latest where station_id='test-3'),'E85 listing evidence was lost');
 j4:=test_job(cat,0,now());
 perform test_assert(publish_fuel_station_batch(j4,changed)=0,'Repeated changed payload rewrote contents');
 perform test_assert(publish_fuel_station_batch(j3,payload)=0,'Older retry restored a removed quote');
 -- Failed coverage/schema cannot advance the receipt or leave a partial write.
 j5:=test_job(cat,0,now()+interval '1 hour');
 begin perform publish_fuel_station_batch(j5,'[]'); raise exception 'Accepted wrong IDs';
 exception when others then if sqlerrm='Accepted wrong IDs' then raise; end if; end;
 begin perform publish_fuel_station_batch(j5,jsonb_set(changed,'{2,prices}','null')); raise exception 'Accepted missing prices';
 exception when others then if sqlerrm='Accepted missing prices' then raise; end if; end;
 perform test_assert((select job_id=j4 from fuel_station_batch_checks where catalog_id=cat and ordinal=0),'Failed batch advanced freshness');
 -- Metadata and provider timestamps are substantive changes even at the same price.
 changed:=jsonb_set(changed,'{0,name}','"Renamed station"');
 changed:=jsonb_set(changed,'{1,prices,0,credit,postedTime}',to_jsonb(now()-interval '30 minutes'));
 perform test_assert(publish_fuel_station_batch(j5,changed)=2,'Metadata/report timestamp changes were suppressed');
 perform test_assert((select reported_at=now()-interval '30 minutes' from fuel_station_price_lookup where station_id='test-2'),'Updated provider timestamp missing');
 -- Moving inventory to another catalog changes membership once; an old catalog
 -- must never take those stations back with an older observation.
 insert into fuel_national_catalogs(station_count,region_count,coverage,batch_count) values(3,51,'{}',1) returning id into other_cat;
 insert into fuel_national_batches values(other_cat,0,array['test-1','test-2','test-3']);
 late:=test_job(other_cat,0,now()+interval '2 hours');
 perform test_assert(publish_fuel_station_batch(late,changed)=3,'New catalog membership was not attached');
 perform test_assert(publish_fuel_station_batch(j5,payload)=0,'Old catalog retry overwrote new membership');
 perform test_assert((select count(*)=3 from fuel_station_current where job_id=late),'New catalog freshness is wrong');
 -- Expired metadata may be pruned without pinning old content jobs indefinitely.
 update fuel_national_runs set slot_at='2026-10-08T00:00:00Z',deadline_at='2026-10-08T01:00:00Z',status='complete'
 where id=saved_run;
 perform reconcile_fuel_national_retention();
 perform test_assert(not exists(select 1 from fuel_national_runs where id=saved_run),'Old content reference prevented allowed metadata retention');
 perform test_assert((select count(*)=3 from fuel_station_current where job_id=late),'Retention damaged current checks');
 perform test_assert(not has_table_privilege('anon','fuel_station_current','select') and not has_table_privilege('service_role','fuel_station_batch_checks','update'),'Private projection exposed');
end $$;
-- Existing rows can acquire membership without altering any public values.
do $$
declare cat uuid; old_job bigint; next_job bigint; payload jsonb; before_value jsonb; after_value jsonb;
begin
 insert into fuel_national_catalogs(station_count,region_count,coverage,batch_count) values(1,51,'{}',1) returning id into cat;
 insert into fuel_national_batches values(cat,0,array['existing-station']);
 payload:='[{"id":"existing-station","latitude":20,"longitude":20,"name":"Existing","prices":[]}]';
 old_job:=test_job(cat,0,now()+interval '20 hours');
 perform baseline_publish_fuel_station_batch(old_job,payload);
 select to_jsonb(s) into before_value from fuel_station_current s where station_id='existing-station';
 perform test_assert(attach_fuel_station_observation_batch(cat,0)=1,'Existing membership preparation failed');
 select to_jsonb(s) into after_value from fuel_station_current s where station_id='existing-station';
 perform test_assert(before_value=after_value,'Membership preparation changed public data');
 perform test_assert(attach_fuel_station_observation_batch(cat,0)=0,'Membership preparation is not idempotent');
 next_job:=test_job(cat,0,now()+interval '21 hours');
 perform test_assert(publish_fuel_station_batch(next_job,payload)=0,'Prepared unchanged station was rewritten');
end $$;
-- Retention must clear a genuinely old content FK while keeping the new check.
do $$
declare cat uuid; old_job bigint; new_job bigint; old_run bigint; payload jsonb;
begin
 insert into fuel_national_catalogs(station_count,region_count,coverage,batch_count) values(1,51,'{}',1) returning id into cat;
 insert into fuel_national_batches values(cat,0,array['retained-unchanged']);
 payload:='[{"id":"retained-unchanged","latitude":10,"longitude":10,"name":"Unchanged","prices":[]}]';
 old_job:=test_job(cat,0,'2026-10-08T02:00:00Z');
 perform publish_fuel_station_batch(old_job,payload);
 select run_id into old_run from fuel_national_jobs where id=old_job;
 update fuel_national_runs set status='complete' where id=old_run;
 new_job:=test_job(cat,0,now()+interval '10 hours');
 perform test_assert(publish_fuel_station_batch(new_job,payload)=0,'Retention fixture must retain unchanged content');
 perform test_assert((select job_id=old_job from fuel_station_latest where station_id='retained-unchanged'),'Fixture did not keep original content job');
 perform reconcile_fuel_national_retention();
 perform test_assert(not exists(select 1 from fuel_national_jobs where id=old_job),'Expired unchanged-content job was pinned');
 perform test_assert((select job_id is null from fuel_station_latest where station_id='retained-unchanged'),'Expired content FK was not cleared');
 perform test_assert((select job_id=new_job from fuel_station_current where station_id='retained-unchanged'),'Current receipt lost after old job expiry');
end $$;
-- Force a summary failure after a changed station write; both must roll back.
create function test_fail_summary() returns trigger language plpgsql as $$ begin raise exception 'test summary failure'; end $$;
create trigger test_fail_summary before insert on fuel_national_trend_batches for each row execute function test_fail_summary();
do $$
declare j bigint; cat uuid; payload jsonb; previous_job bigint;
begin
 select observation_catalog_id,job_id into cat,previous_job from fuel_station_latest where station_id='retained-unchanged';
 j:=test_job(cat,0,now()+interval '11 hours');
 payload:='[{"id":"retained-unchanged","latitude":10,"longitude":10,"name":"Must roll back","prices":[]}]';
 begin perform publish_fuel_station_batch(j,payload); raise exception 'Expected summary failure';
 exception when others then if sqlerrm<>'test summary failure' then raise; end if; end;
 perform test_assert((select station->>'name'='Unchanged' from fuel_station_latest where station_id='retained-unchanged'),'Summary failure committed changed contents');
 perform test_assert((select job_id<>j from fuel_station_current where station_id='retained-unchanged'),'Summary failure advanced freshness');
end $$;
drop trigger test_fail_summary on fuel_national_trend_batches;
-- WAL comparison: identical 2,000-station batch, then 10% changed contents.
-- Every scenario rolls back independently to the same starting fixture.
do $$
declare cat uuid; j1 bigint; j2 bigint; payload jsonb; mixed jsonb; start_lsn pg_lsn; baseline_wal numeric; candidate_wal numeric; n integer; baseline_n integer; scenario text;
begin
 insert into fuel_national_catalogs(station_count,region_count,coverage,batch_count) values(2000,51,'{}',1) returning id into cat;
 insert into fuel_national_batches select cat,0,array_agg('bench-'||i order by i) from generate_series(1,2000)i;
 select jsonb_agg(jsonb_build_object('id','bench-'||i,'name','Benchmark station '||i,'latitude',30,'longitude',-90,
 'address',jsonb_build_object('line1',i||' Example Road','region','LA'),
 'prices',jsonb_build_array(jsonb_build_object('fuelProduct','regular_gas','credit',jsonb_build_object('price',3.25,'postedTime',now()-interval '1 hour')))) order by i)
 into payload from generate_series(1,2000)i;
 j1:=test_job(cat,0,now()+interval '3 hours');
 perform publish_fuel_station_batch(j1,payload);
 j2:=test_job(cat,0,now()+interval '4 hours');
 foreach scenario in array array['unchanged','ten_percent_changed'] loop
  select jsonb_agg(case when scenario='ten_percent_changed' and ord<=200 then jsonb_set(s,'{prices,0,credit,price}','3.50') else s end order by ord)
  into mixed from jsonb_array_elements(payload) with ordinality x(s,ord);
  start_lsn:=pg_current_wal_insert_lsn();
  begin
   baseline_n:=baseline_publish_fuel_station_batch(j2,mixed);
   baseline_wal:=pg_wal_lsn_diff(pg_current_wal_insert_lsn(),start_lsn);
   raise exception using errcode='Z0001',message='rollback benchmark';
  exception when sqlstate 'Z0001' then null; end;
  start_lsn:=pg_current_wal_insert_lsn();
  begin
   n:=publish_fuel_station_batch(j2,mixed);
   candidate_wal:=pg_wal_lsn_diff(pg_current_wal_insert_lsn(),start_lsn);
   raise exception using errcode='Z0001',message='rollback benchmark';
  exception when sqlstate 'Z0001' then null; end;
  perform test_assert(baseline_n=2000,'Baseline workload unexpectedly changed');
  perform test_assert(n=case when scenario='unchanged' then 0 else 200 end,'Candidate wrote wrong number of stations');
  perform test_assert(candidate_wal<baseline_wal,'Candidate failed to reduce WAL');
  insert into measurements values(scenario,baseline_n,n,baseline_wal,candidate_wal);
 end loop;
end $$;
select jsonb_build_object('passed',true,'tests','unchanged tuples, freshness, provider timestamps, nearby, leaderboard, complete/partial Trends, stale replay, removed quotes, E85, metadata, invalid payloads, catalog transition, retention, permissions',
 'benchmark',(select jsonb_agg(to_jsonb(m)) from measurements m),
 'limitations','Synthetic PostgreSQL workload; WAL is write-ahead log volume, not total disk IO or a production latency guarantee.') as result;
