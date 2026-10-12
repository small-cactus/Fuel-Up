-- App-usage sync is independent of optional driving research enrollment.
create table public.app_installation_push_devices (
 installation_id uuid primary key references app_installations(id) on delete cascade,
 device_token text not null check(device_token ~ '^[a-f0-9]+$' and length(device_token) between 32 and 512),
 environment text not null check(environment in ('sandbox','production')),
 updated_at timestamptz not null default now(),
 unique(device_token,environment)
);
create table public.app_installation_sync_requests (
 id uuid primary key default gen_random_uuid(),
 installation_id uuid not null references app_installations(id) on delete cascade,
 requested_at timestamptz not null default now(),
 received_at timestamptz, completed_at timestamptz,
 push_status text not null default 'pending' check(push_status in('pending','sending','accepted','rejected','unknown')),
 push_reason text, push_attempted_at timestamptz
);
create unique index installation_one_pending_sync on app_installation_sync_requests(installation_id) where completed_at is null;
alter table app_installation_push_devices enable row level security;
alter table app_installation_sync_requests enable row level security;
revoke all on app_installation_push_devices,app_installation_sync_requests from public,anon,authenticated,service_role;

create function public.register_installation_push(p_id uuid,p_hash text,p_token text,p_environment text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if p_id is null or p_hash is null or p_token is null or p_environment is null or p_hash !~ '^[a-f0-9]{64}$' or p_token !~ '^[a-f0-9]+$' or length(p_token) not between 32 and 512 or p_environment not in('sandbox','production') then raise exception 'invalid_address'; end if;
 -- Same first-writer credential as event ingestion; registration can win the
 -- cold-launch race without overwriting a previously owned installation.
 insert into app_installations(id,token_hash) values(p_id,p_hash) on conflict do nothing;
 perform 1 from app_installations where id=p_id and token_hash=p_hash for update;
 if not found then raise exception 'unauthorized'; end if;
 insert into app_installation_push_devices(installation_id,device_token,environment)
 values(p_id,p_token,p_environment) on conflict(installation_id) do update
 set device_token=excluded.device_token,environment=excluded.environment,updated_at=now();
 return jsonb_build_object('registered',true);
end $$;

create function public.installation_sync_control(p_id uuid,p_hash text,p_request uuid default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare picked app_installation_sync_requests;
begin
 perform 1 from app_installations where id=p_id and token_hash=p_hash;
 if not found then raise exception 'unauthorized'; end if;
 select * into picked from app_installation_sync_requests where installation_id=p_id and completed_at is null
 and (p_request is null or id=p_request) limit 1 for update;
 if not found then return jsonb_build_object('requestId',null); end if;
 update app_installation_sync_requests set received_at=coalesce(received_at,now()) where id=picked.id;
 return jsonb_build_object('requestId',picked.id);
end $$;

create function public.complete_installation_sync(p_id uuid,p_hash text,p_request uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform 1 from app_installations where id=p_id and token_hash=p_hash;
 if not found then raise exception 'unauthorized'; end if;
 update app_installation_sync_requests set completed_at=coalesce(completed_at,now())
 where installation_id=p_id and id=p_request and received_at is not null;
 return jsonb_build_object('completed',found);
end $$;

-- Operator only. Same-device sends share a lock and cooldown with research.
create function public.prepare_installation_sync_push(p_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare req app_installation_sync_requests; device app_installation_push_devices;
begin
 perform 1 from app_installations where id=p_id for update;
 if not found then raise exception 'Unknown installation'; end if;
 insert into app_installation_sync_requests(installation_id) values(p_id) on conflict do nothing;
 select * into req from app_installation_sync_requests where installation_id=p_id and completed_at is null for update;
 if req.push_status<>'pending' then return jsonb_build_object('claimed',false,'requestId',req.id,'pushStatus',req.push_status); end if;
 select * into device from app_installation_push_devices where installation_id=p_id;
 if not found then return jsonb_build_object('claimed',false,'requestId',req.id,'pushStatus','no_device'); end if;
 perform pg_advisory_xact_lock(hashtextextended(device.environment||device.device_token,0));
 if exists(select 1 from app_installation_sync_requests where installation_id=p_id and push_attempted_at>now()-interval '30 minutes')
 or exists(select 1 from driving_research_sync_requests r join driving_research_push_devices d using(participant_id)
   where d.device_token=device.device_token and d.environment=device.environment and r.push_attempted_at>now()-interval '30 minutes') then
  return jsonb_build_object('claimed',false,'requestId',req.id,'pushStatus','throttled');
 end if;
 update app_installation_sync_requests set push_status='sending',push_attempted_at=now() where id=req.id;
 return jsonb_build_object('claimed',true,'requestId',req.id,'installationId',p_id,'deviceToken',device.device_token,'environment',device.environment,'expiresAt',extract(epoch from now()+interval '1 hour'));
end $$;

-- Preserve all existing research gates and add the reciprocal same-device budget.
create or replace function public.prepare_driving_research_sync_push(p_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare request_id uuid; request driving_research_sync_requests; device driving_research_push_devices;
begin
 request_id:=request_driving_research_sync(p_id);
 select * into request from driving_research_sync_requests where id=request_id for update;
 if request.push_status<>'pending' then return jsonb_build_object('claimed',false,'requestId',request_id,'pushStatus',request.push_status); end if;
 select * into device from driving_research_push_devices where participant_id=p_id;
 if not found then return jsonb_build_object('claimed',false,'requestId',request_id,'pushStatus','no_device'); end if;
 perform pg_advisory_xact_lock(hashtextextended(device.environment||device.device_token,0));
 if exists(select 1 from driving_research_sync_requests where participant_id=p_id and push_attempted_at>now()-interval '30 minutes')
 or exists(select 1 from app_installation_sync_requests r join app_installation_push_devices d using(installation_id)
  where d.device_token=device.device_token and d.environment=device.environment and r.push_attempted_at>now()-interval '30 minutes') then
  return jsonb_build_object('claimed',false,'requestId',request_id,'pushStatus','throttled');
 end if;
 update driving_research_sync_requests set push_status='sending',push_attempted_at=now() where id=request_id;
 return jsonb_build_object('claimed',true,'requestId',request_id,'deviceToken',device.device_token,'environment',device.environment,'expiresAt',extract(epoch from now()+interval '1 hour'));
end $$;

revoke all on function register_installation_push(uuid,text,text,text),installation_sync_control(uuid,text,uuid),complete_installation_sync(uuid,text,uuid),prepare_installation_sync_push(uuid) from public,anon,authenticated,service_role;
grant execute on function register_installation_push(uuid,text,text,text),installation_sync_control(uuid,text,uuid),complete_installation_sync(uuid,text,uuid) to service_role;
