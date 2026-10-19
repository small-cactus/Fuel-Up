-- Compare the optimized query to the independent original great-circle filter.
-- Dense latitude bands include many far-away stations, dateline wrap and poles.
insert into fuel_station_latest(station_id,latitude,longitude,station,observed_at)
select 'geo-'||g,lat,lon,jsonb_build_object('id','geo-'||g,'name','Geographic fixture','prices','[]'::jsonb),now()
from (select g,(case g%7 when 0 then 0 when 1 then 27.9 when 2 then 34.0 when 3 then 47.6 when 4 then 65 when 5 then 89.5 else -89.5 end)+(g%13-6)*0.05 lat,
 (g%3600)/10.0-180 lon from generate_series(1,8000)g)t;
-- Explicit points on each side of the dateline, and at both poles.
insert into fuel_station_latest(station_id,latitude,longitude,station,observed_at)
select id,lat,lon,jsonb_build_object('id',id,'prices','[]'::jsonb),now() from (values
 ('geo-date-east',65.0,179.99),('geo-date-west',65.0,-179.99),
 ('geo-north',90.0,0.0),('geo-south',-90.0,0.0))t(id,lat,lon);
do $$declare c record; radius double precision; original jsonb; optimized jsonb;
begin
 for c in select * from (values (0.0,0.0),(27.9,-82.8),(34.0,-118.2),(47.6,-122.3),(65.0,180.0),(65.0,-180.0),(89.5,179.0),(-89.5,-179.0),(90.0,120.0),(-90.0,-120.0))p(lat,lon) loop
  foreach radius in array array[1.0,5.0,100.0] loop
   original:=wide_nearby_fuel_station_cache(c.lat,c.lon,radius);
   optimized:=nearby_fuel_station_cache(c.lat,c.lon,radius);
   perform test_assert(original=optimized,'Geographic bounds changed exact nearby result');
  end loop;
 end loop;
 perform test_assert(jsonb_array_length(nearby_fuel_station_cache(65,180,1))>=2,'Dateline fixtures not covered');
end $$;
select jsonb_build_object('passed',true,'tests','30 exact nearby-result comparisons, multiple radii, dateline both directions, pole-crossing circles, exact poles');
