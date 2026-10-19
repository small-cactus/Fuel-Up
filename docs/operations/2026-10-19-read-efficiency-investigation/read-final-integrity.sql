begin; set local statement_timeout='12s';
with target as (select r.id from fuel_national_runs r join fuel_national_verification_allowances a on a.run_id=r.id where a.reason='2026-10-19 user-authorized compact-read live verification')
select jsonb_build_object('at',now(),
 'manifest_summary_hash_mismatches',(select count(*) from fuel_national_jobs j join target r on r.id=j.run_id left join fuel_national_trend_batches t on t.job_id=j.id where t.source_sha256 is distinct from j.sha256),
 'freshness_receipt_mismatches',(select count(*) from fuel_national_jobs j join target r on r.id=j.run_id left join fuel_station_batch_checks b using(catalog_id,ordinal) where b.job_id is distinct from j.id or b.observed_at is distinct from j.observed_at),
 'changed_station_signature_mismatches',(select count(*) from fuel_station_latest l join fuel_national_jobs j on j.id=l.job_id join target r on r.id=j.run_id left join fuel_station_collection_state c using(station_id) where c.price_signature is distinct from sha256(convert_to((l.station->'prices')::text,'UTF8')) or c.observed_at is distinct from l.observed_at),
 'events',(select jsonb_agg(t) from (select e.code,count(*) from fuel_national_events e join fuel_national_jobs j on j.id=e.job_id join target r on r.id=j.run_id group by e.code)t),
 'config',(select jsonb_build_object('enabled',enabled,'continuous',continuous,'max_requests_per_hour',max_requests_per_hour,'approved_lookups_per_hour',approved_lookups_per_hour,'shared_cooldown_until',provider_backoff_until) from fuel_national_config)) as integrity;
commit;
