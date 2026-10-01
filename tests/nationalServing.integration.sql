-- Run against the migrated DB; every fixture and projection write rolls back.
begin;
do $$
declare job fuel_national_jobs; ids text[]; payload jsonb; n integer; observed timestamptz;
begin
 select * into job from fuel_national_jobs where status='succeeded' order by observed_at desc limit 1;
 select station_ids into ids from fuel_national_batches where catalog_id=job.catalog_id and ordinal=job.ordinal;
 select jsonb_agg(jsonb_build_object('id',id,'prices','[]'::jsonb) order by ord) into payload from unnest(ids) with ordinality a(id,ord);
 perform publish_fuel_station_batch(job.id,payload);
 if exists(select 1 from fuel_station_latest where station_id=any(ids) and observed_at is null) then raise exception 'Unpublished station'; end if;
 if publish_fuel_station_batch(job.id,payload)<>0 then raise exception 'Same observation was overwritten'; end if;
 begin
   perform publish_fuel_station_batch(job.id,'[]');
   raise exception 'Accepted wrong IDs';
 exception when others then if sqlerrm='Accepted wrong IDs' then raise; end if; end;
 -- A later observation may remove all prices; older archives cannot restore them.
 update fuel_station_latest set observed_at=job.observed_at+interval '1 hour',station=jsonb_set(station,'{prices}','[]') where station_id=ids[1];
 perform publish_fuel_station_batch(job.id,payload);
 select observed_at into observed from fuel_station_latest where station_id=ids[1];
 if observed<>job.observed_at+interval '1 hour' then raise exception 'Older data overwrote newer'; end if;

 insert into fuel_station_latest(station_id,latitude,longitude,station,observed_at) values
 ('radius-test-inside',0,degrees(4.99/3958.7613),'{}',now()),
 ('radius-test-outside',0,degrees(5.01/3958.7613),'{}',now());
 select jsonb_array_length(nearby_fuel_station_cache(0,0,5)) into n;
 if n<>1 then raise exception 'Exact radius failed: %',n; end if;
 -- Check the default API row cap cannot silently truncate dense searches.
 insert into fuel_station_latest(station_id,latitude,longitude,station,observed_at)
 select 'density-test-'||i,0,0,'{}',now() from generate_series(1,1100)i;
 if jsonb_array_length(nearby_fuel_station_cache(0,0,5))<>1101 then raise exception 'Results truncated'; end if;
 if has_function_privilege('anon','public.nearby_fuel_station_cache(double precision,double precision,double precision)','execute') then raise exception 'Public RPC exposed'; end if;
end $$;
rollback;
