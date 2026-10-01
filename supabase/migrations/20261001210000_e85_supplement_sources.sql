-- Independent, daily availability metadata. Never modifies reported prices.
alter table public.fuel_e85_directory add column source text not null default 'afdc'
 check(source in ('afdc','e85prices','thorntons'));
alter table public.fuel_e85_directory add column canonical_source_id text;
create table public.fuel_e85_sources (
 source text primary key check(source in ('e85prices','thorntons')),
 enabled boolean not null default true,
 next_refresh_at timestamptz not null default now(),
 lease_token uuid, lease_until timestamptz,
 last_success_at timestamptz, last_error text, last_error_at timestamptz,
 imported_count integer, rejected_count integer, response_sha256 text
);
insert into public.fuel_e85_sources(source) values ('e85prices'),('thorntons');
alter table public.fuel_e85_sources enable row level security;
revoke all on public.fuel_e85_sources from public,anon,authenticated;
grant all on public.fuel_e85_sources to service_role;

create function public.e85_address_key(address text) returns text language sql immutable set search_path=public,pg_temp as $$
 select string_agg(case word when 'street' then 'st' when 'avenue' then 'ave' when 'boulevard' then 'blvd'
 when 'road' then 'rd' when 'drive' then 'dr' when 'highway' then 'hwy' when 'parkway' then 'pkwy'
 when 'lane' then 'ln' when 'court' then 'ct' when 'north' then 'n' when 'south' then 's'
 when 'east' then 'e' when 'west' then 'w' else word end,'' order by ord)
 from unnest(regexp_split_to_array(lower(address),'[^a-z0-9]+')) with ordinality a(word,ord)
$$;
create function public.e85_brand_key(name text) returns text language sql immutable as $$
 select regexp_replace(lower(split_part(name,'#',1)),'[^a-z0-9]','','g')
$$;
create function public.e85_same_site(a_street text,a_name text,a_lat double precision,a_lon double precision,
 b_street text,b_name text,b_lat double precision,b_lon double precision)
 returns boolean language sql immutable set search_path=public,pg_temp as $$
 select (meters<=200 and e85_address_key(a_street)=e85_address_key(b_street)) or
 (e85_brand_key(a_name)=e85_brand_key(b_name) and
 (meters<=25 or (meters<=150 and substring(a_street from '^[0-9]+')=substring(b_street from '^[0-9]+'))))
 from (select 2*6371000*asin(sqrt(least(1.0,power(sin(radians(a_lat-b_lat)/2),2)+cos(radians(a_lat))*cos(radians(b_lat))*power(sin(radians(a_lon-b_lon)/2),2)))) meters) d
