-- Run each statement outside a transaction. Concurrent builds preserve writes.
-- The former INCLUDE index disabled B-tree deduplication. Thousands of stations
-- share the same batch receipt, so making all four values keys preserves index
-- coverage while allowing posting lists instead of repeated wide leaf tuples.
-- Production preflight: old index 129,376,256 bytes / 6.61% leaf density;
-- equivalent compact index 1,966,080 bytes, valid and ready.
create index concurrently if not exists fuel_station_retention_reference_compact
  on public.fuel_station_latest
  (job_id, observation_catalog_id, observation_ordinal, observed_at);

-- The replacement covers both the retention read and the job_id FK lookup.
-- Neither old index is a constraint or unique index. No table data changes.
drop index concurrently if exists public.fuel_station_retention_reference;
drop index concurrently if exists public.fuel_station_latest_job_id;

-- Reclaim measured bloat without changing keys, constraints or price ordering.
reindex index concurrently public.fuel_national_price_order;
reindex index concurrently public.fuel_station_price_lookup_pkey;
