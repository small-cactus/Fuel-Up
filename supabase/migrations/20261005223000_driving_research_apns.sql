-- APNs addresses are private participant configuration, never research samples.
create table public.driving_research_push_devices (
 participant_id uuid primary key references public.driving_research_participants(id),
 device_token text not null check(length(device_token) between 32 and 512 and device_token ~ '^[a-f0-9]+$'),
 environment text not null check(environment in ('sandbox','production')),
 updated_at timestamptz not null default now(),
 unique(device_token,environment)
);
alter table public.driving_research_push_devices enable row level security;
revoke all on public.driving_research_push_devices from public,anon,authenticated;

create function public.register_driving_research_push(p_id uuid,p_hash text,p_token text,p_environment text) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform 1 from driving_research_participants where id=p_id and token_hash=p_hash and revoked_at is null for update;
 if not found then raise exception 'Not enrolled'; end if;
 insert into driving_research_push_devices(participant_id,device_token,environment)
 values(p_id,p_token,p_environment) on conflict(participant_id) do update
 set device_token=excluded.device_token,environment=excluded.environment,updated_at=now();
 return true;
end $$;
revoke all on function public.register_driving_research_push(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.register_driving_research_push(uuid,text,text,text) to service_role;

alter table public.driving_research_notification_tests
 add column delivery text not null default 'local' check(delivery in ('local','apns')),
 add column push_status text check(push_status in ('sending','accepted','rejected','unknown')),
 add column push_reason text,
 add column push_attempted_at timestamptz,
 add column apns_id uuid;

-- The row becomes APNs-only in the same transaction that creates it. A control
-- poll can never race this operation and produce a duplicate local notification.
create function public.prepare_driving_research_push_test(p_id uuid,p_station text,p_candidate boolean,p_test_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare device driving_research_push_devices; fixture driving_research_notification_tests;
begin
 perform 1 from driving_research_participants where id=p_id and revoked_at is null for update;
 if not found then raise exception 'Participant not enrolled'; end if;
 select * into device from driving_research_push_devices where participant_id=p_id;
 if not found then raise exception 'Phone has not registered for APNs'; end if;
 if exists(select 1 from driving_research_notification_tests where id=p_test_id) then
  select * into fixture from driving_research_notification_tests where id=p_test_id;
  if fixture.participant_id!=p_id or fixture.station_name!=p_station or fixture.candidate!=p_candidate or fixture.delivery!='apns' then raise exception 'Test identity conflict'; end if;
  return jsonb_build_object('claimed',false,'pushStatus',fixture.push_status);
 end if;
 perform request_driving_research_notification_test(p_id,p_station,p_candidate,p_test_id);
 update driving_research_notification_tests set delivery='apns',push_status='sending',push_attempted_at=now(),apns_id=p_test_id where id=p_test_id returning * into fixture;
 return jsonb_build_object('claimed',true,'deviceToken',device.device_token,'environment',device.environment,
 'test',jsonb_build_object('id',fixture.id,'participantId',p_id,'stationName',fixture.station_name,'candidate',fixture.candidate,
 'createdAt',extract(epoch from fixture.created_at),'expiresAt',extract(epoch from fixture.expires_at),'status','queued','delivery','apns'));
end $$;
revoke all on function public.prepare_driving_research_push_test(uuid,text,boolean,uuid) from public,anon,authenticated;
grant execute on function public.prepare_driving_research_push_test(uuid,text,boolean,uuid) to service_role;

-- Revocation also removes the device address, including a deletion racing registration.
create function public.clear_revoked_research_push() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.revoked_at is not null then delete from driving_research_push_devices where participant_id=new.id; end if;
 return new;
end $$;
create trigger clear_revoked_research_push after update of revoked_at on public.driving_research_participants
 for each row execute function public.clear_revoked_research_push();
revoke all on function public.clear_revoked_research_push() from public,anon,authenticated;

create or replace function public.driving_research_control(p_id uuid,p_hash text,p_total bigint default null,p_pending bigint default null,p_completed uuid default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result uuid; tests jsonb;
begin
 perform 1 from driving_research_participants where id=p_id and token_hash=p_hash and revoked_at is null for update;
 if not found then raise exception 'Not enrolled'; end if;
 if p_total is not null or p_pending is not null then
  if p_total is null or p_pending is null or p_pending<0 or p_total<p_pending or p_total>100000000 then raise exception 'Invalid counts'; end if;
  insert into driving_research_device_counts(participant_id,local_total,pending) values(p_id,p_total,p_pending)
   on conflict(participant_id) do update set local_total=excluded.local_total,pending=excluded.pending,reported_at=now();
 end if;
 if p_completed is not null then
  update driving_research_sync_requests set completed_at=coalesce(completed_at,now()) where id=p_completed and participant_id=p_id;
 end if;
 select id into result from driving_research_sync_requests where participant_id=p_id and completed_at is null;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'stationName',station_name,'candidate',candidate,
  'createdAt',extract(epoch from created_at),'expiresAt',extract(epoch from expires_at),'status',status,'label',label,
  'responseAt',extract(epoch from response_at),'delivery',delivery,'pushStatus',push_status) order by created_at),'[]'::jsonb) into tests
 from driving_research_notification_tests where participant_id=p_id and expires_at>now();
 return jsonb_build_object('syncRequestId',result,'notificationTests',tests);
end $$;

