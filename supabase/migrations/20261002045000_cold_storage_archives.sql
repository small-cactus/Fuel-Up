-- Admin-only, immutable cold archives. Hot app data and research snapshots stay
-- unchanged. Nationwide raw history already lives in fuel-national Storage.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('fuel-cold','fuel-cold',false,52428800,array['application/gzip','application/x-gzip','application/octet-stream'])
on conflict(id) do nothing;
create table public.fuel_cold_archives (
 object_path text primary key, source_table text not null
  check(source_table in ('fuel_query_cache','station_prices')),
 cutoff timestamptz not null,row_count integer not null check(row_count>0),
 archive_bytes bigint not null check(archive_bytes>0),sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 verified_at timestamptz not null
);
alter table public.fuel_cold_archives enable row level security;
revoke all on public.fuel_cold_archives from public,anon,authenticated;
grant select,insert on public.fuel_cold_archives to service_role;

-- These fixed-inventory tables are rewritten frequently. Reclaim dead tuples
-- sooner so hourly collection reuses pages instead of accumulating index bloat.
alter table public.fuel_station_latest set (
 autovacuum_vacuum_scale_factor=0.02,autovacuum_analyze_scale_factor=0.05);
alter table public.fuel_station_price_lookup set (
 autovacuum_vacuum_scale_factor=0.02,autovacuum_analyze_scale_factor=0.05);
