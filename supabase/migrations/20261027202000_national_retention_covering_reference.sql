-- Unchanged station contents can outlive the eight-day job metadata window.
-- Retention must check their receipt coverage without fetching every large
-- station row from the heap. Preserve every eligibility predicate and FK.
-- Run outside a transaction so publication remains writable during the build.
create index concurrently if not exists fuel_station_retention_reference
  on public.fuel_station_latest (job_id)
  include (observation_catalog_id, observation_ordinal, observed_at);
