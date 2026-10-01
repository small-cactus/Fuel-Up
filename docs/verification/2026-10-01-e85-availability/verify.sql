select jsonb_build_object('now',now(),
 'e85_listed',(select count(*) from fuel_station_latest where e85_listed_at is not null),
 'e85_fresh_price',(select count(distinct station_id) from fuel_station_price_lookup where fuel_product='e85' and reported_at between now()-interval '24 hours' and now()),
 'regular_eligible',(select count(distinct l.station_id) from fuel_station_latest l join fuel_station_price_lookup p using(station_id) where l.e85_listed_at is not null and p.fuel_product='regular_gas' and p.reported_at between now()-interval '24 hours' and now()),
 'fl_listed',(select count(*) from fuel_station_latest where e85_listed_at is not null and station#>>'{address,region}'='FL'),
 'local_listed',(select count(*) from fuel_station_latest where e85_listed_at is not null and latitude between 27.8 and 28.2 and longitude between -82.85 and -82.6),
 'raw_table_private',not has_table_privilege('anon','fuel_station_latest','SELECT'),
 'latest_runs',(select jsonb_agg(r) from (select id,status,succeeded_batches,expected_batches,slot_at from fuel_national_health order by slot_at desc limit 2) r),
 'cache_versions',(select jsonb_agg(r) from (select run_id,e85_availability_version,count(*) scopes from fuel_national_trends_cache group by 1,2) r)) verification;
