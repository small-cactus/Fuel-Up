-- Isolated, operator-created notification fixtures. Never training observations.
create table public.driving_research_notification_tests (
 id uuid primary key default gen_random_uuid(),
 participant_id uuid not null references public.driving_research_participants(id),
 station_name text not null check(length(station_name) between 1 and 80),
 candidate boolean not null,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default (now()+interval '24 hours'),
 status text not null default 'queued' check(status in ('queued','preparing','scheduled','permission_missing','schedule_failed','dismissed','answered')),
 label text check(label in ('fueled','not_fueling','not_a_stop','wrong_station','unsure')),
 response_at timestamptz,
 updated_at timestamptz not null default now()
);
create index driving_research_notification_tests_participant on public.driving_research_notification_tests(participant_id);
alter table public.driving_research_notification_tests enable row level security;
revoke all on public.driving_research_notification_tests from public,anon,authenticated;

create function public.request_driving_research_notification_test(p_id uuid,p_station text,p_candidate boolean,p_test_id uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare existing driving_research_notification_tests;
begin
 perform 1 from driving_research_participants where id=p_id and revoked_at is null for update;
 if not found then raise exception 'Participant not enrolled'; end if;
 select * into existing from driving_research_notification_tests where id=p_test_id;
 if found then
  if existing.participant_id!=p_id or existing.station_name!=p_station or existing.candidate!=p_candidate then raise exception 'Test identity conflict'; end if;
  return p_test_id;
 end if;
 if (select count(*) from driving_research_notification_tests where participant_id=p_id)>=20 then raise exception 'Delete old tests first'; end if;
 insert into driving_research_notification_tests(id,participant_id,station_name,candidate) values(p_test_id,p_id,p_station,p_candidate);
 return p_test_id;
end $$;

create function public.delete_driving_research_notification_test(p_id uuid,p_test_id uuid) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 -- Same participant lock as reports: an in-flight report cannot resurrect a test.
 perform 1 from driving_research_participants where id=p_id for update;
 delete from driving_research_notification_tests where id=p_test_id and participant_id=p_id;
 return found;
end $$;

create function public.report_driving_research_notification_test(p_id uuid,p_hash text,p_test_id uuid,p_status text,p_label text default null,p_response_at double precision default null) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform 1 from driving_research_participants where id=p_id and token_hash=p_hash and revoked_at is null for update;
 if not found then raise exception 'Not enrolled'; end if;
 if p_status not in ('preparing','scheduled','permission_missing','schedule_failed','dismissed','answered') then raise exception 'Invalid status'; end if;
 if (p_status='answered') != (p_label is not null) then raise exception 'Invalid answer'; end if;
 if p_status in ('answered','dismissed') and (p_response_at is null or p_response_at<0 or p_response_at>extract(epoch from now())+300) then raise exception 'Invalid response time'; end if;
 if not exists(select 1 from driving_research_notification_tests where participant_id=p_id and id=p_test_id and expires_at>now()) then return false; end if;
 update driving_research_notification_tests set status=p_status,label=p_label,
  response_at=case when p_response_at is null then null else to_timestamp(p_response_at) end,updated_at=now()
 where id=p_test_id and participant_id=p_id
  -- A delayed schedule/dismiss report cannot erase an answer, nor can an older answer win.
  and (label is null or p_label is not null)
  and (response_at is null or (p_response_at is not null and to_timestamp(p_response_at)>=response_at));
 return true;
end $$;

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
  'responseAt',extract(epoch from response_at)) order by created_at),'[]'::jsonb) into tests
 from driving_research_notification_tests where participant_id=p_id and expires_at>now();
 return jsonb_build_object('syncRequestId',result,'notificationTests',tests);
end $$;

create or replace function public.delete_driving_research(p_id uuid,p_hash text) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 update driving_research_participants set revoked_at=now() where id=p_id and token_hash=p_hash;
 if not found then return false; end if;
 delete from driving_research_events where participant_id=p_id;
 delete from driving_research_sync_requests where participant_id=p_id;
 delete from driving_research_device_counts where participant_id=p_id;
 delete from driving_research_notification_tests where participant_id=p_id;
 return true;
end $$;
revoke all on function public.request_driving_research_notification_test(uuid,text,boolean,uuid),public.delete_driving_research_notification_test(uuid,uuid),public.report_driving_research_notification_test(uuid,text,uuid,text,text,double precision) from public,anon,authenticated;
grant execute on function public.request_driving_research_notification_test(uuid,text,boolean,uuid),public.delete_driving_research_notification_test(uuid,uuid),public.report_driving_research_notification_test(uuid,text,uuid,text,text,double precision) to service_role;
