-- One recovery attempt for event 5745, after its preserved cooldown.
-- Only re-enables the national service. Scheduled dispatch performs collection.
do $recovery$
declare
 cfg public.fuel_national_config;
 reason text;
begin
 select * into cfg from public.fuel_national_config where id for update;
 if exists(select 1 from cron.job where jobname='fuel-refused-recovery-5745') then
   perform cron.unschedule('fuel-refused-recovery-5745');
 end if;
 if now() < '2026-11-05T13:09:00Z' or now() >= '2026-11-05T13:15:00Z' then
   reason := 'Outside incident recovery window';
 elsif to_jsonb(cfg) is distinct from $config${"approved_lookups_per_hour": 161660, "archive_budget_bytes": 900000000, "catalog_id": "4d220708-04f3-4c27-bdae-88d1aa45ebe2", "catalog_valid_until": "2026-10-07T18:19:00+00:00", "continuous": true, "enabled": false, "ends_at": "2026-10-07T18:19:00+00:00", "halt_reason": "GRAPHQL_ERROR", "id": true, "last_dispatch_at": "2026-11-05T12:08:00.22141+00:00", "last_request_at": "2026-11-05T12:08:41.64409+00:00", "max_requests_per_hour": 92, "operational_raw_hours": 48, "operational_starts_at": "2026-10-07T19:00:00+00:00", "provider_backoff_until": "2026-11-05T13:08:44.392184+00:00", "request_interval_seconds": 10, "starts_at": "2026-09-30T22:00:00+00:00"}$config$::jsonb then
   reason := 'Collector configuration changed; review required';
 elsif cfg.provider_backoff_until > now() or exists(
   select 1 from public.fuel_research_campaigns where provider_backoff_until > now()) then
   reason := 'Shared cooldown still active';
 elsif public.fuel_national_archive_bytes() + 8000000 >= cfg.archive_budget_bytes then
   reason := 'Archive capacity guard failed';
 elsif exists(select 1 from public.fuel_national_events where id > 5745) then
   reason := 'Newer event requires review';
 elsif not exists(select 1 from public.fuel_national_events where id=5745
   and job_id=3511686 and code='GRAPHQL_ERROR'
   and created_at='2026-11-05T12:08:44.392184Z')
   or not exists(select 1 from public.fuel_national_events where id=5744
   and job_id=3511686 and code='PROVIDER_RESPONSE'
   and response_evidence=$evidence${"decodedBodyBytes": 736994, "elapsedMs": 2106, "fullElapsedMs": 2144, "graphqlErrorSummary": {"classes": {"GRAPHQL_ERROR": {"count": 2, "examples": [{"extensionCode": "INTERNAL_SERVER_ERROR", "message": "request to http://poi-serv:8000/v2/station/187006 failed, reason: connect ECONNREFUSED 172.23.238.89:8000"}, {"extensionCode": "INTERNAL_SERVER_ERROR", "message": "request to http://poi-serv:8000/v2/station/187504 failed, reason: connect ECONNREFUSED 172.23.238.89:8000"}]}, "UPSTREAM_TRANSIENT_GRAPHQL": {"count": 155, "examples": [{"extensionCode": "INTERNAL_SERVER_ERROR", "message": "request to http://poi-serv:8000/v2/station/18130 failed, reason: connect ECONNRESET 172.23.238.89:8000"}, {"extensionCode": "INTERNAL_SERVER_ERROR", "message": "request to http://poi-serv:8000/v2/station/18131 failed, reason: connect ECONNRESET 172.23.238.89:8000"}, {"extensionCode": "INTERNAL_SERVER_ERROR", "message": "request to http://poi-serv:8000/v2/station/18150 failed, reason: connect ECONNRESET 172.23.238.89:8000"}]}}, "extensionCodes": {"INTERNAL_SERVER_ERROR": 157}, "total": 157}, "graphqlErrors": ["request to http://poi-serv:8000/v2/station/18130 failed, reason: connect ECONNRESET 172.23.238.89:8000", "request to http://poi-serv:8000/v2/station/18131 failed, reason: connect ECONNRESET 172.23.238.89:8000", "request to http://poi-serv:8000/v2/station/18150 failed, reason: connect ECONNRESET 172.23.238.89:8000", "request to http://poi-serv:8000/v2/station/18153 failed, reason: connect ECONNRESET 172.23.238.89:8000", "request to http://poi-serv:8000/v2/station/182 failed, reason: connect ECONNRESET 172.23.238.89:8000", "request to http://poi-serv:8000/v2/station/1824 failed, reason: connect ECONNRESET 172.23.238.89:8000", "request to http://poi-serv:8000/v2/station/18265 failed, reason: connect ECONNRESET 172.23.238.89:8000", "request to http://poi-serv:8000/v2/station/18317 failed, reason: connect ECONNRESET 172.23.238.89:8000", "request to http://poi-serv:8000/v2/station/18337 failed, reason: connect ECONNRESET 172.23.238.89:8000", "request to http://poi-serv:8000/v2/station/18354 failed, reason: connect ECONNRESET 172.23.238.89:8000"], "headers": {"age": "0", "cf-ray": "a55bbecebc4bcb4a-IAD", "content-type": "application/json; charset=utf-8", "date": "Thu, 05 Nov 2026 12:08:44 GMT", "server": "cloudflare", "via": "1.1 varnish-v4", "x-cache": "MISS"}, "observedAt": "2026-11-05T12:08:44.137Z", "status": 200}$evidence$::jsonb) then
   reason := 'Original internal failure evidence mismatch';
 end if;
 if reason is not null then
   insert into public.fuel_national_events(code,response_evidence)
     values('CONNECTION_REFUSED_RECOVERY_BLOCKED',
       jsonb_build_object('original_event_id',5745,'reason',reason));
 else
   update public.fuel_national_config
     set enabled=true,halt_reason='USER_AUTHORIZED_CONNECTION_REFUSED_RECOVERY' where id;
   insert into public.fuel_national_events(code,response_evidence)
     values('USER_AUTHORIZED_CONNECTION_REFUSED_RECOVERY',
       jsonb_build_object('original_event_id',5745,'attempt',1,
         'original_pause_until',cfg.provider_backoff_until));
   perform public.watchdog_fuel_national();
 end if;
end $recovery$;
