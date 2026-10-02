-- Run after migration; every diagnostic fixture rolls back.
begin;
do $$
declare job fuel_national_jobs; before_count bigint;
begin
 select * into job from fuel_national_jobs where status='succeeded' order by id desc limit 1;
 if not found then raise exception 'Archived fixture required'; end if;
 select count(*) into before_count from fuel_national_events where job_id=job.id;
 if record_fuel_national_projection_event(job.id,gen_random_uuid(),'SERVING_DEFERRED_57014') then raise exception 'Stale token accepted'; end if;
 if not record_fuel_national_projection_event(job.id,job.lease_token,'SERVING_DEFERRED_57014') then raise exception 'Committed archive diagnostic rejected'; end if;
 if (select count(*) from fuel_national_events where job_id=job.id)<>before_count+1 then raise exception 'Evidence not recorded'; end if;
 if (select status from fuel_national_jobs where id=job.id)<>'succeeded' then raise exception 'Archive invalidated'; end if;
 if has_function_privilege('anon','public.record_fuel_national_projection_event(bigint,uuid,text)','execute') then raise exception 'Public diagnostic access'; end if;
 if not has_function_privilege('service_role','public.finish_fuel_national_job(bigint,uuid,text[],timestamptz,timestamptz,text,bigint,text,integer)','execute') then raise exception 'Archive RPC unavailable'; end if;
 begin
  perform record_fuel_national_projection_event(job.id,job.lease_token,'UNSAFE_EVENT');
  raise exception 'Invalid code accepted';
 exception when others then if sqlerrm='Invalid code accepted' then raise; end if; end;
end $$;

rollback;
