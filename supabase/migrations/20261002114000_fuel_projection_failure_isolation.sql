-- Optional app enrichment must not invalidate complete immutable research data.
-- Retain a fenced diagnostic for deferred metadata or app projection updates.
create function public.record_fuel_national_projection_event(p_id bigint,p_token uuid,p_code text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if p_code is null or p_code !~ '^(METADATA_DEFERRED|SERVING_DEFERRED)_[A-Z0-9_]{1,24}$' then
   raise exception 'Invalid projection diagnostic';
 end if;
 if not exists(select 1 from fuel_national_jobs where id=p_id and lease_token=p_token
   and (status='succeeded' or (status='running' and lease_until>now()))) then return false; end if;
 insert into fuel_national_events(job_id,code) values(p_id,p_code);
 return true;
end $$;
revoke all on function public.record_fuel_national_projection_event(bigint,uuid,text) from public,anon,authenticated;
grant execute on function public.record_fuel_national_projection_event(bigint,uuid,text) to service_role;
