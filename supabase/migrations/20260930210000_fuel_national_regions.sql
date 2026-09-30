-- Fixed geographic ownership. Does not enable provider traffic or increase the
-- existing shared provider budget/concurrency/cooldown. Existing DB stays East.
do $$ begin
  if exists(select 1 from public.fuel_national_catalogs) or exists(select 1 from public.fuel_national_config where enabled) then
    raise exception 'Upgrade requires an empty paused national catalog; never silently reroute existing jobs';
  end if;
end $$;


create table public.fuel_national_regions (
  region text primary key check(region in ('us-east-1','us-west-1','us-west-2')),
  function_name text not null unique, enabled boolean not null default true, last_dispatch_at timestamptz
);
insert into public.fuel_national_regions(region,function_name) values
  ('us-east-1','fuel-national-east'),('us-west-1','fuel-national-southwest'),('us-west-2','fuel-national-northwest');
create table public.fuel_national_state_routes (
  state_code text primary key, execution_region text not null references public.fuel_national_regions(region)
);
insert into public.fuel_national_state_routes select unnest(string_to_array('AL AR CT DE DC FL GA IL IN IA KS KY LA ME MD MA MI MN MS MO NE NH NJ NY NC ND OH OK PA RI SC SD TN TX VT VA WV WI',' ')),'us-east-1';
insert into public.fuel_national_state_routes select unnest(string_to_array('AZ CA CO HI NV NM UT',' ')),'us-west-1';
insert into public.fuel_national_state_routes select unnest(string_to_array('AK ID MT OR WA WY',' ')),'us-west-2';
alter table public.fuel_national_regions enable row level security;
alter table public.fuel_national_state_routes enable row level security;
revoke all on public.fuel_national_regions,public.fuel_national_state_routes from public,anon,authenticated,service_role;
grant select on public.fuel_national_regions,public.fuel_national_state_routes to service_role;
alter table public.fuel_national_batches add column execution_region text not null references public.fuel_national_regions(region);
alter table public.fuel_national_jobs add column execution_region text references public.fuel_national_regions(region);

