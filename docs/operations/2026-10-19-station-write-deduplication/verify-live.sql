select jsonb_build_object(
 'checked_at',now(),
 'verification',(select jsonb_build_object('run',to_jsonb(r),'allowance',to_jsonb(a),
   'jobs',(select jsonb_object_agg(status,n) from (select status,count(*) n from fuel_national_jobs where run_id=r.id group by status)t),
   'attempts',(select sum(attempts) from fuel_national_jobs where run_id=r.id),
   'observed_stations',(select sum(cardinality(b.station_ids)) from fuel_national_jobs j join fuel_national_batches b using(catalog_id,ordinal) where j.run_id=r.id and j.status='succeeded'),
   'published_batches',(select count(*) from fuel_station_batch_checks b join fuel_national_jobs j on j.id=b.job_id where j.run_id=r.id),
   'station_rows_changed',(select sum(b.content_rows_changed) from fuel_station_batch_checks b join fuel_national_jobs j on j.id=b.job_id where j.run_id=r.id),
   'summarized_batches',(select count(*) from fuel_national_trend_batches b join fuel_national_jobs j on j.id=b.job_id where j.run_id=r.id),
   'regional',(select jsonb_agg(t) from (select b.execution_region,count(*) filter(where j.status='succeeded') succeeded,count(*) total from fuel_national_jobs j join fuel_national_batches b using(catalog_id,ordinal) where j.run_id=r.id group by b.execution_region)t))
  from fuel_national_verification_allowances a join fuel_national_runs r on r.id=a.run_id where a.reason='2026-10-19 user-authorized station-write deduplication live verification'),
 'station_stats',(select to_jsonb(t) from (select n_tup_upd,n_tup_hot_upd,n_dead_tup,last_autovacuum from pg_stat_user_tables where relname='fuel_station_latest')t),
 'config',(select jsonb_build_object('enabled',enabled,'cooldown_until',provider_backoff_until,'last_request_at',last_request_at,'halt_reason',halt_reason) from fuel_national_config),
 'cache',(select jsonb_build_object('run_id',min(run_id),'scopes',count(*),'published_at',min(published_at)) from fuel_national_trends_cache),
 'events',(select jsonb_agg(t) from (select created_at,job_id,code from fuel_national_events order by id desc limit 8)t)
) as status;
