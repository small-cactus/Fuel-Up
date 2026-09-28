-- Keep provider brand identity separate from a station's display name.
alter table public.station_prices add column if not exists brand_names text[];
