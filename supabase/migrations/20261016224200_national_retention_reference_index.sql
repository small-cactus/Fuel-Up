-- Retention must preserve runs referenced by the current station cache.
-- Without this index, checking each old run repeatedly scans the whole cache,
-- and deleting expired jobs also scans it to enforce the foreign key.
-- Apply this statement outside a transaction: concurrent creation keeps the
-- serving table writable. No retention boundary or eligibility rule changes.
create index concurrently if not exists fuel_station_latest_job_id
  on public.fuel_station_latest (job_id);
