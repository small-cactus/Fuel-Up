-- Private control plane: participant tokens can only see their own request.
create table public.driving_research_device_counts (
 participant_id uuid primary key references public.driving_research_participants(id),
 local_total bigint not null check(local_total>=0), pending bigint not null check(pending>=0 and pending<=local_total),
 reported_at timestamptz not null default now()
);
create table public.driving_research_sync_requests (
 id uuid primary key default gen_random_uuid(), participant_id uuid not null references public.driving_research_participants(id),
 requested_at timestamptz not null default now(), completed_at timestamptz
);
create unique index driving_research_one_pending_sync on public.driving_research_sync_requests(participant_id) where completed_at is null;
alter table public.driving_research_device_counts enable row level security;
alter table public.driving_research_sync_requests enable row level security;
revoke all on public.driving_research_device_counts,public.driving_research_sync_requests from public,anon,authenticated;

create function public.request_driving_research_sync(p_id uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare result uuid;
begin
 perform 1 from driving_research_participants where id=p_id and revoked_at is null for update;
 if not found then raise exception 'Participant not enrolled'; end if;
 insert into driving_research_sync_requests(participant_id) values(p_id) on conflict do nothing;
 select id into result from driving_research_sync_requests where participant_id=p_id and completed_at is null;
 return result;
end $$;

create function public.driving_research_control(p_id uuid,p_hash text,p_total bigint default null,p_pending bigint default null,p_completed uuid default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result uuid;
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
 return jsonb_build_object('syncRequestId',result);
end $$;
revoke all on function public.request_driving_research_sync(uuid),public.driving_research_control(uuid,text,bigint,bigint,uuid) from public,anon,authenticated;
grant execute on function public.request_driving_research_sync(uuid),public.driving_research_control(uuid,text,bigint,bigint,uuid) to service_role;

create or replace function public.ingest_driving_research(p_id uuid,p_hash text,p_events jsonb) returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare e jsonb; existing jsonb; n integer:=0;
begin
 perform 1 from driving_research_participants where id=p_id and token_hash=p_hash and revoked_at is null for update;
 if not found then raise exception 'Not enrolled'; end if;
 if jsonb_typeof(p_events)!='array' or jsonb_array_length(p_events)>1000 then raise exception 'Invalid batch'; end if;
 for e in select value from jsonb_array_elements(p_events) loop
  select event into existing from driving_research_events where participant_id=p_id and id=(e->>'id')::uuid;
  if found and existing!=e then raise exception 'Immutable event conflict'; end if;
  insert into driving_research_events(participant_id,id,kind,recorded_at,event)
  values(p_id,(e->>'id')::uuid,e->>'kind',to_timestamp((e->>'recordedAt')::double precision),e)
  on conflict do nothing;
  n:=n+1;
 end loop;
 return n;
end $$;

create or replace function public.delete_driving_research(p_id uuid,p_hash text) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 update driving_research_participants set revoked_at=now() where id=p_id and token_hash=p_hash;
 if not found then return false; end if;
 delete from driving_research_events where participant_id=p_id;
 delete from driving_research_sync_requests where participant_id=p_id;
 delete from driving_research_device_counts where participant_id=p_id;
 return true;
end $$;

