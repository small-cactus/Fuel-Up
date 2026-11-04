-- Run after the migration in a rollback-only transaction before enabling sends.
-- All subscriptions, quotes and APNs addresses below are synthetic fixtures.
do $$ begin
 if exists(select from fuel_app_private.price_watches) then raise exception 'Use an isolated database for this test'; end if;
end $$;
create table fuel_app_private.fixture_alert_quotes(station_id text,product text,payment text,price numeric,reported_at timestamptz,name text);
create or replace view fuel_app_private.watched_current_prices as select * from fuel_app_private.fixture_alert_quotes;
do $$
declare uid uuid:=gen_random_uuid(); ids text[]; result jsonb; day_zone text;
begin
 select array_agg(station_id) into ids from (select station_id from public.fuel_station_latest limit 2)s;
 select name into day_zone from pg_timezone_names where extract(hour from now() at time zone name)=12 limit 1;
 perform public.register_installation_push(uid,repeat('a',64),encode(sha256(convert_to(uid::text,'UTF8')),'hex'),'sandbox');
 if fuel_app_private.claim_price_alert() is not null then raise exception 'Silent registration enrolled'; end if;
 begin
   perform public.set_installation_price_watch(uid,repeat('b',64),ids,'regular_gas',day_zone);
   raise exception 'Bad credentials accepted';
 exception when raise_exception then if sqlerrm<>'unauthorized' then raise; end if; end;
 perform public.set_installation_price_watch(uid,repeat('a',64),ids,'regular_gas',day_zone);
 update fuel_app_private.price_watches set started_at=now()-interval '4 hours' where installation_id=uid;
 insert into fuel_app_private.fixture_alert_quotes values(ids[1],'regular_gas','credit',4.00,now()-interval '3 hours','Example');
 perform fuel_app_private.sample_prices();
 if fuel_app_private.claim_price_alert() is not null then raise exception 'First observation sent'; end if;
 update fuel_app_private.fixture_alert_quotes set price=3.89,reported_at=now()-interval '10 minutes';
 if fuel_app_private.claim_price_alert() is not null then raise exception 'Small drop sent'; end if;
 update fuel_app_private.fixture_alert_quotes set price=3.80,payment='cash';
 if fuel_app_private.claim_price_alert() is not null then raise exception 'Cross-payment comparison'; end if;
 update fuel_app_private.fixture_alert_quotes set payment='credit';
 insert into fuel_app_private.fixture_alert_quotes values(ids[2],'regular_gas','credit',3.50,now(),'Cheaper');
 if fuel_app_private.claim_price_alert() is not null then raise exception 'Expensive option sent'; end if;
 delete from fuel_app_private.fixture_alert_quotes where station_id=ids[2];
 update fuel_app_private.price_watches set zone=(select name from pg_timezone_names where extract(hour from now() at time zone name)=2 limit 1);
 if fuel_app_private.claim_price_alert() is not null then raise exception 'Overnight alert'; end if;
 update fuel_app_private.price_watches set zone=day_zone where installation_id=uid;
 result:=fuel_app_private.claim_price_alert();
 if result->>'stationId' is distinct from ids[1] or (result->>'price')::numeric<>3.80 then raise exception 'Eligible alert missing'; end if;
 if fuel_app_private.claim_price_alert() is not null then raise exception 'Duplicate claim'; end if;
 update fuel_app_private.fixture_alert_quotes set price=3.60,reported_at=now();
 if fuel_app_private.claim_price_alert() is not null then raise exception 'Cooldown bypassed'; end if;
 perform public.set_installation_price_watch(uid,repeat('a',64),'{}','regular_gas',day_zone);
 if exists(select from fuel_app_private.price_watches where installation_id=uid) then raise exception 'Opt out failed'; end if;
end $$;
