-- Explicit administrative start; existing provider pauses remain authoritative.
-- Re-running does not extend the original bootstrap window.
begin;
update public.fuel_discovery_config set enabled=true,
  ends_at=coalesce(ends_at,now()+interval '8 hours'),min_interval_seconds=30,max_requests_per_hour=60 where id;
select cron.schedule('fuel-national-discovery','* * * * *','select public.dispatch_fuel_discovery()');
commit;