$$;
create function public.reconcile_fuel_e85_directory() returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare row fuel_e85_directory; canonical text;
begin
 perform pg_advisory_xact_lock(hashtext('fuel-e85-directory'));
 update fuel_e85_directory set matched_station_id=null,match_rule=null,canonical_source_id=null where active;
 with matches as (
 select d.source_id,l.station_id,count(*) over(partition by d.source_id) candidates
 from fuel_e85_directory d join fuel_station_latest l
 on l.latitude between d.latitude-0.002 and d.latitude+0.002
 and l.longitude between d.longitude-0.01 and d.longitude+0.01
 where d.active and e85_same_site(d.street,d.name,d.latitude,d.longitude,
 l.station#>>'{address,line1}',l.station->>'name',l.latitude,l.longitude))
 update fuel_e85_directory d set matched_station_id=m.station_id,match_rule='unique-address-brand-site'
 from matches m where m.source_id=d.source_id and m.candidates=1;
 -- A source alias can resolve to an already matched site, only unambiguously.
 with aliases as (
 select d.source_id,min(m.matched_station_id) station_id,count(distinct m.matched_station_id) candidates
 from fuel_e85_directory d join fuel_e85_directory m
 on m.active and m.matched_station_id is not null
 and m.latitude between d.latitude-0.002 and d.latitude+0.002
 and m.longitude between d.longitude-0.01 and d.longitude+0.01
 where d.active and d.matched_station_id is null and e85_same_site(d.street,d.name,d.latitude,d.longitude,m.street,m.name,m.latitude,m.longitude)
 group by d.source_id)
 update fuel_e85_directory d set matched_station_id=a.station_id,match_rule='unambiguous-directory-alias'
 from aliases a where a.source_id=d.source_id and a.candidates=1;
 -- Canonical standalone IDs are rooted in a real site, never transitive chains.
 -- AFDC IDs keep priority to preserve existing card identity.
 for row in select * from fuel_e85_directory where active and matched_station_id is null
 order by (source='afdc') desc,source_id loop
  select d.source_id into canonical from fuel_e85_directory d
  where d.active and d.canonical_source_id=d.source_id and d.matched_station_id is null
   and d.latitude between row.latitude-0.002 and row.latitude+0.002
   and d.longitude between row.longitude-0.01 and row.longitude+0.01
   and e85_same_site(row.street,row.name,row.latitude,row.longitude,d.street,d.name,d.latitude,d.longitude)
  order by (source='afdc') desc,source_id limit 1;
  update fuel_e85_directory set canonical_source_id=coalesce(canonical,row.source_id) where source_id=row.source_id;
 end loop;
end $$;

create function public.claim_fuel_e85_source(p_source text) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare token uuid;
begin
 update fuel_e85_sources set lease_token=gen_random_uuid(),lease_until=now()+interval '10 minutes'
 where source=p_source and enabled and next_refresh_at<=now() and (lease_until is null or lease_until<=now())
 returning lease_token into token;
 return token;
end $$;
create function public.fail_fuel_e85_source(p_source text,p_token uuid,p_error text,p_retry_seconds integer,p_disable boolean)
 returns void language sql security definer set search_path=public,pg_temp as $$
 update fuel_e85_sources set last_error=left(p_error,120),last_error_at=now(),lease_token=null,lease_until=null,
 next_refresh_at=now()+make_interval(secs=>greatest(86400,coalesce(p_retry_seconds,86400))),enabled=not p_disable
 where source=p_source and lease_token=p_token
$$;
create function public.import_fuel_e85_source(p_source text,p_token uuid,p_rows jsonb,p_rejected integer,p_sha256 text)
 returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg fuel_e85_sources; total integer; minimum integer;
begin
 perform pg_advisory_xact_lock(hashtext('fuel-e85-directory'));
 select * into cfg from fuel_e85_sources where source=p_source for update;
 if not found or cfg.lease_token is distinct from p_token or cfg.lease_until<=now() then raise exception 'Invalid source lease'; end if;
 total=jsonb_array_length(p_rows); minimum=case when p_source='e85prices' then 4000 else 100 end;
 if total<minimum or total<coalesce(cfg.imported_count,0)*0.8 or total>20000 or p_rejected<0 or p_sha256!~'^[a-f0-9]{64}$'
 then raise exception 'Incomplete source snapshot'; end if;
 if exists(select 1 from jsonb_to_recordset(p_rows) as r(source_id text,name text,street text,city text,state text,latitude double precision,longitude double precision)
 where source_id is null or source_id!~'^[0-9]+$' or coalesce(name,'')='' or coalesce(street,'')='' or coalesce(city,'')=''
 or coalesce(state,'')!~'^[A-Z]{2}$' or latitude is null or longitude is null or latitude not between 18 and 72 or longitude not between -180 and -60)
 or (select count(distinct r->>'source_id') from jsonb_array_elements(p_rows) r)<>total then raise exception 'Invalid source records'; end if;
 update fuel_e85_directory set active=false where source=p_source;
 insert into fuel_e85_directory(source_id,source,name,street,city,state,latitude,longitude,fetched_at)
 select p_source||':'||r.source_id,p_source,r.name,r.street,r.city,r.state,r.latitude,r.longitude,now()
 from jsonb_to_recordset(p_rows) as r(source_id text,name text,street text,city text,state text,latitude double precision,longitude double precision)
 on conflict(source_id) do update set name=excluded.name,street=excluded.street,city=excluded.city,state=excluded.state,
 latitude=excluded.latitude,longitude=excluded.longitude,fetched_at=excluded.fetched_at,active=true;
 perform reconcile_fuel_e85_directory();
 update fuel_e85_sources set last_success_at=now(),next_refresh_at=now()+interval '23 hours',lease_token=null,lease_until=null,
 imported_count=total,rejected_count=p_rejected,response_sha256=p_sha256 where source=p_source;
 return jsonb_build_object('source',p_source,'imported',total,'rejected',p_rejected);
end $$;

create or replace function public.nearby_fuel_station_cache(p_latitude double precision,p_longitude double precision,p_radius_miles double precision)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if p_latitude is null or not p_latitude between -90 and 90 or p_longitude is null or not p_longitude between -180 and 180
   or p_radius_miles is null or not p_radius_miles between 1 and 100 then raise exception 'Invalid radius query'; end if;
 return (with candidates as (
  select l.station_id,l.latitude,l.longitude,l.observed_at,l.job_id,
   l.station||jsonb_build_object('offersE85',l.e85_listed_at is not null or exists(
    select 1 from fuel_e85_directory d where d.active and d.matched_station_id=l.station_id)) station
  from fuel_station_latest l where l.observed_at is not null
   and l.latitude between p_latitude-degrees(p_radius_miles/3958.7613) and p_latitude+degrees(p_radius_miles/3958.7613)
  union all
  select case when d.source='afdc' then 'afdc:'||d.source_id else d.source_id end,d.latitude,d.longitude,d.fetched_at,null::bigint,
   jsonb_build_object('id',case when d.source='afdc' then 'afdc:'||d.source_id else d.source_id end,'name',d.name,'latitude',d.latitude,'longitude',d.longitude,
    'address',jsonb_build_object('line1',d.street,'locality',d.city,'region',d.state,'postalCode',d.postal_code),
    'prices','[]'::jsonb,'offersE85',true,'availabilitySource',d.source)
  from fuel_e85_directory d where d.active and (d.canonical_source_id is null or d.canonical_source_id=d.source_id)
   and (d.matched_station_id is null or not exists(select 1 from fuel_station_latest l where l.station_id=d.matched_station_id and l.observed_at is not null))
   and d.latitude between p_latitude-degrees(p_radius_miles/3958.7613) and p_latitude+degrees(p_radius_miles/3958.7613)
 ) select coalesce(jsonb_agg(jsonb_build_object('station',station,'observedAt',observed_at,'jobId',job_id) order by station_id),'[]'::jsonb)
 from candidates where 2*3958.7613*asin(sqrt(least(1.0,power(sin(radians(latitude-p_latitude)/2),2)
     +cos(radians(p_latitude))*cos(radians(latitude))*power(sin(radians(longitude-p_longitude)/2),2))))<=p_radius_miles);
end $$;

create function public.dispatch_fuel_e85_directory() returns bigint language plpgsql security definer set search_path=public,pg_temp as $$
declare endpoint text; secret text; request_id bigint;
begin
 if not exists(select 1 from fuel_e85_sources where enabled and next_refresh_at<=now() and (lease_until is null or lease_until<=now())) then return null; end if;
 select decrypted_secret into endpoint from vault.decrypted_secrets where name='fuel_national_endpoint';
 select decrypted_secret into secret from vault.decrypted_secrets where name='fuel_research_secret';
 if endpoint is null or secret is null or endpoint!~'/fuel-national$' then raise exception 'Scheduler configuration missing'; end if;
 select net.http_post(url:=regexp_replace(endpoint,'/fuel-national$','/fuel-e85-directory'),
 headers:=jsonb_build_object('Content-Type','application/json','x-fuel-research-key',secret,'x-region','us-east-1'),body:='{}'::jsonb,timeout_milliseconds:=300000) into request_id;
 return request_id;
end $$;
revoke all on function public.e85_address_key(text),public.e85_brand_key(text),public.e85_same_site(text,text,double precision,double precision,text,text,double precision,double precision),
 public.reconcile_fuel_e85_directory(),public.claim_fuel_e85_source(text),public.fail_fuel_e85_source(text,uuid,text,integer,boolean),
 public.import_fuel_e85_source(text,uuid,jsonb,integer,text),public.dispatch_fuel_e85_directory() from public,anon,authenticated;
grant execute on function public.claim_fuel_e85_source(text),public.fail_fuel_e85_source(text,uuid,text,integer,boolean),
 public.import_fuel_e85_source(text,uuid,jsonb,integer,text) to service_role;
-- Availability changes slowly. Two public source requests per day, no user-triggered fetches.
select cron.schedule('fuel-e85-directory-daily','45 6 * * *','select public.dispatch_fuel_e85_directory()');
