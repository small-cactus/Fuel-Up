begin;
-- Fixtures are invisible outside this transaction and always rolled back.
insert into fuel_station_latest(station_id,latitude,longitude,station,observed_at)
select 'leaderboard-test-'||i,40,-100,jsonb_build_object('id','leaderboard-test-'||i,'latitude',40,'longitude',-100,'name','Fixture',
 'prices',jsonb_build_array(jsonb_build_object('fuelProduct','regular_gas','credit',jsonb_build_object('price',i*0.001,'postedTime',now()-interval '1 hour')))),now()
from generate_series(1,7) i;
-- A cheaper expired report must lose to fresh reports; cash must not outrank fresh credit.
update fuel_station_latest set station=jsonb_set(station,'{prices,0,credit,postedTime}',to_jsonb(now()-interval '25 hours')) where station_id='leaderboard-test-1';
update fuel_station_latest set station=jsonb_set(station,'{prices,0,cash}',jsonb_build_object('price',0.00001,'postedTime',now())) where station_id='leaderboard-test-7';
do $$
declare ids text[]; q jsonb;
begin
 select array_agg(r->'station'->>'id') into ids from jsonb_array_elements(national_fuel_station_cache('regular',false)) r;
 if ids<>array['leaderboard-test-2','leaderboard-test-3','leaderboard-test-4','leaderboard-test-5','leaderboard-test-6'] then raise exception 'Wrong ranking: %',ids; end if;
 if fuel_fresh_payment('{"credit":{"price":1,"postedTime":"bad"}}',now()) is not null then raise exception 'Invalid time accepted'; end if;
 if fuel_fresh_payment(jsonb_build_object('credit',jsonb_build_object('price',1,'postedTime',now()+interval '1 hour')),now()) is not null then raise exception 'Future time accepted'; end if;
 if fuel_fresh_payment(jsonb_build_object('credit',jsonb_build_object('price',1,'postedTime',now()-interval '24 hours')),now()) is null then raise exception 'Cutoff excluded'; end if;
 if has_function_privilege('anon','national_fuel_station_cache(text,boolean)','execute') then raise exception 'RPC exposed'; end if;
end $$;
-- Removing/replacing a price must immediately update the index.
update fuel_station_latest set station=jsonb_set(station,'{prices,0,credit,price}','0'::jsonb) where station_id='leaderboard-test-2';
update fuel_station_latest set station=jsonb_set(station,'{prices,0,credit,postedTime}',to_jsonb(now()-interval '25 hours')) where station_id='leaderboard-test-7';
do $$
declare ids text[];
begin
 if exists(select 1 from fuel_station_price_lookup where station_id='leaderboard-test-2') then raise exception 'Deleted quote remains indexed'; end if;
 select array_agg(r->'station'->>'id') into ids from jsonb_array_elements(national_fuel_station_cache('regular',false)) r;
 if ids<>array['leaderboard-test-7','leaderboard-test-3','leaderboard-test-4','leaderboard-test-5','leaderboard-test-6'] then raise exception 'Fresh cash fallback/ranking failed: %',ids; end if;
end $$;
-- Duplicate gasoline grades are excluded, while independently priced premium and E85 remain eligible.
update fuel_station_latest set station=jsonb_set(station,'{prices}',(station->'prices')||jsonb_build_array(
 jsonb_build_object('fuelProduct','premium_gas','credit',jsonb_build_object('price',0.003,'postedTime',now())),
 jsonb_build_object('fuelProduct','e85','credit',jsonb_build_object('price',0.002,'postedTime',now())))) where station_id='leaderboard-test-3';
update fuel_station_latest set station=jsonb_set(station,'{prices}',(station->'prices')||jsonb_build_array(
 jsonb_build_object('fuelProduct','premium_gas','credit',jsonb_build_object('price',0.006,'postedTime',now())))) where station_id='leaderboard-test-4';
do $$
begin
 if national_fuel_station_cache('regular',true)->0->'station'->>'id'<>'leaderboard-test-3' then raise exception 'E85 restriction failed'; end if;
 if national_fuel_station_cache('premium',false)->0->'station'->>'id'<>'leaderboard-test-4' then raise exception 'Duplicate grade policy failed'; end if;
end $$;
rollback;
