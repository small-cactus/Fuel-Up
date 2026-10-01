-- Attempt 2 for the October 1 incident; run only AFTER the recorded cooldown.
-- Guarded state change only: the existing main Cron remains the only collector.
begin;
do $$
declare cfg fuel_national_config;
begin
 select * into cfg from fuel_national_config where id for update;
 if cfg.enabled or cfg.halt_reason <> 'GRAPHQL_ERROR'
   or cfg.provider_backoff_until is distinct from '2026-10-01T16:28:04.429593Z'::timestamptz
   or cfg.provider_backoff_until > now() or cfg.ends_at <= now()
   or fuel_national_archive_bytes() >= cfg.archive_budget_bytes
 then raise exception 'Incident state, cooldown or budget changed'; end if;
 if exists(select 1 from fuel_national_events where id>44 and code in ('GRAPHQL_ERROR','UPSTREAM_HTTP_401','UPSTREAM_HTTP_403','UPSTREAM_HTTP_429'))
 then raise exception 'Newer provider denial'; end if;
 if exists(select 1 from fuel_research_campaigns where status='active' and provider_backoff_until>now())
 then raise exception 'Shared cooldown still active'; end if;
 if not exists(select 1 from fuel_national_events where id=43 and response_evidence->>'status'='200'
   and response_evidence->'graphqlErrorSummary'->>'total'='1398'
   and response_evidence->'graphqlErrorSummary'->'extensionCodes'='{"INTERNAL_SERVER_ERROR":1398}'::jsonb
   and response_evidence->'graphqlErrorSummary'->'classes'->'GRAPHQL_ERROR'->'examples'->0->>'message'='Brand get failed'
   and not (response_evidence->'headers' ? 'retry-after'))
 then raise exception 'Brand resolver failure evidence mismatch'; end if;
 if exists(select 1 from fuel_national_events where code='USER_AUTHORIZED_BRAND_QUERY_RECOVERY')
 then raise exception 'Recovery already attempted'; end if;
 update fuel_national_config set enabled=true,halt_reason='USER_AUTHORIZED_BRAND_QUERY_RECOVERY' where id;
 insert into fuel_national_events(code,response_evidence) values('USER_AUTHORIZED_BRAND_QUERY_RECOVERY',
  jsonb_build_object('original_event_id',41,'diagnostic_event_id',44,'attempt',2,
   'original_pause_until',cfg.provider_backoff_until,
   'reason','Removed failing optional brands resolver from scheduled metadata query. Full raw prices, strict error rejection, identity, routing, budget and deadline unchanged.'));
end $$;
commit;
