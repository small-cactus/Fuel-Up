-- Minimal supporting queue schema for local claim-function tests; no networking.
alter table fuel_national_config add column request_interval_seconds integer default 10;
alter table fuel_national_batches add column execution_region text default 'us-east-1';
alter table fuel_national_jobs add column execution_region text;
create table fuel_national_regions(region text primary key,enabled boolean);
insert into fuel_national_regions values('us-east-1',true);
create table fuel_research_campaigns(status text,provider_backoff_until timestamptz);
create table fuel_discovery_jobs(status text,lease_until timestamptz);
create table test_archive_capacity(bytes bigint);
insert into test_archive_capacity values(0);
create or replace function fuel_national_archive_bytes() returns bigint language sql as $$select bytes from test_archive_capacity$$;
-- INSERT_ALLOWANCE_MIGRATION

do $$
declare cat uuid; ordinary bigint; verification bigint; normal_job bigint; extra_job bigint; claimed integer;
begin
 insert into fuel_national_catalogs(station_count,region_count,coverage,batch_count) values(1,51,'{}',1) returning id into cat;
 insert into fuel_national_batches(catalog_id,ordinal,station_ids) values(cat,0,array['allowance-test']);
 update fuel_national_config set enabled=true,continuous=true,ends_at=now()-interval '1 day',catalog_id=cat,
 approved_lookups_per_hour=2,max_requests_per_hour=2,provider_backoff_until=null,last_request_at=null;
 insert into fuel_national_runs(slot_at,deadline_at,catalog_id,expected_stations,expected_batches,status)
 values(date_trunc('hour',now()),date_trunc('hour',now())+interval '1 hour',cat,1,1,'complete') returning id into ordinary;
 insert into fuel_national_jobs(run_id,catalog_id,ordinal,status,attempts) values(ordinary,cat,0,'succeeded',2) returning id into normal_job;
 insert into fuel_national_runs(slot_at,deadline_at,catalog_id,expected_stations,expected_batches)
 values(date_trunc('hour',now())+interval '1 second',date_trunc('hour',now())+interval '1 hour',cat,1,1) returning id into verification;
 insert into fuel_national_jobs(run_id,catalog_id,ordinal) values(verification,cat,0) returning id into extra_job;
 select count(*) into claimed from claim_fuel_national_region_job('us-east-1');
 perform test_assert(claimed=0,'Extra run bypassed normal hourly budget without authorization');
 insert into fuel_national_verification_allowances values(verification,date_trunc('hour',now()),date_trunc('hour',now())+interval '1 hour',1,1,'Local test of explicit authorization');
 select count(*) into claimed from claim_fuel_national_region_job('us-east-1');
 perform test_assert(claimed=1,'Explicit bounded allowance did not permit extra run');
 update fuel_national_jobs set status='queued',lease_until=null where id=extra_job;
 update fuel_national_config set last_request_at=null;
 select count(*) into claimed from claim_fuel_national_region_job('us-east-1');
 perform test_assert(claimed=0,'Verification exceeded its per-run cap');
 -- Extra capacity must not spill into the regular run's own allowance.
 update fuel_national_runs set status='running' where id=ordinary;
 update fuel_national_jobs set status='queued',lease_until=null where id=normal_job;
 select count(*) into claimed from claim_fuel_national_region_job('us-east-1');
 perform test_assert(claimed=0,'Verification allowance expanded normal run budget');
 update fuel_national_jobs set status='succeeded' where id=normal_job;
 update fuel_national_jobs set attempts=0 where id=extra_job;
 update fuel_national_verification_allowances set expires_at=now()-interval '1 millisecond';
 select count(*) into claimed from claim_fuel_national_region_job('us-east-1');
 perform test_assert(claimed=0,'Expired allowance was accepted');
 update fuel_national_verification_allowances set expires_at=date_trunc('hour',now())+interval '1 hour';
 update fuel_national_config set provider_backoff_until=now()+interval '1 hour';
 select count(*) into claimed from claim_fuel_national_region_job('us-east-1');
 perform test_assert(claimed=0,'Verification bypassed shared cooldown');
 update fuel_national_config set provider_backoff_until=null;
 update test_archive_capacity set bytes=900000000;
 select count(*) into claimed from claim_fuel_national_region_job('us-east-1');
 perform test_assert(claimed=0 and not (select enabled from fuel_national_config),'Verification bypassed archive capacity stop');
 perform test_assert(not has_table_privilege('service_role','fuel_national_verification_allowances','insert'),'Worker could authorize extra traffic');
end $$;
select jsonb_build_object('verificationAllowancePassed',true,'checks','default cap, explicit allowance, per-run cap, normal-run isolation, expiry, cooldown, archive capacity, admin-only authorization') as result;
