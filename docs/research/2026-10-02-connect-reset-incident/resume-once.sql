-- One incident-specific attempt, only after the existing shared cooldown.
-- Executed by Cron; never fetches provider data or rewrites old jobs/prices.
do $recovery$
declare
 cfg public.fuel_national_config;
 recovery_at timestamptz := now();
 reason text;
begin
 select * into cfg from public.fuel_national_config where id for update;
 if exists(select 1 from cron.job where jobname='fuel-connect-reset-recovery-205') then
   perform cron.unschedule('fuel-connect-reset-recovery-205');
 end if;
 if recovery_at < '2026-10-02T19:12:07.13661Z' or recovery_at >= '2026-10-02T20:00:00Z' then
   reason := 'Outside incident recovery window';
 elsif cfg.enabled or cfg.halt_reason <> 'GRAPHQL_ERROR'
   or cfg.provider_backoff_until is distinct from '2026-10-02T19:12:07.13661Z'::timestamptz
   or cfg.last_request_at is distinct from '2026-10-02T18:12:02.35165Z'::timestamptz then
   reason := 'Collector state changed; manual review required';
 elsif cfg.provider_backoff_until > recovery_at or exists(
   select 1 from public.fuel_research_campaigns where provider_backoff_until > recovery_at) then
   reason := 'Shared cooldown still active';
 elsif cfg.ends_at is distinct from '2026-10-07T18:19:00Z'::timestamptz
   or cfg.catalog_id is distinct from '4d220708-04f3-4c27-bdae-88d1aa45ebe2'::uuid
   or cfg.catalog_valid_until <= recovery_at
   or cfg.approved_lookups_per_hour < 141660 or cfg.max_requests_per_hour < 72
   or cfg.archive_budget_bytes <> 900000000
   or public.fuel_national_archive_bytes() + 8000000 >= cfg.archive_budget_bytes then
   reason := 'Window, catalog, or capacity guard failed';
 elsif exists(select 1 from public.fuel_national_events where id>205 and
   (code in ('GRAPHQL_ERROR','UPSTREAM_HTTP_401','UPSTREAM_HTTP_403','UPSTREAM_HTTP_429')
    or code like '%RECOVERY%')) then
   reason := 'New denial or recovery event; manual review required';
 elsif not exists(select 1 from public.fuel_national_events where id=204 and job_id=142878
   and response_evidence->>'status'='200'
   and response_evidence->'graphqlErrorSummary'->>'total'='5'
   and response_evidence->'graphqlErrorSummary'->'extensionCodes'='{"INTERNAL_SERVER_ERROR":5}'::jsonb
   and jsonb_array_length(response_evidence->'graphqlErrors')=5
   and not exists(select 1 from jsonb_array_elements_text(response_evidence->'graphqlErrors') e(message)
     where message !~ '^request to http://poi-serv:8000/v2/station/[0-9]+ failed, reason: connect ECONNRESET 172\.23\.238\.89:8000$')) then
   reason := 'Original failure evidence mismatch';
 end if;
 if reason is not null then
   insert into public.fuel_national_events(code,response_evidence)
     values('CONNECT_RESET_RECOVERY_BLOCKED',jsonb_build_object('original_event_id',205,'reason',reason));
 else
   update public.fuel_national_config set enabled=true,halt_reason='USER_AUTHORIZED_CONNECT_RESET_RECOVERY' where id;
   insert into public.fuel_national_events(code,response_evidence)
     values('USER_AUTHORIZED_CONNECT_RESET_RECOVERY',jsonb_build_object('original_event_id',205,'attempt',1,
       'original_pause_until',cfg.provider_backoff_until,'change','Classify known provider connect ECONNRESET as transient; preserve cooldown, identity and regional routing'));
   perform public.watchdog_fuel_national();
 end if;
end $recovery$;
