begin;
set local statement_timeout='8s';
explain(analyze,buffers,format json) select greatest(
(select coalesce(sum(archive_bytes),0) from fuel_national_jobs where archive_deleted_at is null and archive_bytes is not null),
(select coalesce(sum(case when metadata->>'size' ~ '^[0-9]+$' then (metadata->>'size')::bigint else 8000000 end),0) from storage.objects where bucket_id='fuel-national'));
commit;
