alter table public.fuel_national_events add column response_evidence jsonb;
create function public.record_fuel_national_response(p_id bigint,p_token uuid,p_evidence jsonb) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare job fuel_national_jobs;
begin
 select * into job from fuel_national_jobs where id=p_id for update;
 if not found or job.status<>'running' or job.lease_token is distinct from p_token or job.lease_until<=now() then return false; end if;
 if jsonb_typeof(p_evidence) is distinct from 'object' or octet_length(p_evidence::text)>12000 then raise exception 'Invalid response evidence'; end if;
 insert into fuel_national_events(job_id,code,response_evidence) values(p_id,'PROVIDER_RESPONSE',p_evidence);
 return true;
end $$;
revoke all on function public.record_fuel_national_response(bigint,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.record_fuel_national_response(bigint,uuid,jsonb) to service_role;
