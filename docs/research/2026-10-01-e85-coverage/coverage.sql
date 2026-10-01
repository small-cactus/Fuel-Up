with station_flags as materialized (
 select l.station_id,l.station->>'name' name,l.station#>>'{address,region}' state,l.station#>>'{address,line1}' address,
  bool_or(p.fuel_product='e85') has_e85_price,
  bool_or(p.fuel_product='e85' and p.reported_at between now()-interval '24 hours' and now()) fresh_e85,
  bool_or(p.fuel_product='regular_gas' and p.reported_at between now()-interval '24 hours' and now()) fresh_regular,
  max(p.reported_at) filter(where p.fuel_product='e85') last_e85,
  min(p.price) filter(where p.fuel_product='e85') e85_price,
  (l.latitude between 27.8 and 28.2 and l.longitude between -82.85 and -82.6) clearwater_area
 from public.fuel_station_latest l left join public.fuel_station_price_lookup p on p.station_id=l.station_id
 group by l.station_id
), summaries as (
 select scope,count(*) inventory,count(*) filter(where has_e85_price) with_e85_price,
 count(*) filter(where fresh_e85) with_fresh_e85,
 count(*) filter(where has_e85_price and not fresh_e85) stale_e85,
 count(*) filter(where fresh_regular and has_e85_price) regular_fresh_e85_known,
 count(*) filter(where fresh_regular and fresh_e85) regular_fresh_e85_fresh
 from station_flags cross join lateral (select 'US' scope union all select 'FL' where state='FL' union all select 'Clearwater bounding box' where clearwater_area) scopes group by scope
)
select jsonb_build_object('as_of',now(),'coverage',(select jsonb_agg(s) from summaries s),
 'local_e85_examples',(select jsonb_agg(s) from (select station_id,name,address,e85_price,last_e85,fresh_e85,fresh_regular from station_flags where clearwater_area and has_e85_price order by last_e85 desc limit 30) s)) as analysis;
