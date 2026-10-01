-- Daily refresh uses the next UTC calendar day, including the bootstrap import.
create or replace function public.import_fuel_e85_source(p_source text,p_token uuid,p_rows jsonb,p_rejected integer,p_sha256 text)
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
 update fuel_e85_sources set last_success_at=now(),next_refresh_at=date_trunc('day',now(),'UTC')+interval '1 day',lease_token=null,lease_until=null,
 imported_count=total,rejected_count=p_rejected,response_sha256=p_sha256 where source=p_source;
 return jsonb_build_object('source',p_source,'imported',total,'rejected',p_rejected);
end $$;

-- A full national availability import exceeds the default API statement timeout.
-- Scope the background allowance to this protected RPC; app queries stay bounded.
alter function public.import_fuel_e85_source(text,uuid,jsonb,integer,text) set statement_timeout='60s';
alter function public.import_fuel_e85_source(text,uuid,jsonb,integer,text) set lock_timeout='5s';
notify pgrst,'reload schema';
-- Normalize successful bootstrap refreshes; retain any later failure backoff.
update public.fuel_e85_sources set next_refresh_at=date_trunc('day',now(),'UTC')+interval '1 day'
where last_success_at is not null and (last_error_at is null or last_success_at>last_error_at) and lease_token is null;
