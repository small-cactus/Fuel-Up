begin;
set local lock_timeout='3s';
set local statement_timeout='15s';
do $$
declare cfg fuel_national_config; cat fuel_national_catalogs; verification bigint; starts timestamptz:=clock_timestamp(); ends timestamptz:=date_trunc('hour',now())+interval '1 hour';
begin
 select * into cfg from fuel_national_config where id for update;
 if exists(select 1 from fuel_national_verification_allowances where reason='2026-10-19 user-authorized station-write deduplication live verification') then return; end if;
 if not cfg.enabled or not cfg.continuous then raise exception 'National service must already be active'; end if;
 if cfg.provider_backoff_until>now() or exists(select 1 from fuel_research_campaigns where status='active' and provider_backoff_until>now()) then raise exception 'Shared cooldown active'; end if;
 if exists(select 1 from fuel_national_runs where status='running' and deadline_at>now()) then raise exception 'Wait for current sweep before extra verification'; end if;
 if exists(select 1 from fuel_national_jobs where status='running' and lease_until>now()) or exists(select 1 from fuel_discovery_jobs where status='running' and lease_until>now()) then raise exception 'Request already in flight'; end if;
 if ends-starts<interval '18 minutes' then raise exception 'Insufficient time before scheduled sweep'; end if;
 if fuel_national_archive_bytes()+8000000>cfg.archive_budget_bytes then raise exception 'Archive capacity unavailable'; end if;
 if exists(select 1 from fuel_station_latest s join fuel_national_jobs j on j.id=s.job_id where j.catalog_id=cfg.catalog_id and s.observation_catalog_id is null) then raise exception 'Observation membership preparation incomplete'; end if;
 select * into cat from fuel_national_catalogs where id=cfg.catalog_id;
 insert into fuel_national_runs(slot_at,deadline_at,catalog_id,expected_stations,expected_batches)
 values(starts,ends,cat.id,cat.station_count,cat.batch_count) returning id into verification;
 insert into fuel_national_verification_allowances(run_id,hour_at,expires_at,max_requests,max_lookups,reason)
 values(verification,date_trunc('hour',starts),ends,cat.batch_count+20,cat.station_count+20000,
 '2026-10-19 user-authorized station-write deduplication live verification');
 insert into fuel_national_jobs(run_id,catalog_id,ordinal) select verification,catalog_id,ordinal from fuel_national_batches where catalog_id=cat.id;
 insert into fuel_national_events(code,retained_run_id) values('USER_AUTHORIZED_DEDUP_LIVE_VERIFICATION',verification);
end $$;
commit;
select r.id,r.slot_at,r.deadline_at,r.status,a.max_requests,a.max_lookups,a.expires_at from fuel_national_runs r join fuel_national_verification_allowances a on a.run_id=r.id
where a.reason='2026-10-19 user-authorized station-write deduplication live verification';
