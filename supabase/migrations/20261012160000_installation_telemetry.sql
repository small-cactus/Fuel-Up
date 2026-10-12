-- First-party installation dossiers. No client SELECT access or raw GPS here.
create table if not exists public.app_installations (
  id uuid primary key,
  token_hash text not null,
  first_received_at timestamptz not null default now(),
  last_received_at timestamptz not null default now(),
  profile jsonb not null default '{}'::jsonb,
  highest_onboarding_step integer not null default -1,
  onboarding_completed boolean not null default false,
  event_count bigint not null default 0,
  rate_window timestamptz not null default now(),
  rate_count integer not null default 0
);
create table if not exists public.app_installation_events (
  installation_id uuid not null references public.app_installations(id) on delete cascade,
  id uuid not null,
  kind text not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  payload jsonb not null,
  primary key(installation_id,id)
);
create index if not exists app_installation_events_timeline on public.app_installation_events(installation_id,occurred_at);
alter table public.app_installations enable row level security;
alter table public.app_installation_events enable row level security;
revoke all on public.app_installations,public.app_installation_events from anon,authenticated;
grant all on public.app_installations,public.app_installation_events to service_role;

create or replace function public.ingest_installation_telemetry(p_id uuid,p_hash text,p_profile jsonb,p_events jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare existing public.app_installations; item jsonb; added integer; count_added integer:=0; ids jsonb:='[]';
begin
  if jsonb_typeof(p_events)<>'array' or jsonb_array_length(p_events)>50 or octet_length(p_events::text)>250000
    or octet_length(p_profile::text)>8000 or length(p_hash)<>64 then raise exception 'invalid_batch'; end if;
  insert into public.app_installations(id,token_hash) values(p_id,p_hash) on conflict do nothing;
  select * into existing from public.app_installations where id=p_id for update;
  if existing.token_hash<>p_hash then raise exception 'unauthorized'; end if;
  if existing.rate_window>now()-interval '1 minute' and existing.rate_count+jsonb_array_length(p_events)>600 then
    raise exception 'rate_limited';
  end if;
  for item in select value from jsonb_array_elements(p_events) loop
    insert into public.app_installation_events(installation_id,id,kind,occurred_at,payload)
      values(p_id,(item->>'id')::uuid,item->>'kind',to_timestamp((item->>'recordedAt')::double precision),item->'payload')
      on conflict do nothing;
    get diagnostics added=row_count; count_added:=count_added+added;
    ids:=ids||jsonb_build_array(item->>'id');
    if added>0 and item->>'kind'='onboarding_step' and (item->'payload'->>'step') ~ '^[0-3]$' then
      update public.app_installations set highest_onboarding_step=greatest(highest_onboarding_step,(item->'payload'->>'step')::integer) where id=p_id;
    end if;
    if added>0 and item->>'kind'='onboarding_complete' then
      update public.app_installations set onboarding_completed=true where id=p_id;
    end if;
  end loop;
  update public.app_installations set profile=p_profile,last_received_at=now(),event_count=event_count+count_added,
    rate_count=case when existing.rate_window<=now()-interval '1 minute' then jsonb_array_length(p_events) else rate_count+jsonb_array_length(p_events) end,
    rate_window=case when existing.rate_window<=now()-interval '1 minute' then now() else rate_window end where id=p_id;
  return jsonb_build_object('ids',ids);
end $$;
revoke all on function public.ingest_installation_telemetry(uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.ingest_installation_telemetry(uuid,text,jsonb,jsonb) to service_role;
