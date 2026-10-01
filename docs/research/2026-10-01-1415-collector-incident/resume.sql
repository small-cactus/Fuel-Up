-- Bounded diagnostic recovery, attempt 1. Cron remains the only collector.
-- Recorded internal connection resets, expired cooldown, and subsequent city
-- successes support retrying; the truncated original list remains incomplete.
begin;
do $$
declare cfg fuel_national_config;
begin
 select * into cfg from fuel_national_config where id for update;
 if cfg.enabled or cfg.halt_reason <> 'GRAPHQL_ERROR'
   or cfg.provider_backoff_until is distinct from '2026-10-01T15:15:38.400083Z'::timestamptz
   or cfg.provider_backoff_until > now() or cfg.ends_at <= now()
   or fuel_national_archive_bytes() >= cfg.archive_budget_bytes
 then raise exception 'Incident state or budget changed'; end if;
 if exists(select 1 from fuel_national_events where id>41 and code in ('GRAPHQL_ERROR','UPSTREAM_HTTP_401','UPSTREAM_HTTP_403','UPSTREAM_HTTP_429'))
 then raise exception 'Newer provider denial'; end if;
 if exists(select 1 from fuel_research_campaigns where status='active' and provider_backoff_until>now())
 then raise exception 'Shared cooldown still active'; end if;
 if not exists(select 1 from fuel_national_events where id=40 and response_evidence->>'status'='200'
   and jsonb_array_length(response_evidence->'graphqlErrors')=10
   and not (response_evidence->'headers' ? 'retry-after')
   and not exists(select 1 from jsonb_array_elements_text(response_evidence->'graphqlErrors') e(message)
     where message !~ '^request to http://poi-serv:8000/v2/station/[0-9]+ failed, reason: read ECONNRESET$'))
 then raise exception 'Internal failure evidence mismatch'; end if;
 if not exists(select 1 from fuel_research_jobs where status='succeeded' and completed_at>cfg.provider_backoff_until)
 then raise exception 'No successful shared-provider collection after cooldown'; end if;
 if exists(select 1 from fuel_national_events where code='USER_AUTHORIZED_DIAGNOSTIC_RECOVERY' and response_evidence->>'original_event_id'='41')
 then raise exception 'Recovery already attempted'; end if;
 update fuel_national_config set enabled=true,halt_reason='USER_AUTHORIZED_DIAGNOSTIC_RECOVERY' where id;
 insert into fuel_national_events(code,response_evidence) values('USER_AUTHORIZED_DIAGNOSTIC_RECOVERY',
  jsonb_build_object('original_event_id',41,'attempt',1,'original_pause_until',cfg.provider_backoff_until,
   'reason','Saved errors are internal ECONNRESET; city collection succeeds after cooldown. Full-list classification diagnostics now retain late unknown errors. Identity, pacing, routing, deadlines and denial policy unchanged.'));
end $$;
commit;
