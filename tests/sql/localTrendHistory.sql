do $$
declare j fuel_national_jobs; ids text[]; payload jsonb; h jsonb; sid text; lat double precision; lng double precision; n integer;
begin
 select jobs.* into j from fuel_national_jobs jobs join fuel_national_runs r on r.id=jobs.run_id
 where r.status='complete' and r.slot_at>now()-interval '24 hours' order by jobs.id desc limit 1;
 select station_ids into ids from fuel_national_batches where catalog_id=j.catalog_id and ordinal=j.ordinal;
 select station_id,latitude,longitude into sid,lat,lng from fuel_station_latest
 where station_id=any(ids) and latitude is not null and longitude is not null limit 1;
 select jsonb_agg(jsonb_build_object('id',id,'prices',case when id=sid then jsonb_build_array(
  jsonb_build_object('fuelProduct','regular_gas','credit',jsonb_build_object('price',3.5,'postedTime',j.observed_at),'cash',jsonb_build_object('price',2,'postedTime',j.observed_at)),
  jsonb_build_object('fuelProduct','premium_gas','credit',jsonb_build_object('price',3.5,'postedTime',j.observed_at)),
  jsonb_build_object('fuelProduct','diesel','credit',jsonb_build_object('price',1,'postedTime',j.observed_at-interval '25 hours'),'cash',jsonb_build_object('price',4,'postedTime',j.observed_at)),
  jsonb_build_object('fuelProduct','e85','credit',jsonb_build_object('price',1,'postedTime',j.observed_at+interval '1 hour'))
 ) else '[]'::jsonb end) order by ord) into payload from unnest(ids) with ordinality t(id,ord);
 n:=record_fuel_local_daily_prices(j.id,payload);
 if n<>1 then raise exception 'Wrong insertion count: %',n; end if;
 select prices into h from fuel_local_daily_prices where station_id=sid;
 if (h->'regular_gas'->>'price')::numeric<>3.5 or (h->'diesel'->>'price')::numeric<>4 or h ? 'premium_gas' or h ? 'e85' then raise exception 'Price policy failed: %',h; end if;
 if record_fuel_local_daily_prices(j.id,payload)<>0 then raise exception 'Replay duplicated data'; end if;
 h:=local_fuel_trend_rows(lat,lng,1,'regular');
 if jsonb_array_length(h)<>1 or (h->0->>'price')::numeric<>3.5 or h->0->>'station_id'<>sid then raise exception 'Exact-area read failed: %',h; end if;
 if local_fuel_trend_rows(0,0,1,'regular')<>'[]'::jsonb then raise exception 'Distant stations leaked'; end if;
 -- A succeeded batch within an incomplete sweep must never appear as history.
 update fuel_national_runs set status='partial' where id=j.run_id;
 if local_fuel_trend_rows(lat,lng,1,'regular')<>'[]'::jsonb then raise exception 'Incomplete sweep leaked'; end if;
 update fuel_national_runs set status='complete' where id=j.run_id;
 begin
  perform record_fuel_local_daily_prices(j.id,'[]'::jsonb);
  raise exception 'Accepted wrong manifest';
 exception when others then
  if sqlerrm<>'Local history coverage mismatch' then raise; end if;
 end;
 insert into fuel_local_daily_prices values('__retention_fixture',current_date-9,j.id,'{}');
 if prune_fuel_local_daily_prices()<>1 or not exists(select 1 from fuel_local_daily_prices where station_id=sid) then raise exception 'Bounded retention failed'; end if;
 if has_function_privilege('anon','public.local_fuel_trend_rows(double precision,double precision,double precision,text)','execute') then raise exception 'Private RPC public'; end if;
end $$;

-- Full-size batch performance and publication integration (all rolled back).
do $$
declare j fuel_national_jobs; payload jsonb; started timestamptz; elapsed double precision;
begin
 select jobs.* into j from fuel_national_jobs jobs join fuel_national_runs r on r.id=jobs.run_id
 where r.status='complete' and r.slot_at>now()-interval '24 hours' order by jobs.id desc limit 1;
 select jsonb_agg(jsonb_build_object('id',id,'prices',jsonb_build_array(
  jsonb_build_object('fuelProduct','regular_gas','credit',jsonb_build_object('price',3,'postedTime',j.observed_at)),
  jsonb_build_object('fuelProduct','midgrade_gas','credit',jsonb_build_object('price',4,'postedTime',j.observed_at)),
  jsonb_build_object('fuelProduct','premium_gas','credit',jsonb_build_object('price',5,'postedTime',j.observed_at)),
  jsonb_build_object('fuelProduct','diesel','credit',jsonb_build_object('price',4,'postedTime',j.observed_at)),
  jsonb_build_object('fuelProduct','e85','credit',jsonb_build_object('price',2,'postedTime',j.observed_at))
 )) order by ord) into payload from fuel_national_batches b cross join lateral unnest(b.station_ids) with ordinality t(id,ord)
 where b.catalog_id=j.catalog_id and b.ordinal=j.ordinal;
 started:=clock_timestamp();
 perform record_fuel_local_daily_prices(j.id,payload);
 elapsed:=extract(epoch from clock_timestamp()-started);
 raise notice 'Full batch local projection seconds: %',elapsed;
 if elapsed>2 then raise exception 'Local projection too slow: %',elapsed; end if;
 if (select count(*) from fuel_local_daily_prices)<100 then raise exception 'Missing full batch history'; end if;
end $$;
