-- Publish ten small app results after a complete sweep. This is cache-only;
-- it never dispatches a collector or touches immutable research observations.
create table public.fuel_national_trends_cache (
 fuel_type text not null, requires_e85 boolean not null,
 run_id bigint not null references public.fuel_national_runs(id),
 completed_at timestamptz not null, published_at timestamptz not null default now(),
 payload jsonb not null,
 primary key(fuel_type,requires_e85)
);
alter table public.fuel_national_trends_cache enable row level security;
revoke all on public.fuel_national_trends_cache from public,anon,authenticated,service_role;

create function public.publish_completed_national_trends() returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare latest fuel_national_runs; grade text; filter_e85 boolean;
begin
 if not pg_try_advisory_xact_lock(hashtext('publish_completed_national_trends')) then return false; end if;
 select r.* into latest from fuel_national_runs r join fuel_national_config c on c.catalog_id=r.catalog_id
 where r.status='complete' order by r.slot_at desc limit 1;
 if not found then return false; end if;
 if (select count(*) from fuel_national_trends_cache where run_id=latest.id)=10 then return false; end if;
 -- The last worker commits its archive, station projection and summary together.
 if (select count(*) from fuel_national_jobs j join fuel_national_trend_batches b
     on b.job_id=j.id and b.source_sha256=j.sha256
     where j.run_id=latest.id and j.status='succeeded')<>latest.expected_batches then return false; end if;
 -- Hold the projection steady during the short publication transaction. If a
 -- newer sweep has already written prices, wait for it rather than publish a mix.
 lock table fuel_station_latest in share mode;
 if exists(select 1 from fuel_station_latest l join fuel_national_jobs j on j.id=l.job_id
     join fuel_national_runs r on r.id=j.run_id where r.slot_at>latest.slot_at) then return false; end if;
 foreach grade in array array['regular','midgrade','premium','diesel','e85'] loop
  foreach filter_e85 in array array[false,true] loop
   insert into fuel_national_trends_cache(fuel_type,requires_e85,run_id,completed_at,payload)
   values(grade,filter_e85,latest.id,latest.completed_at,jsonb_build_object(
     'stations',national_fuel_station_cache(grade,filter_e85),
     'history',national_fuel_trend_history(grade,filter_e85),'historyError',null))
   on conflict(fuel_type,requires_e85) do update set run_id=excluded.run_id,
     completed_at=excluded.completed_at,published_at=now(),payload=excluded.payload;
  end loop;
 end loop;
 return true;
end $$;
revoke all on function public.publish_completed_national_trends() from public,anon,authenticated,service_role;

create or replace function public.national_fuel_trends(p_fuel_type text,p_requires_e85 boolean default false)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare cached fuel_national_trends_cache;
begin
 if p_fuel_type not in ('regular','midgrade','premium','diesel','e85') or p_fuel_type is null then raise exception 'Invalid fuel type'; end if;
 select * into cached from fuel_national_trends_cache where fuel_type=p_fuel_type and requires_e85=p_requires_e85;
 if not found then raise exception 'No completed national snapshot available'; end if;
 return cached.payload || jsonb_build_object('scanId',cached.run_id,'completedAt',cached.completed_at,
   'refreshAfter',greatest(cached.completed_at+interval '1 hour',now()+interval '1 minute'));
end $$;

-- Independent from collection: failures here cannot roll back an archived batch.
select cron.schedule('fuel-national-trends-cache','* * * * *',
 $$select public.publish_completed_national_trends();$$);
select public.publish_completed_national_trends();
