begin;
do $$
declare east bigint; west bigint; job record; saved boolean; t uuid;
begin
  if exists(select 1 from fuel_discovery_jobs) or exists(select 1 from fuel_national_config where enabled) then raise exception 'Test requires empty paused discovery'; end if;
  update fuel_national_config set enabled=false,provider_backoff_until=null,last_request_at=null;
  update fuel_research_campaigns set provider_backoff_until=null;
  update fuel_discovery_config set enabled=true,ends_at=now()+interval '1 hour';
  east:=enqueue_fuel_discovery('test-east','{"kind":"states","states":["FL"]}');
  west:=enqueue_fuel_discovery('test-west','{"kind":"states","states":["CA"]}');
  if east<>enqueue_fuel_discovery('test-east','{"kind":"states","states":["FL"]}') then raise exception 'Idempotency failure'; end if;
  begin
    perform enqueue_fuel_discovery('test-mixed','{"kind":"states","states":["CA","FL"]}');
    raise exception 'Accepted mixed ownership';
  exception when others then if sqlerrm='Accepted mixed ownership' then raise; end if; end;
  update fuel_national_config set provider_backoff_until=now()+interval '1 hour';
  if exists(select 1 from claim_fuel_discovery_job('us-east-1')) then raise exception 'Cooldown bypass'; end if;
  update fuel_national_config set provider_backoff_until=null;
  select * into job from claim_fuel_discovery_job('us-east-1');
  if job.id is distinct from east or job.execution_region<>'us-east-1' then raise exception 'Wrong regional job'; end if;
  t:=job.lease_token;
  update fuel_national_config set last_request_at=null;
  if exists(select 1 from claim_fuel_discovery_job('us-west-1')) then raise exception 'Cross-region concurrent request'; end if;
  if finish_fuel_discovery_job(east,gen_random_uuid(),'{}') then raise exception 'Stale writer accepted'; end if;
  begin
    perform finish_fuel_discovery_job(east,t,'{"executionRegion":"us-west-1","task":{"kind":"states","states":["FL"]},"scopes":[{}]}');
    raise exception 'Wrong provenance accepted';
  exception when others then if sqlerrm='Wrong provenance accepted' then raise; end if; end;
  if not fail_fuel_discovery_job(east,t,'UPSTREAM_HTTP_429',7200) then raise exception 'Failure not saved'; end if;
  if exists(select 1 from claim_fuel_discovery_job('us-west-1')) then raise exception '429 bypass from another region'; end if;
  if not exists(select 1 from fuel_national_config where provider_backoff_until>=now()+interval '7200 seconds') then raise exception 'Retry-After shortened'; end if;
  if not exists(select 1 from fuel_discovery_attempts where job_id=east and outcome='UPSTREAM_HTTP_429' and retry_after_seconds=7200) then raise exception 'Failure evidence lost'; end if;
  update fuel_national_config set provider_backoff_until=null,last_request_at=null;
  update fuel_research_campaigns set provider_backoff_until=null;
  select * into job from claim_fuel_discovery_job('us-west-1');
  if job.id is distinct from west then raise exception 'West claim failed'; end if;
  if not finish_fuel_discovery_job(west,job.lease_token,'{"executionRegion":"us-west-1","task":{"kind":"states","states":["CA"]},"scopes":[{"fullResponse":false}]}') then raise exception 'Result not saved'; end if;
  if not exists(select 1 from fuel_discovery_jobs where id=west and status='succeeded' and payload->'scopes'->0->>'fullResponse'='false') then raise exception 'Partial evidence lost'; end if;
  if has_function_privilege('anon','public.claim_fuel_discovery_job(text)','execute')
    or has_function_privilege('service_role','public.enqueue_fuel_discovery(text,jsonb)','execute')
    or has_function_privilege('service_role','public.dispatch_fuel_discovery()','execute') then raise exception 'RPC permissions too broad'; end if;
end $$;
rollback;
