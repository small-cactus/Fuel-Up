select jsonb_build_object('local_brands',(select jsonb_agg(x) from (select station->>'name' name,count(*) stations,
 count(*) filter(where exists(select 1 from jsonb_array_elements(station->'prices') p where p->>'fuelProduct'='e85')) e85_entry,
 count(*) filter(where exists(select 1 from jsonb_array_elements(station->'prices') p where p->>'fuelProduct'='e85' and (coalesce((p#>>'{credit,price}')::numeric,0)>0 or coalesce((p#>>'{cash,price}')::numeric,0)>0))) e85_positive_price
 from fuel_station_latest where latitude between 27.8 and 28.2 and longitude between -82.85 and -82.6
 and (station->>'name' ilike '%Wawa%' or station->>'name' ilike '%RaceTrac%') group by station->>'name') x),
 'example',(select station from fuel_station_latest where latitude between 27.8 and 28.2 and longitude between -82.85 and -82.6 and station->>'name'='Wawa' limit 1)) as analysis;