-- Preserve strict scope/count/time validation and create only region-owned batches.
create or replace function public.install_fuel_national_catalog(p_manifest jsonb) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare codes text[]:=array['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];
  region jsonb; ids text[]; cat uuid; coverage jsonb; partition record; ordinal_offset integer:=0; batches integer;
begin
  if jsonb_typeof(p_manifest->'regions') is distinct from 'array' or jsonb_array_length(p_manifest->'regions')<>51 then raise exception 'Require 50 states plus DC'; end if;
  if (select count(distinct r->>'code') from jsonb_array_elements(p_manifest->'regions') r)<>51 then raise exception 'Duplicate region'; end if;
  for region in select * from jsonb_array_elements(p_manifest->'regions') loop
    if not coalesce(region->>'code'=any(codes),false) or (region->>'complete')::boolean is distinct from true
      or length(coalesce(region->>'coverageBasis',''))=0 or (region->>'observedAt') is null
      or (region->>'observedAt')::timestamptz<now()-interval '24 hours' or (region->>'observedAt')::timestamptz>now()+interval '1 minute'
      or jsonb_typeof(region->'ids') is distinct from 'array' then raise exception 'Invalid/unverified region'; end if;
    if coalesce((region->>'expectedCount')::integer,0)<1 or jsonb_array_length(region->'ids')<>(region->>'expectedCount')::integer
      or (select count(distinct i) from jsonb_array_elements_text(region->'ids') i)<>(region->>'expectedCount')::integer
      or exists(select 1 from jsonb_array_elements_text(region->'ids') i where i is null or i!~'^[0-9]{1,12}$') then raise exception 'Incomplete region inventory'; end if;
  end loop;
  if exists(select i from jsonb_array_elements(p_manifest->'regions') r
    cross join lateral jsonb_array_elements_text(r->'ids') i join fuel_national_state_routes s on s.state_code=r->>'code'
    group by i having count(distinct s.execution_region)>1) then raise exception 'Ambiguous cross-region station ownership'; end if;
  select array_agg(id order by id) into ids from (select distinct i as id from jsonb_array_elements(p_manifest->'regions') r cross join lateral jsonb_array_elements_text(r->'ids') i) s;
  select jsonb_agg(r-'ids') into coverage from jsonb_array_elements(p_manifest->'regions') r;
  insert into fuel_national_catalogs(station_count,region_count,coverage,batch_count)
    values(cardinality(ids),51,coverage,ceil(cardinality(ids)/2000.0)::integer) returning id into cat;
  for partition in select s.execution_region,array_agg(distinct i order by i) as ids
    from jsonb_array_elements(p_manifest->'regions') r cross join lateral jsonb_array_elements_text(r->'ids') i
    join fuel_national_state_routes s on s.state_code=r->>'code' group by s.execution_region order by s.execution_region loop
    batches:=ceil(cardinality(partition.ids)/2000.0)::integer;
    insert into fuel_national_batches(catalog_id,ordinal,station_ids,execution_region)
      select cat,ordinal_offset+n,partition.ids[(n*2000+1):least((n+1)*2000,cardinality(partition.ids))],partition.execution_region from generate_series(0,batches-1) n;
    ordinal_offset:=ordinal_offset+batches;
  end loop;
  if (select sum(cardinality(station_ids)) from fuel_national_batches where catalog_id=cat)<>(select station_count from fuel_national_catalogs where id=cat) then raise exception 'Regional coverage mismatch'; end if;
  update fuel_national_catalogs set batch_count=ordinal_offset where id=cat;
  return cat;
end $$;

revoke all on function public.install_fuel_national_catalog(jsonb) from public,anon,authenticated,service_role;
drop function public.claim_fuel_national_job();

create function public.claim_fuel_national_region_job(p_region text)
returns table(id bigint,run_id bigint,lease_token uuid,station_ids text[],execution_region text)
language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg fuel_national_config; picked bigint;
begin
  if not exists(select 1 from fuel_national_regions where region=p_region and enabled) then raise exception 'Unknown or disabled execution region'; end if;
  select * into cfg from fuel_national_config where fuel_national_config.id for update;
  if not cfg.enabled or cfg.ends_at<=now() or cfg.provider_backoff_until>now() or cfg.last_request_at>now()-interval '2 seconds' then return; end if;
  -- A denial already seen by the existing campaign also blocks national work.
  if exists(select 1 from fuel_research_campaigns where status='active' and provider_backoff_until>now()) then return; end if;
  if exists(select 1 from fuel_national_jobs where status='running' and lease_until>now()) then return; end if;
  if (select coalesce(sum(archive_bytes),0) from fuel_national_jobs)+8000000>cfg.archive_budget_bytes then
    update fuel_national_config set enabled=false,halt_reason='ARCHIVE_BUDGET_REACHED'; return;
  end if;
  select j.id into picked from fuel_national_jobs j join fuel_national_runs r on r.id=j.run_id join fuel_national_batches b on b.catalog_id=j.catalog_id and b.ordinal=j.ordinal
    where b.execution_region=p_region and r.status='running' and r.deadline_at>now() and j.next_attempt_at<=now() and j.attempts<3
      and (j.status='queued' or (j.status='running' and j.lease_until<=now())) order by j.id limit 1 for update of j;
  if picked is null then return; end if;
  if (select coalesce(sum(j.attempts),0) from fuel_national_jobs j join fuel_national_runs r on r.id=j.run_id where r.slot_at=date_trunc('hour',now()))>=cfg.max_requests_per_hour
    or (select coalesce(sum(j.attempts*cardinality(b.station_ids)),0) from fuel_national_jobs j join fuel_national_runs r on r.id=j.run_id join fuel_national_batches b on b.catalog_id=j.catalog_id and b.ordinal=j.ordinal where r.slot_at=date_trunc('hour',now()))
      +(select cardinality(b.station_ids) from fuel_national_jobs j join fuel_national_batches b on b.catalog_id=j.catalog_id and b.ordinal=j.ordinal where j.id=picked)>cfg.approved_lookups_per_hour then return; end if;
  update fuel_national_config set last_request_at=now();
  return query update fuel_national_jobs j set execution_region=p_region,status='running',attempts=j.attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '90 seconds'
    from fuel_national_batches b where j.id=picked and b.catalog_id=j.catalog_id and b.ordinal=j.ordinal returning j.id,j.run_id,j.lease_token,b.station_ids,b.execution_region;
end $$;

-- Scheduler pins the gateway region as well as choosing the region-specific
-- function. The handler verifies SB_REGION independently before database work.
create or replace function public.dispatch_fuel_national() returns bigint
language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg fuel_national_config; target fuel_national_regions; endpoint text; secret text; request_id bigint;
begin
  if not pg_try_advisory_xact_lock(71892051) then return null; end if;
  perform begin_fuel_national_hour();
  select * into cfg from fuel_national_config where id for update;
  if not cfg.enabled or cfg.provider_backoff_until>now() or cfg.last_dispatch_at>now()-interval '45 seconds'
    or exists(select 1 from fuel_research_campaigns where status='active' and provider_backoff_until>now())
    or exists(select 1 from fuel_national_jobs where status='running' and lease_until>now()) then return null; end if;
  select * into target from fuel_national_regions x where x.enabled and exists(
    select 1 from fuel_national_jobs j join fuel_national_runs r on r.id=j.run_id
      join fuel_national_batches b on b.catalog_id=j.catalog_id and b.ordinal=j.ordinal
    where b.execution_region=x.region and r.status='running' and r.deadline_at>now() and j.attempts<3
      and j.next_attempt_at<=now() and (j.status='queued' or (j.status='running' and j.lease_until<=now())))
    order by x.last_dispatch_at nulls first,x.region limit 1;
  if not found then return null; end if;
  select decrypted_secret into endpoint from vault.decrypted_secrets where name='fuel_national_endpoint';
  select decrypted_secret into secret from vault.decrypted_secrets where name='fuel_research_secret';
  if endpoint is null or secret is null or endpoint!~'/fuel-national$' then raise exception 'Regional scheduler configuration missing'; end if;
  endpoint:=regexp_replace(endpoint,'/fuel-national$','/'||target.function_name);
  select net.http_post(url:=endpoint,headers:=jsonb_build_object('Content-Type','application/json','x-fuel-research-key',secret,'x-region',target.region),
    body:='{"mode":"collect"}'::jsonb,timeout_milliseconds:=100000) into request_id;
  update fuel_national_config set last_dispatch_at=now();
  update fuel_national_regions set last_dispatch_at=now() where region=target.region;
  return request_id;
end $$;

create view public.fuel_national_regional_health with (security_invoker=true) as
select r.id as run_id,r.slot_at,b.execution_region,count(*) as expected_batches,
  count(*) filter(where j.status='succeeded') as succeeded_batches,
  coalesce(sum(cardinality(b.station_ids)) filter(where j.status='succeeded'),0) as observed_stations,
  count(*) filter(where j.execution_region is not null and j.execution_region<>b.execution_region) as wrong_region_jobs
from public.fuel_national_runs r join public.fuel_national_jobs j on j.run_id=r.id
join public.fuel_national_batches b on b.catalog_id=j.catalog_id and b.ordinal=j.ordinal group by r.id,r.slot_at,b.execution_region;
revoke all on public.fuel_national_regional_health from public,anon,authenticated;
grant select on public.fuel_national_regional_health to service_role;

revoke all on function public.claim_fuel_national_region_job(text),public.dispatch_fuel_national() from public,anon,authenticated,service_role;
grant execute on function public.claim_fuel_national_region_job(text) to service_role;
