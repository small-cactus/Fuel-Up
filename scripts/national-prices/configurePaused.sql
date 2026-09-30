-- Schema/function must already be deployed. Reuses the protected research key.
-- This intentionally cannot enable collection or install a partial catalog.
begin;
do $$ declare existing uuid; begin
  if not exists(select 1 from vault.secrets where name='fuel_research_secret') then raise exception 'Research authentication missing'; end if;
  select id into existing from vault.secrets where name='fuel_national_endpoint';
  if existing is null then
    perform vault.create_secret('https://vjindchxfebaltbslqwc.supabase.co/functions/v1/fuel-national','fuel_national_endpoint');
  else
    perform vault.update_secret(existing,'https://vjindchxfebaltbslqwc.supabase.co/functions/v1/fuel-national');
  end if;
end $$;
update public.fuel_national_config set enabled=false,halt_reason='BOOTSTRAP_HTTP_429_AND_INCOMPLETE_CATALOG',
  provider_backoff_until=greatest(provider_backoff_until,'2026-09-30T20:35:48Z'::timestamptz);
insert into public.fuel_national_events(created_at,code,retry_after_seconds)
  select '2026-09-30T19:35:48Z','BOOTSTRAP_HTTP_429',3600
  where not exists(select 1 from public.fuel_national_events where code='BOOTSTRAP_HTTP_429' and created_at='2026-09-30T19:35:48Z');
-- Minute ticks resume work; begin_fuel_national_hour creates at most one run/hour.
-- Enabled=false means ticks issue no network requests.
select cron.schedule('fuel-national-dispatch','* * * * *','select public.dispatch_fuel_national();');
commit;
select enabled,halt_reason from public.fuel_national_config;
