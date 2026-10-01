-- One-time, user-authorized removal of our own ambiguous-GraphQL pause.
-- No provider Retry-After was present. Preserve attempts and all failure evidence.
begin;
do $$
declare cfg fuel_national_config;
begin
  select * into cfg from fuel_national_config where id for update;
  if cfg.enabled or cfg.halt_reason <> 'GRAPHQL_ERROR'
    or cfg.provider_backoff_until is distinct from '2026-10-01T01:05:22.73448Z'::timestamptz
    or cfg.ends_at <= now() then raise exception 'Incident state changed; do not override'; end if;
  if exists(select 1 from fuel_national_events where id > 20
    and code in ('GRAPHQL_ERROR','UPSTREAM_HTTP_401','UPSTREAM_HTTP_403','UPSTREAM_HTTP_429'))
    then raise exception 'New provider failure; do not override'; end if;
  if not exists(select 1 from fuel_national_events where id=19
    and response_evidence->>'status'='200'
    and response_evidence->'graphqlErrors'='["408","408","408","408","408","408","408","408","408","408"]'::jsonb
    and not (response_evidence->'headers' ? 'retry-after'))
    then raise exception 'Failure evidence mismatch'; end if;
  update fuel_national_config set enabled=true,provider_backoff_until=null,
    halt_reason='USER_APPROVED_RETRY_AFTER_HEADER_DIAGNOSTIC' where id;
  update fuel_research_campaigns set provider_backoff_until=null
    where id='hourly-24-cities-20260930-v1' and status='active'
    and provider_backoff_until=cfg.provider_backoff_until;
  update fuel_national_jobs j set next_attempt_at=now()
    from fuel_national_runs r where j.id=8710 and r.id=j.run_id
      and j.status='queued' and j.attempts<3 and j.last_error='GRAPHQL_ERROR'
      and r.deadline_at>now();
  insert into fuel_national_events(code,response_evidence) values
    ('USER_APPROVED_RETRY_AFTER_HEADER_DIAGNOSTIC',jsonb_build_object(
      'original_event_id',20,'configured_header_status',200,'omitted_header_status',400,
      'placeholder_header_status',200,'diagnostic_station_lookups',3,
      'diagnostic_http_requests',4,'execution_region','us-east-1',
      'original_pause_until',cfg.provider_backoff_until));
end $$;
commit;
select public.dispatch_fuel_national();
