-- Independent, provider-free replay for app publications which timed out after
-- the immutable research batch committed. Collection leases and budgets untouched.
create table public.fuel_projection_repairs (
 job_id bigint primary key references public.fuel_national_jobs(id),
 lease_token uuid, lease_until timestamptz, attempts integer not null default 0,
 next_attempt_at timestamptz not null default now(), last_error text,
 completed_at timestamptz
);
alter table public.fuel_projection_repairs enable row level security;
revoke all on public.fuel_projection_repairs from public,anon,authenticated,service_role;

create function public.claim_fuel_projection_repair() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare latest bigint; picked bigint; token uuid; result jsonb;
begin
 if not pg_try_advisory_xact_lock(71892199) then return null; end if;
 if exists(select 1 from fuel_projection_repairs where lease_until>now()) then return null; end if;
 -- Keep optional recovery off the database while provider collection is active.
 if exists(select 1 from fuel_national_runs where status='running' and deadline_at>now()) then return null; end if;
 select r.id into latest from fuel_national_runs r join fuel_national_config c on c.catalog_id=r.catalog_id
 where r.status='complete' order by r.slot_at desc limit 1;
 if latest is null then return null; end if;
 select j.id into picked from fuel_national_jobs j
 left join fuel_national_trend_batches b on b.job_id=j.id and b.source_sha256=j.sha256
 left join fuel_projection_repairs p on p.job_id=j.id
 where j.run_id=latest and j.status='succeeded' and b.job_id is null
 and coalesce(p.attempts,0)<6 and coalesce(p.next_attempt_at,now())<=now()
 order by j.id limit 1;
 if picked is null then return null; end if;
 token:=gen_random_uuid();
 insert into fuel_projection_repairs(job_id,lease_token,lease_until,attempts)
 values(picked,token,now()+interval '2 minutes',1)
 on conflict(job_id) do update set lease_token=excluded.lease_token,lease_until=excluded.lease_until,
 attempts=fuel_projection_repairs.attempts+1;
 select to_jsonb(j)||jsonb_build_object('repair_token',token,'station_ids',b.station_ids,
 'assigned_region',b.execution_region,'slot_at',r.slot_at,'deadline_at',r.deadline_at) into result
 from fuel_national_jobs j join fuel_national_batches b using(catalog_id,ordinal)
 join fuel_national_runs r on r.id=j.run_id where j.id=picked;
 return result;
end $$;

create function public.finish_fuel_projection_repair(p_id bigint,p_token uuid,p_error text) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if p_error is not null and p_error!~'^[A-Z_]{1,64}$' then raise exception 'Invalid diagnostic'; end if;
 if p_error is null and not exists(select 1 from fuel_national_trend_batches b join fuel_national_jobs j on j.id=b.job_id and j.sha256=b.source_sha256 where j.id=p_id) then raise exception 'Publication incomplete'; end if;
 update fuel_projection_repairs set lease_until=null,last_error=p_error,
 completed_at=case when p_error is null then now() else null end,
 next_attempt_at=now()+least(attempts,5)*interval '1 minute'
 where job_id=p_id and lease_token=p_token and lease_until>now();
 return found;
end $$;

create function public.dispatch_fuel_projection_repair() returns bigint
language plpgsql security definer set search_path=public,pg_temp as $$
declare endpoint text; secret text; request_id bigint;
begin
 if exists(select 1 from fuel_national_runs where status='running' and deadline_at>now()) or
    exists(select 1 from fuel_projection_repairs where lease_until>now()) then return null; end if;
 if not exists(select 1 from fuel_national_jobs j
   left join fuel_national_trend_batches b on b.job_id=j.id and b.source_sha256=j.sha256
   left join fuel_projection_repairs p on p.job_id=j.id
   where j.status='succeeded' and b.job_id is null and coalesce(p.attempts,0)<6 and coalesce(p.next_attempt_at,now())<=now()
   and j.run_id=(select r.id from fuel_national_runs r join fuel_national_config c on c.catalog_id=r.catalog_id where r.status='complete' order by r.slot_at desc limit 1)) then return null; end if;
 select decrypted_secret into endpoint from vault.decrypted_secrets where name='fuel_national_endpoint';
 select decrypted_secret into secret from vault.decrypted_secrets where name='fuel_research_secret';
 if endpoint is null or secret is null or endpoint!~'/fuel-national$' then raise exception 'Projection scheduler configuration missing'; end if;
 select net.http_post(url:=regexp_replace(endpoint,'/fuel-national$','/fuel-national-projector'),
 headers:=jsonb_build_object('Content-Type','application/json','x-fuel-research-key',secret,'x-region','us-east-1'),
 body:='{}'::jsonb,timeout_milliseconds:=100000) into request_id;
 return request_id;
end $$;
revoke all on function public.claim_fuel_projection_repair(),public.finish_fuel_projection_repair(bigint,uuid,text),public.dispatch_fuel_projection_repair() from public,anon,authenticated,service_role;
grant execute on function public.claim_fuel_projection_repair(),public.finish_fuel_projection_repair(bigint,uuid,text) to service_role;
select cron.schedule('fuel-national-projection-repair','* * * * *','select public.dispatch_fuel_projection_repair();');
