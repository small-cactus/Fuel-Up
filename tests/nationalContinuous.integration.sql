-- Append after the migration inside BEGIN/ROLLBACK. Never dispatch HTTP or
-- provider collection. Temporary clock changes and all fixtures roll back.
do $$
declare saved_end timestamptz; newrun bigint; picked record; oldrun bigint; cache_run bigint;
 fakejob bigint; research_jobs bigint; path text; definition text; result jsonb;
begin
 select count(*) into research_jobs from fuel_national_jobs j join fuel_national_runs r on r.id=j.run_id where j.status='succeeded' and r.slot_at<'2026-10-07T19:00:00Z';
 select ends_at into saved_end from fuel_national_config where id;
 update fuel_national_config set continuous=true,operational_starts_at=date_trunc('hour',now()),enabled=true where id;
 newrun:=begin_fuel_national_hour();
 if newrun is null or (select deadline_at from fuel_national_runs where id=newrun)<>date_trunc('hour',now())+interval '1 hour' then raise exception 'Continuous mode did not create a full current hour'; end if;
 if (select ends_at from fuel_national_config where id)<>saved_end then raise exception 'Research end overwritten'; end if;
 if newrun<>begin_fuel_national_hour() then raise exception 'Duplicate current hour'; end if;
 update fuel_national_config set provider_backoff_until=now()+interval '1 hour' where id;
 if exists(select 1 from claim_fuel_national_region_job('us-east-1')) then raise exception 'Cooldown bypass'; end if;
 update fuel_national_config set provider_backoff_until=null,last_request_at=null where id;
 select * into picked from claim_fuel_national_region_job('us-east-1');
 if picked.id is null or picked.execution_region<>'us-east-1' then raise exception 'Continuous claim failed'; end if;
 update fuel_national_config set enabled=false where id;
 if exists(select 1 from claim_fuel_national_region_job('us-west-1')) then raise exception 'Pause bypass'; end if;
 update fuel_national_jobs set status='queued',lease_until=null where id=picked.id;
 update fuel_national_config set enabled=true,last_request_at=null,archive_budget_bytes=9000000 where id;
 select * into picked from claim_fuel_national_region_job('us-east-1');
 if picked.id is not null or (select enabled from fuel_national_config where id) then raise exception 'Capacity guard bypass'; end if;
 update fuel_national_config set archive_budget_bytes=900000000,enabled=true,continuous=false where id;
 oldrun:=begin_fuel_national_hour();
 if oldrun is not null or (select enabled from fuel_national_config where id) then raise exception 'Bounded campaign end bypass'; end if;
 update fuel_national_config set continuous=true,operational_starts_at='2026-10-07T19:00:00Z',enabled=false where id;
 if exists(select 1 from fuel_national_retention_candidates()) then raise exception 'Research offered for deletion'; end if;
 -- Move only the retention functions' clock forward within this transaction.
 foreach definition in array array[
  pg_get_functiondef('fuel_national_retention_candidates()'::regprocedure),
  pg_get_functiondef('reconcile_fuel_national_retention()'::regprocedure)] loop
  execute replace(definition,'now()', $clock$'2026-10-20T12:00:00Z'::timestamptz$clock$);
 end loop;
 insert into fuel_national_runs(slot_at,deadline_at,catalog_id,expected_stations,expected_batches,status)
 select '2026-10-08T00:00:00Z','2026-10-08T01:00:00Z',catalog_id,1,1,'complete' from fuel_national_config where id returning id into oldrun;
 insert into fuel_national_jobs(run_id,catalog_id,ordinal,status,sha256,archive_bytes)
 select oldrun,catalog_id,0,'succeeded',repeat('a',64),123 from fuel_national_config where id returning id into fakejob;
 path:=oldrun||'/'||fakejob||'/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.json.gz';
 update fuel_national_jobs set object_path=path where id=fakejob;
 insert into storage.objects(bucket_id,name,metadata) values('fuel-national',path,'{"size":123}');
 if (select count(*) from fuel_national_retention_candidates())<>1 then raise exception 'Operational retention selection failed'; end if;
 select min(run_id) into cache_run from fuel_national_trends_cache;
 update fuel_national_trends_cache set run_id=oldrun;
 if exists(select 1 from fuel_national_retention_candidates()) then raise exception 'Serving cache archive selected'; end if;
 update fuel_national_trends_cache set run_id=cache_run;
 result:=reconcile_fuel_national_retention();
 if (select archive_deleted_at from fuel_national_jobs where id=fakejob) is not null then raise exception 'Marked existing archive absent'; end if;
 -- A second fixture has no Storage object, representing an API deletion
 -- already committed before the acknowledgement. Never delete Storage metadata.
 insert into fuel_national_runs(slot_at,deadline_at,catalog_id,expected_stations,expected_batches,status)
 select '2026-10-09T00:00:00Z','2026-10-09T01:00:00Z',catalog_id,1,1,'complete' from fuel_national_config where id returning id into oldrun;
 insert into fuel_national_jobs(run_id,catalog_id,ordinal,status,sha256,archive_bytes)
 select oldrun,catalog_id,0,'succeeded',repeat('b',64),123 from fuel_national_config where id returning id into fakejob;
 update fuel_national_jobs set object_path=oldrun||'/'||fakejob||'/bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee.json.gz' where id=fakejob;
 insert into fuel_national_events(job_id,code) values(fakejob,'TEST_RETAINED_FAILURE');
 result:=reconcile_fuel_national_retention();
 if exists(select 1 from fuel_national_runs where id=oldrun) then raise exception 'Old operational metadata not pruned'; end if;
 if not exists(select 1 from fuel_national_events where retained_job_id=fakejob and retained_run_id=oldrun and code='TEST_RETAINED_FAILURE') then raise exception 'Error evidence lost'; end if;
 if (select count(*) from fuel_national_jobs j join fuel_national_runs r on r.id=j.run_id where j.status='succeeded' and r.slot_at<'2026-10-07T19:00:00Z')<>research_jobs then raise exception 'Research rows changed'; end if;
 if (select count(*) from fuel_national_retention_candidates())<>1 or exists(select 1 from fuel_national_retention_candidates() where slot_at<'2026-10-07T19:00:00Z') then raise exception 'Research retention boundary failed'; end if;
end $$;
select 'continuous lifecycle, pause/cooldown/capacity gates, retention and research protection passed' as result;
