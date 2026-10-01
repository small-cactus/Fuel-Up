// Run with a downloaded AFDC All Stations JSON snapshot and an output SQL path.
// No network or credentials. Review/apply the transaction with the protected DB CLI.
import { readFileSync, writeFileSync } from 'node:fs';
const [input, output] = process.argv.slice(2);
if (!input || !output) throw Error('Usage: prepareImport.mjs source.json output.sql');
const raw = JSON.parse(readFileSync(input));
if (!Array.isArray(raw.fuel_stations) || raw.total_results !== raw.fuel_stations.length || raw.total_results < 1000) throw Error('Incomplete nationwide AFDC snapshot');
const now = new Date().toISOString();
const rows = raw.fuel_stations.filter(s => s.country === 'US' && s.fuel_type_code === 'E85' &&
 s.status_code === 'E' && s.access_code === 'public' && s.restricted_access !== true && [null, 'CREDIT_CARD_ALWAYS', 'CREDIT_CARD_AFTER_HOURS'].includes(s.access_detail_code))
 .map(s => {
  if (!s.id || !s.station_name || !s.street_address || !Number.isFinite(s.latitude) || !Number.isFinite(s.longitude)) throw Error('Invalid station');
  return { source_id: String(s.id), name:s.station_name,street:s.street_address,city:s.city,state:s.state,
   postal_code:s.zip,latitude:s.latitude,longitude:s.longitude,confirmed_at:s.date_last_confirmed,
   source_updated_at:s.updated_at,fetched_at:now,access_hours:s.access_days_time };
 });
if (new Set(rows.map(r=>r.source_id)).size !== rows.length) throw Error('Duplicate AFDC IDs');
const literal = JSON.stringify(rows).replaceAll("'", "''");
writeFileSync(output, `BEGIN;
SET LOCAL lock_timeout='5s';
UPDATE fuel_e85_directory SET active=false;
INSERT INTO fuel_e85_directory(source_id,name,street,city,state,postal_code,latitude,longitude,confirmed_at,source_updated_at,fetched_at,access_hours)
SELECT source_id,name,street,city,state,postal_code,latitude,longitude,confirmed_at,source_updated_at,fetched_at,access_hours
FROM jsonb_populate_recordset(null::fuel_e85_directory,'${literal}'::jsonb)
ON CONFLICT(source_id) DO UPDATE SET name=excluded.name,street=excluded.street,city=excluded.city,state=excluded.state,
 postal_code=excluded.postal_code,latitude=excluded.latitude,longitude=excluded.longitude,confirmed_at=excluded.confirmed_at,
 source_updated_at=excluded.source_updated_at,fetched_at=excluded.fetched_at,access_hours=excluded.access_hours,active=true,
 matched_station_id=null,match_rule=null;
CREATE FUNCTION pg_temp.e85_address_key(address text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT string_agg(CASE word WHEN 'street' THEN 'st' WHEN 'avenue' THEN 'ave' WHEN 'boulevard' THEN 'blvd'
 WHEN 'road' THEN 'rd' WHEN 'drive' THEN 'dr' WHEN 'highway' THEN 'hwy' WHEN 'parkway' THEN 'pkwy'
 WHEN 'lane' THEN 'ln' WHEN 'court' THEN 'ct' WHEN 'north' THEN 'n' WHEN 'south' THEN 's'
 WHEN 'east' THEN 'e' WHEN 'west' THEN 'w' ELSE word END,'' ORDER BY ord)
 FROM unnest(regexp_split_to_array(lower(address),'[^a-z0-9]+')) WITH ORDINALITY a(word,ord)
$$;
-- Match only an unambiguous address at the same site. Distance alone can confuse
-- opposing corners. Direction letters and road numbers remain in the key.
WITH matches AS (
 SELECT d.source_id,l.station_id,count(*) OVER(PARTITION BY d.source_id) candidates
 FROM fuel_e85_directory d JOIN fuel_station_latest l
 ON l.latitude BETWEEN d.latitude-0.002 AND d.latitude+0.002
 AND l.longitude BETWEEN d.longitude-0.004 AND d.longitude+0.004
 AND pg_temp.e85_address_key(l.station#>>'{address,line1}') = pg_temp.e85_address_key(d.street)
 WHERE d.active AND 2*6371000*asin(sqrt(least(1.0,power(sin(radians(l.latitude-d.latitude)/2),2)+cos(radians(d.latitude))*cos(radians(l.latitude))*power(sin(radians(l.longitude-d.longitude)/2),2)))) <= 200
)
UPDATE fuel_e85_directory d SET matched_station_id=m.station_id,match_rule='exact-address-within-200m'
FROM matches m WHERE m.source_id=d.source_id AND m.candidates=1;
-- Address aliases (US-19 vs US Highway 19) require matching brand + house
-- number within 150m. A unique same-brand location within 25m also handles
-- an address typo; ambiguous candidates remain separate, never borrow prices.
WITH matches AS (
 SELECT d.source_id,l.station_id,count(*) OVER(PARTITION BY d.source_id) candidates
 FROM fuel_e85_directory d JOIN fuel_station_latest l
 ON l.latitude BETWEEN d.latitude-0.0015 AND d.latitude+0.0015
 AND l.longitude BETWEEN d.longitude-0.003 AND d.longitude+0.003
 AND regexp_replace(lower(split_part(d.name,'#',1)),'[^a-z0-9]','','g') = regexp_replace(lower(l.station->>'name'),'[^a-z0-9]','','g')
 CROSS JOIN LATERAL (SELECT 2*6371000*asin(sqrt(least(1.0,power(sin(radians(l.latitude-d.latitude)/2),2)+cos(radians(d.latitude))*cos(radians(l.latitude))*power(sin(radians(l.longitude-d.longitude)/2),2)))) meters) distance
 WHERE d.active AND d.matched_station_id IS NULL AND (distance.meters<=25 OR
  (distance.meters<=150 AND substring(d.street from '^[0-9]+')=substring(l.station#>>'{address,line1}' from '^[0-9]+')))
)
UPDATE fuel_e85_directory d SET matched_station_id=m.station_id,match_rule='unique-brand-address-site'
FROM matches m WHERE m.source_id=d.source_id AND m.candidates=1;
COMMIT;
SELECT count(*) FILTER(WHERE active) active,count(*) FILTER(WHERE active AND matched_station_id IS NOT NULL) matched,
 count(*) FILTER(WHERE active AND matched_station_id IS NULL) standalone FROM fuel_e85_directory;
`);
console.log(JSON.stringify({sourceCount:raw.total_results,publicUnrestricted:rows.length,florida:rows.filter(r=>r.state==='FL').length,sqlPath:output}));
