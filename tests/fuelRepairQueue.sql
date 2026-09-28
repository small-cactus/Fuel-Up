-- Integration checks against the linked project. Every test mutation is rolled back.
begin;
delete from public.fuel_provider_events;
delete from public.fuel_repair_jobs;
do $$
declare job public.fuel_repair_jobs; token uuid; lease uuid; i integer;
begin
  for i in 1..4 loop perform public.record_fuel_provider_result(false,'UPSTREAM_TEST'); end loop;
  if exists(select 1 from public.fuel_repair_jobs) then raise exception 'Repair threshold fired early'; end if;
  perform public.record_fuel_provider_result(false,'UPSTREAM_TEST');
  if (select count(*) from public.fuel_repair_jobs) <> 1 then raise exception 'Threshold did not create exactly one job'; end if;
  perform public.record_fuel_provider_result(false,'UPSTREAM_TEST');
  if (select count(*) from public.fuel_repair_jobs) <> 1 then raise exception 'Duplicate repair was created'; end if;
  select * into job from public.claim_fuel_repair();
  if job.attempts <> 1 or job.status <> 'running' then raise exception 'Claim failed'; end if;
  if exists(select 1 from public.claim_fuel_repair()) then raise exception 'Active job was claimed twice'; end if;
  if public.update_fuel_repair(job.id,gen_random_uuid(),'succeeded') then raise exception 'Wrong lease token accepted'; end if;
  if not public.update_fuel_repair(job.id,job.lease_token,'queued') then raise exception 'Retry failed'; end if;
  select * into job from public.claim_fuel_repair();
  if job.attempts <> 2 then raise exception 'Retry count incorrect'; end if;
  if not public.update_fuel_repair(job.id,job.lease_token,'succeeded','{"test":true}') then raise exception 'Completion failed'; end if;
  lease := public.claim_fuel_refresh('__transaction_test__');
  if lease is null or public.claim_fuel_refresh('__transaction_test__') is not null then raise exception 'Refresh lease failed'; end if;
  perform public.release_fuel_refresh('__transaction_test__',gen_random_uuid());
  if public.claim_fuel_refresh('__transaction_test__') is not null then raise exception 'Wrong token released refresh'; end if;
  perform public.release_fuel_refresh('__transaction_test__',lease);
  if public.claim_fuel_refresh('__transaction_test__') is null then raise exception 'Refresh lease not released'; end if;
  if has_table_privilege('anon','public.fuel_repair_jobs','SELECT') then raise exception 'Anonymous queue access allowed'; end if;
  if has_function_privilege('anon','public.claim_fuel_repair()','EXECUTE') then raise exception 'Anonymous claim allowed'; end if;
end $$;
rollback;
