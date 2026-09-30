-- Disabled by default. Independent of the 24-city campaign and production prices.
create table public.fuel_national_catalogs (
  id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
  station_count integer not null check(station_count>0), region_count integer not null check(region_count=51),
  coverage jsonb not null, batch_count integer not null check(batch_count>0)
);
create table public.fuel_national_batches (
  catalog_id uuid not null references public.fuel_national_catalogs(id), ordinal integer not null,
  station_ids text[] not null check(cardinality(station_ids) between 1 and 2000), primary key(catalog_id,ordinal)
);
create table public.fuel_national_config (
  id boolean primary key default true check(id), enabled boolean not null default false,
  catalog_id uuid references public.fuel_national_catalogs(id), ends_at timestamptz,
  approved_lookups_per_hour integer not null default 0 check(approved_lookups_per_hour>=0),
  max_requests_per_hour integer not null default 200 check(max_requests_per_hour between 1 and 1000),
  archive_budget_bytes bigint not null default 500000000 check(archive_budget_bytes>8000000),
  provider_backoff_until timestamptz, halt_reason text not null default 'CATALOG_AND_PROVIDER_BUDGET_REQUIRED',
  last_dispatch_at timestamptz, last_request_at timestamptz,
  check(not enabled or (catalog_id is not null and ends_at is not null and approved_lookups_per_hour>0))
);
insert into public.fuel_national_config(id) values(true);
create table public.fuel_national_runs (
  id bigint generated always as identity primary key, slot_at timestamptz not null unique,
  deadline_at timestamptz not null, catalog_id uuid not null references public.fuel_national_catalogs(id),
  expected_stations integer not null, expected_batches integer not null,
  status text not null default 'running' check(status in ('running','complete','partial')),
  created_at timestamptz not null default now(), completed_at timestamptz
);
create table public.fuel_national_jobs (
  id bigint generated always as identity primary key, run_id bigint not null references public.fuel_national_runs(id),
  catalog_id uuid not null, ordinal integer not null,
  status text not null default 'queued' check(status in ('queued','running','succeeded','missed')),
  attempts integer not null default 0, next_attempt_at timestamptz not null default now(),
  lease_token uuid, lease_until timestamptz, last_error text,
  started_at timestamptz, observed_at timestamptz, object_path text, archive_bytes bigint,
  sha256 text, priced_count integer, completed_at timestamptz,
  unique(run_id,ordinal), foreign key(catalog_id,ordinal) references public.fuel_national_batches(catalog_id,ordinal)
);
create index fuel_national_pending on public.fuel_national_jobs(next_attempt_at) where status in ('queued','running');
create table public.fuel_national_events (
  id bigint generated always as identity primary key, created_at timestamptz not null default now(),
  job_id bigint references public.fuel_national_jobs(id), code text not null, retry_after_seconds integer not null default 0
);
do $$ declare t text; begin
  foreach t in array array['catalogs','batches','config','runs','jobs','events'] loop
    execute format('alter table public.fuel_national_%I enable row level security',t);
    execute format('revoke all on public.fuel_national_%I from public,anon,authenticated,service_role',t);
    execute format('grant select on public.fuel_national_%I to service_role',t);
  end loop;
end $$;

