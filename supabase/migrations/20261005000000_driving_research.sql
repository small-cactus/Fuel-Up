-- Opt-in driving pilot, isolated from price research and production ranking.
create table public.driving_research_participants (
 id uuid primary key, token_hash text not null, consent_version integer not null check(consent_version=1),
 enrolled_at timestamptz not null default now(), revoked_at timestamptz,
 window_at timestamptz not null default now(), requests integer not null default 0
);
create table public.driving_research_events (
 participant_id uuid not null references public.driving_research_participants(id),
 id uuid not null, kind text not null, recorded_at timestamptz not null,
 received_at timestamptz not null default now(), event jsonb not null,
 primary key(participant_id,id)
);
create index driving_research_events_time on public.driving_research_events(participant_id,recorded_at);
alter table public.driving_research_participants enable row level security;
alter table public.driving_research_events enable row level security;
revoke all on public.driving_research_participants,public.driving_research_events from public,anon,authenticated;

create function public.enroll_driving_research(p_id uuid,p_hash text) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform pg_advisory_xact_lock(71892205);
 if p_hash !~ '^[a-f0-9]{64}$' then return false; end if;
 if exists(select 1 from driving_research_participants where id=p_id) then
  return exists(select 1 from driving_research_participants where id=p_id and token_hash=p_hash and revoked_at is null);
 end if;
 -- This is a small, explicitly enabled pilot, not open unlimited enrollment.
 if (select count(*) from driving_research_participants where revoked_at is null)>=100 then return false; end if;
 insert into driving_research_participants(id,token_hash,consent_version) values(p_id,p_hash,1);
 return true;
end $$;

create function public.access_driving_research(p_id uuid,p_hash text) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 update driving_research_participants set
  requests=case when window_at<now()-interval '10 minutes' then 1 else requests+1 end,
  window_at=case when window_at<now()-interval '10 minutes' then now() else window_at end
 where id=p_id and token_hash=p_hash and revoked_at is null
 and (requests<100 or window_at<now()-interval '10 minutes');
 return found;
end $$;

create function public.ingest_driving_research(p_id uuid,p_hash text,p_events jsonb) returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare e jsonb; existing jsonb; n integer:=0;
begin
 perform 1 from driving_research_participants where id=p_id and token_hash=p_hash and revoked_at is null for update;
 if not found then raise exception 'Not enrolled'; end if;
 if jsonb_typeof(p_events)!='array' or jsonb_array_length(p_events)>200 then raise exception 'Invalid batch'; end if;
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

create function public.delete_driving_research(p_id uuid,p_hash text) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 update driving_research_participants set revoked_at=now() where id=p_id and token_hash=p_hash;
 if not found then return false; end if;
 delete from driving_research_events where participant_id=p_id;
 return true;
end $$;

-- Coordinates only, cache only, no provider calls and no ranking/price filters.
create function public.driving_research_stations(p_lat double precision,p_lon double precision) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(s),'[]'::jsonb) from (
 select station_id as id,coalesce(station->>'name','Gas station') as name,latitude,longitude
 from fuel_station_latest
 where p_lat between -90 and 90 and p_lon between -180 and 180
 and latitude between p_lat-0.15 and p_lat+0.15
 and longitude between p_lon-0.15/greatest(cos(radians(p_lat)),0.1) and p_lon+0.15/greatest(cos(radians(p_lat)),0.1)
 order by power(latitude-p_lat,2)+power((longitude-p_lon)*cos(radians(p_lat)),2)
 limit 1000
 )s
$$;
revoke all on function public.enroll_driving_research(uuid,text),public.access_driving_research(uuid,text),public.ingest_driving_research(uuid,text,jsonb),public.delete_driving_research(uuid,text),public.driving_research_stations(double precision,double precision) from public,anon,authenticated;
grant execute on function public.enroll_driving_research(uuid,text),public.access_driving_research(uuid,text),public.ingest_driving_research(uuid,text,jsonb),public.delete_driving_research(uuid,text),public.driving_research_stations(double precision,double precision) to service_role;
