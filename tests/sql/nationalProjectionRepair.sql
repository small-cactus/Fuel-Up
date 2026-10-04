-- Run after the migration inside a transaction, then roll back. Uses the latest
-- real pending publication, without touching research jobs or provider endpoints.
do $$
declare job jsonb; again jsonb; succeeded boolean;
begin
 if has_function_privilege('anon','public.claim_fuel_projection_repair()','EXECUTE') or
    has_function_privilege('authenticated','public.finish_fuel_projection_repair(bigint,uuid,text)','EXECUTE') then raise exception 'Repair is publicly callable'; end if;
 if not has_function_privilege('service_role','public.claim_fuel_projection_repair()','EXECUTE') then raise exception 'Worker lacks claim permission'; end if;
 job:=claim_fuel_projection_repair();
 if job is null then raise exception 'Fixture requires an idle collector and pending latest projection'; end if;
 again:=claim_fuel_projection_repair();
 if again is not null then raise exception 'Concurrent replay lease allowed'; end if;
 if finish_fuel_projection_repair((job->>'id')::bigint,gen_random_uuid(),'ARCHIVE_DOWNLOAD_FAILED') then raise exception 'Wrong lease accepted'; end if;
 begin
  perform finish_fuel_projection_repair((job->>'id')::bigint,(job->>'repair_token')::uuid,null);
  raise exception 'Missing summary accepted';
 exception when raise_exception then
  if sqlerrm<>'Publication incomplete' then raise; end if;
 end;
 succeeded:=finish_fuel_projection_repair((job->>'id')::bigint,(job->>'repair_token')::uuid,'ARCHIVE_DOWNLOAD_FAILED');
 if not succeeded then raise exception 'Valid failure lease rejected'; end if;
 if not exists(select 1 from fuel_projection_repairs where job_id=(job->>'id')::bigint and next_attempt_at>now() and last_error='ARCHIVE_DOWNLOAD_FAILED' and completed_at is null) then raise exception 'Backoff or error evidence missing'; end if;
end $$;
