-- User-authorized recovery after deploying transient GraphQL classification.
-- Original failed jobs/events stay intact. No historical jobs are re-created.
begin;
do $$
declare cfg fuel_national_config;
begin
  select * into cfg from fuel_national_config where id for update;
  if cfg.enabled or cfg.halt_reason<>'GRAPHQL_ERROR'
    or cfg.provider_backoff_until is distinct from '2026-10-01T08:01:35.143117Z'::timestamptz
    or cfg.provider_backoff_until>now() or cfg.ends_at<=now()
    then raise exception 'Incident state changed; do not override'; end if;
  if exists(select 1 from fuel_national_events where id>28 and code in ('GRAPHQL_ERROR','UPSTREAM_HTTP_401','UPSTREAM_HTTP_403','UPSTREAM_HTTP_429'))
    then raise exception 'New provider denial; do not override'; end if;
  if not exists(select 1 from fuel_national_events where id=27 and response_evidence->>'status'='200'
    and jsonb_array_length(response_evidence->'graphqlErrors')>0
    and not (response_evidence->'headers' ? 'retry-after')
    and not exists(select 1 from jsonb_array_elements_text(response_evidence->'graphqlErrors') e(message)
      where message !~ '^request to http://poi-serv:8000/v2/station/[0-9]+ failed, reason: socket hang up$'))
    then raise exception 'Failure evidence mismatch'; end if;
  update fuel_national_config set enabled=true,halt_reason='USER_AUTHORIZED_TRANSIENT_RECOVERY' where id;
  insert into fuel_national_events(code,response_evidence) values('USER_AUTHORIZED_TRANSIENT_RECOVERY',
    jsonb_build_object('original_event_id',28,'original_pause_until',cfg.provider_backoff_until,
      'change','Known transient GraphQL failures use bounded retries; original headers and regional routing retained'));
end $$;
commit;