-- Admin-only catalog ingestion. Reconcile scope + exact unique IDs; do not accept
-- a truncated list by silently reducing its expected count. Discovery evidence
-- remains a required operator review, not a substitute for a real station census.
create function public.install_fuel_national_catalog(p_manifest jsonb) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare codes text[]:=array['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];
  region jsonb; ids text[]; cat uuid; coverage jsonb;
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
  select array_agg(id order by id) into ids from (select distinct i as id from jsonb_array_elements(p_manifest->'regions') r cross join lateral jsonb_array_elements_text(r->'ids') i) s;
  select jsonb_agg(r-'ids') into coverage from jsonb_array_elements(p_manifest->'regions') r;
  insert into fuel_national_catalogs(station_count,region_count,coverage,batch_count)
    values(cardinality(ids),51,coverage,ceil(cardinality(ids)/2000.0)::integer) returning id into cat;
  insert into fuel_national_batches(catalog_id,ordinal,station_ids)
    select cat,i,ids[(i*2000+1):least((i+1)*2000,cardinality(ids))] from generate_series(0,ceil(cardinality(ids)/2000.0)::integer-1) i;
  return cat;
end $$;

create function public.begin_fuel_national_hour() returns bigint
language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg fuel_national_config; cat fuel_national_catalogs; run bigint;
begin
  select * into cfg from fuel_national_config where id for update;
  update fuel_national_jobs j set status='missed',lease_until=null,last_error=coalesce(last_error,'HOUR_DEADLINE_MISSED')
    from fuel_national_runs r where r.id=j.run_id and r.deadline_at<=now() and j.status in ('queued','running');
  update fuel_national_runs set status='partial',completed_at=now() where status='running' and deadline_at<=now();
  if not cfg.enabled then return null; end if;
  if cfg.ends_at<=now() then update fuel_national_config set enabled=false,halt_reason='COLLECTION_END'; return null; end if;
  select * into cat from fuel_national_catalogs where id=cfg.catalog_id;
  if cat.created_at<now()-interval '24 hours' or cat.station_count>cfg.approved_lookups_per_hour
    or cat.batch_count>cfg.max_requests_per_hour then
    update fuel_national_config set enabled=false,halt_reason='CATALOG_STALE_OR_BUDGET_INSUFFICIENT'; return null;
  end if;
  insert into fuel_national_runs(slot_at,deadline_at,catalog_id,expected_stations,expected_batches)
    values(date_trunc('hour',now()),least(date_trunc('hour',now())+interval '1 hour',cfg.ends_at),cat.id,cat.station_count,cat.batch_count)
    on conflict(slot_at) do nothing;
  select id into run from fuel_national_runs where slot_at=date_trunc('hour',now());
  insert into fuel_national_jobs(run_id,catalog_id,ordinal)
    select run,b.catalog_id,b.ordinal from fuel_national_batches b join fuel_national_runs r on r.catalog_id=b.catalog_id where r.id=run
    on conflict(run_id,ordinal) do nothing;
  return run;
end $$;

create function public.claim_fuel_national_job()
returns table(id bigint,run_id bigint,lease_token uuid,station_ids text[])
language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg fuel_national_config; picked bigint;
begin
  select * into cfg from fuel_national_config where fuel_national_config.id for update;
  if not cfg.enabled or cfg.ends_at<=now() or cfg.provider_backoff_until>now() or cfg.last_request_at>now()-interval '2 seconds' then return; end if;
  -- A denial already seen by the existing campaign also blocks national work.
  if exists(select 1 from fuel_research_campaigns where status='active' and provider_backoff_until>now()) then return; end if;
  if exists(select 1 from fuel_national_jobs where status='running' and lease_until>now()) then return; end if;
  if (select coalesce(sum(archive_bytes),0) from fuel_national_jobs)+8000000>cfg.archive_budget_bytes then
    update fuel_national_config set enabled=false,halt_reason='ARCHIVE_BUDGET_REACHED'; return;
  end if;
  select j.id into picked from fuel_national_jobs j join fuel_national_runs r on r.id=j.run_id
    where r.status='running' and r.deadline_at>now() and j.next_attempt_at<=now() and j.attempts<3
      and (j.status='queued' or (j.status='running' and j.lease_until<=now())) order by j.id limit 1 for update of j;
  if picked is null then return; end if;
  if (select coalesce(sum(j.attempts),0) from fuel_national_jobs j join fuel_national_runs r on r.id=j.run_id where r.slot_at=date_trunc('hour',now()))>=cfg.max_requests_per_hour
    or (select coalesce(sum(j.attempts*cardinality(b.station_ids)),0) from fuel_national_jobs j join fuel_national_runs r on r.id=j.run_id join fuel_national_batches b on b.catalog_id=j.catalog_id and b.ordinal=j.ordinal where r.slot_at=date_trunc('hour',now()))
      +(select cardinality(b.station_ids) from fuel_national_jobs j join fuel_national_batches b on b.catalog_id=j.catalog_id and b.ordinal=j.ordinal where j.id=picked)>cfg.approved_lookups_per_hour then return; end if;
  update fuel_national_config set last_request_at=now();
  return query update fuel_national_jobs j set status='running',attempts=j.attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '90 seconds'
    from fuel_national_batches b where j.id=picked and b.catalog_id=j.catalog_id and b.ordinal=j.ordinal returning j.id,j.run_id,j.lease_token,b.station_ids;
end $$;

create function public.finish_fuel_national_job(p_id bigint,p_token uuid,p_ids text[],p_started_at timestamptz,p_observed_at timestamptz,p_path text,p_bytes bigint,p_sha256 text,p_priced integer)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare job fuel_national_jobs; run fuel_national_runs; expected text[];
begin
  select * into job from fuel_national_jobs where id=p_id for update;
  if not found or job.status<>'running' or job.lease_token is distinct from p_token or job.lease_until<=now() then return false; end if;
  select * into run from fuel_national_runs where id=job.run_id for update;
  select station_ids into expected from fuel_national_batches where catalog_id=job.catalog_id and ordinal=job.ordinal;
  if p_started_at is null or p_observed_at is null or run.deadline_at<=now() or p_started_at<run.slot_at or p_observed_at<p_started_at or p_observed_at>now()+interval '1 minute' or p_observed_at>=run.deadline_at then return false; end if;
  if p_ids is distinct from expected or p_bytes is null or p_bytes<1 or p_bytes>8000000 or p_priced is null or p_priced<0 or p_priced>cardinality(expected)
    or p_sha256 is null or p_sha256!~'^[a-f0-9]{64}$' or p_path is distinct from (job.run_id||'/'||job.id||'/'||p_token||'.json.gz') then raise exception 'Invalid batch coverage or artifact'; end if;
  update fuel_national_jobs set status='succeeded',started_at=p_started_at,observed_at=p_observed_at,object_path=p_path,archive_bytes=p_bytes,sha256=p_sha256,priced_count=p_priced,lease_until=null,completed_at=now() where id=p_id;
  if (select count(*) from fuel_national_jobs where run_id=run.id and status='succeeded')=run.expected_batches then
    update fuel_national_runs set status='complete',completed_at=now() where id=run.id;
  end if;
  return true;
end $$;

create function public.fail_fuel_national_job(p_id bigint,p_token uuid,p_code text,p_retry_after_seconds integer default 0)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare job fuel_national_jobs; cooldown integer;
begin
  -- Config first matches claim's lock order; no concurrent worker can slip into a cooldown.
  perform 1 from fuel_national_config where id for update;
  select * into job from fuel_national_jobs where id=p_id for update;
  if not found or job.status<>'running' or job.lease_token is distinct from p_token or job.lease_until<=now() then return false; end if;
  cooldown:=greatest(0,coalesce(p_retry_after_seconds,0),case p_code when 'UPSTREAM_HTTP_429' then 3600 when 'UPSTREAM_HTTP_403' then 86400 when 'UPSTREAM_HTTP_401' then 86400 when 'GRAPHQL_ERROR' then 3600 else 0 end);
  insert into fuel_national_events(job_id,code,retry_after_seconds) values(p_id,left(p_code,100),cooldown);
  update fuel_national_jobs set status=case when attempts>=3 then 'missed' else 'queued' end,lease_until=null,last_error=left(p_code,100),next_attempt_at=now()+make_interval(secs=>greatest(cooldown,60*job.attempts)) where id=p_id;
  if cooldown>0 then
    update fuel_national_config set provider_backoff_until=greatest(coalesce(provider_backoff_until,now()),now()+make_interval(secs=>cooldown)),halt_reason=left(p_code,100),
      enabled=case when p_code in ('UPSTREAM_HTTP_403','UPSTREAM_HTTP_401','GRAPHQL_ERROR') then false else enabled end;
    -- Do not send the same blocked traffic through the pre-existing campaign.
    update fuel_research_campaigns set provider_backoff_until=greatest(coalesce(provider_backoff_until,now()),now()+make_interval(secs=>cooldown)) where status='active';
  end if;
  return true;
end $$;

create function public.dispatch_fuel_national() returns bigint
language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg fuel_national_config; endpoint text; secret text; request_id bigint;
begin
  if not pg_try_advisory_xact_lock(71892051) then return null; end if;
  perform begin_fuel_national_hour();
  select * into cfg from fuel_national_config where id for update;
  if not cfg.enabled or cfg.provider_backoff_until>now() or cfg.last_dispatch_at>now()-interval '45 seconds'
    or exists(select 1 from fuel_research_campaigns where status='active' and provider_backoff_until>now())
    or exists(select 1 from fuel_national_jobs where status='running' and lease_until>now()) then return null; end if;
  if not exists(select 1 from fuel_national_jobs j join fuel_national_runs r on r.id=j.run_id where r.status='running' and r.deadline_at>now() and j.attempts<3 and j.next_attempt_at<=now() and j.status in ('queued','running')) then return null; end if;
  select decrypted_secret into endpoint from vault.decrypted_secrets where name='fuel_national_endpoint';
  select decrypted_secret into secret from vault.decrypted_secrets where name='fuel_research_secret';
  if endpoint is null or secret is null then raise exception 'National scheduler configuration missing'; end if;
  select net.http_post(url:=endpoint,headers:=jsonb_build_object('Content-Type','application/json','x-fuel-research-key',secret),body:='{}'::jsonb,timeout_milliseconds:=100000) into request_id;
  update fuel_national_config set last_dispatch_at=now();
  return request_id;
end $$;

create view public.fuel_national_health with (security_invoker=true) as
select r.id,r.slot_at,r.status,r.expected_stations,r.expected_batches,r.completed_at,
  count(j.id) filter(where j.status='succeeded') as succeeded_batches,
  count(j.id) filter(where j.status='missed') as missed_batches,
  coalesce(sum(cardinality(b.station_ids)) filter(where j.status='succeeded'),0) as observed_stations,
  coalesce(sum(j.priced_count),0) as priced_stations,coalesce(sum(j.archive_bytes),0) as archive_bytes
from fuel_national_runs r left join fuel_national_jobs j on j.run_id=r.id
left join fuel_national_batches b on b.catalog_id=j.catalog_id and b.ordinal=j.ordinal group by r.id;
revoke all on public.fuel_national_health from public,anon,authenticated;
grant select on public.fuel_national_health to service_role;

revoke all on function public.install_fuel_national_catalog(jsonb),public.begin_fuel_national_hour(),public.claim_fuel_national_job(),
  public.finish_fuel_national_job(bigint,uuid,text[],timestamptz,timestamptz,text,bigint,text,integer),
  public.fail_fuel_national_job(bigint,uuid,text,integer),public.dispatch_fuel_national() from public,anon,authenticated,service_role;
grant execute on function public.claim_fuel_national_job(),
  public.finish_fuel_national_job(bigint,uuid,text[],timestamptz,timestamptz,text,bigint,text,integer),
  public.fail_fuel_national_job(bigint,uuid,text,integer) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('fuel-national','fuel-national',false,8000000,array['application/gzip']) on conflict(id) do nothing;
-- Cron/Vault setup is a separate deployment step. Migration starts no traffic.
