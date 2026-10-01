-- Existing job fixture is changed only inside this rollback transaction.
-- Never invokes dispatch, providers, or archive writes.
begin;
do $$
declare target bigint; token uuid:=gen_random_uuid();
begin
  perform 1 from fuel_national_config where id for update;
  select id into target from fuel_national_jobs where status='missed' order by id limit 1 for update;
  if target is null then raise exception 'Requires an existing missed job fixture'; end if;
  update fuel_national_config set enabled=true,provider_backoff_until=null where id;
  update fuel_national_jobs set status='running',attempts=1,lease_token=token,lease_until=now()+interval '90 seconds' where id=target;
  if not fail_fuel_national_job(target,token,'UPSTREAM_TRANSIENT_GRAPHQL',60) then raise exception 'Failed to persist transient failure'; end if;
  if not (select enabled from fuel_national_config where id) then raise exception 'Transient error disabled collector'; end if;
  if (select provider_backoff_until from fuel_national_config where id)<now()+interval '60 seconds' then raise exception 'Transient cooldown missing'; end if;
  if not exists(select 1 from fuel_national_jobs where id=target and status='queued' and attempts=1 and next_attempt_at>=now()+interval '60 seconds') then raise exception 'Retry not queued'; end if;
  if exists(select 1 from claim_fuel_national_region_job('us-west-1')) or exists(select 1 from claim_fuel_national_region_job('us-east-1')) then raise exception 'Shared cooldown bypassed'; end if;
  update fuel_national_jobs set status='running',attempts=3,lease_until=now()+interval '90 seconds' where id=target;
  perform fail_fuel_national_job(target,token,'UPSTREAM_TRANSIENT_GRAPHQL',60);
  if not exists(select 1 from fuel_national_jobs where id=target and status='missed') then raise exception 'Attempt limit ignored'; end if;
  update fuel_national_jobs set status='running',attempts=1,lease_until=now()+interval '90 seconds' where id=target;
  perform fail_fuel_national_job(target,token,'UPSTREAM_HTTP_429',7200);
  if (select provider_backoff_until from fuel_national_config where id)<now()+interval '7200 seconds' then raise exception 'Retry-After shortened'; end if;
  update fuel_national_jobs set status='running',lease_until=now()+interval '90 seconds' where id=target;
  perform fail_fuel_national_job(target,token,'UPSTREAM_HTTP_403',0);
  if (select enabled from fuel_national_config where id) then raise exception 'Access denial did not stop collection'; end if;
end $$;
rollback;
select 'PASS: transient retry, global cooldown, attempt cap, Retry-After, access denial; all writes rolled back' as result;
