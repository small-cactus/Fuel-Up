-- Run before activating a real campaign, or on a staging database. Always rolls back.
begin;
do $$
declare cities jsonb; planned integer; first_job public.fuel_research_jobs; reclaimed public.fuel_research_jobs; ok boolean;
begin
  if exists(select 1 from public.fuel_research_campaigns where status='active') then
    raise exception 'Run queue integration tests before activation or in staging';
  end if;
  select jsonb_agg(jsonb_build_object('id','test-'||n,'name','Test','latitude',28,'longitude',-82)) into cities from generate_series(1,24) n;
  planned:=public.start_fuel_research('transaction-test',cities,date_trunc('minute',now()));
  if planned<>4032 then raise exception 'Incorrect seven-day city-hour count'; end if;
  if public.start_fuel_research('transaction-test',cities,date_trunc('minute',now()))<>4032 then raise exception 'Start not idempotent'; end if;
  select * into first_job from public.claim_fuel_research_jobs(1);
  if first_job.id is null or first_job.attempts<>1 then raise exception 'Initial lease failed'; end if;
  if public.finish_fuel_research_job(first_job.id,gen_random_uuid(),now(),now(),'{"stations":[{}]}') then raise exception 'Wrong token accepted'; end if;
  update public.fuel_research_jobs set lease_until=now()-interval '1 second' where id=first_job.id;
  select * into reclaimed from public.claim_fuel_research_jobs(1);
  if reclaimed.id<>first_job.id or reclaimed.lease_token=first_job.lease_token or reclaimed.attempts<>2 then raise exception 'Lease recovery failed'; end if;
  if public.finish_fuel_research_job(first_job.id,first_job.lease_token,now(),now(),'{"stations":[{}]}') then raise exception 'Stale completion accepted'; end if;
  if not public.finish_fuel_research_job(reclaimed.id,reclaimed.lease_token,now(),now(),'{"stations":[{}]}') then raise exception 'Commit failed'; end if;
  if public.finish_fuel_research_job(reclaimed.id,reclaimed.lease_token,now(),now(),'{"stations":[{}]}') then raise exception 'Duplicate completion accepted'; end if;
  if (select count(*) from public.fuel_research_snapshots where job_id=reclaimed.id)<>1 then raise exception 'Snapshot duplicated'; end if;
  update public.fuel_research_jobs set due_at=now()-interval '10 seconds',next_attempt_at=now()-interval '10 seconds'
    where campaign_id='transaction-test' and city_id='test-2' and slot_at=(select starts_at from public.fuel_research_campaigns where id='transaction-test');
  select * into first_job from public.claim_fuel_research_jobs(1);
  if first_job.id is null then raise exception 'Second claim failed'; end if;
  if not public.fail_fuel_research_job(first_job.id,first_job.lease_token,'UPSTREAM_HTTP_429',1200) then raise exception 'Failure recording failed'; end if;
  if (select provider_backoff_until from public.fuel_research_campaigns where id='transaction-test')<now()+interval '20 minutes' then raise exception 'Retry-After ignored'; end if;
  if exists(select 1 from public.claim_fuel_research_jobs(2)) then raise exception 'Provider cooldown ignored'; end if;
  update public.fuel_research_jobs set due_at=now()-interval '2 minutes',deadline_at=now()-interval '1 minute' where id=first_job.id;
  perform public.claim_fuel_research_jobs(1);
  if (select status from public.fuel_research_jobs where id=first_job.id)<>'missed' then raise exception 'Missed hour not recorded'; end if;
  if has_table_privilege('anon','public.fuel_research_snapshots','select') or has_table_privilege('authenticated','public.fuel_research_snapshots','select') then raise exception 'Snapshots exposed'; end if;
  if has_function_privilege('anon','public.claim_fuel_research_jobs(integer)','execute') then raise exception 'Public queue access'; end if;
end; $$;
rollback;
