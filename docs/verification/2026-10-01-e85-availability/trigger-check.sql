BEGIN;
DO $$
DECLARE result jsonb;
BEGIN
 INSERT INTO fuel_station_latest(station_id,latitude,longitude,station,observed_at)
 VALUES('qa-e85-availability',0,0,'{"id":"qa-e85-availability","prices":[{"fuelProduct":"e85","cash":null,"credit":null}]}',now());
 IF NOT EXISTS(SELECT 1 FROM fuel_station_latest WHERE station_id='qa-e85-availability' AND e85_listed_at IS NOT NULL) THEN RAISE EXCEPTION 'Unpriced E85 listing lost'; END IF;
 UPDATE fuel_station_latest SET station='{"id":"qa-e85-availability","prices":[]}' WHERE station_id='qa-e85-availability';
 IF NOT EXISTS(SELECT 1 FROM fuel_station_latest WHERE station_id='qa-e85-availability' AND e85_listed_at IS NOT NULL) THEN RAISE EXCEPTION 'Missing hourly quote erased E85 availability'; END IF;
 result:=nearby_fuel_station_cache(0,0,1);
 IF result#>>'{0,station,offersE85}' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'RPC lost E85 flag'; END IF;
 IF has_table_privilege('anon','fuel_station_latest','SELECT') THEN RAISE EXCEPTION 'Raw table exposed'; END IF;
END $$;
SELECT jsonb_build_object('availability_stations',(select count(*) from fuel_station_latest where e85_listed_at is not null),'trigger_checks','passed','raw_table_private',true) verification;
ROLLBACK;
