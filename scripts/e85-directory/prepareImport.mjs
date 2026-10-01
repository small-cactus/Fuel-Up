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
SELECT pg_advisory_xact_lock(hashtext('fuel-e85-directory'));
UPDATE fuel_e85_directory SET active=false WHERE source='afdc';
INSERT INTO fuel_e85_directory(source_id,name,street,city,state,postal_code,latitude,longitude,confirmed_at,source_updated_at,fetched_at,access_hours)
SELECT source_id,name,street,city,state,postal_code,latitude,longitude,confirmed_at,source_updated_at,fetched_at,access_hours
FROM jsonb_populate_recordset(null::fuel_e85_directory,'${literal}'::jsonb)
ON CONFLICT(source_id) DO UPDATE SET name=excluded.name,street=excluded.street,city=excluded.city,state=excluded.state,
 postal_code=excluded.postal_code,latitude=excluded.latitude,longitude=excluded.longitude,confirmed_at=excluded.confirmed_at,
 source_updated_at=excluded.source_updated_at,fetched_at=excluded.fetched_at,access_hours=excluded.access_hours,active=true,
 matched_station_id=null,match_rule=null;
SELECT public.reconcile_fuel_e85_directory();
COMMIT;
SELECT count(*) FILTER(WHERE active) active,count(*) FILTER(WHERE active AND matched_station_id IS NOT NULL) matched,
 count(*) FILTER(WHERE active AND matched_station_id IS NULL) standalone FROM fuel_e85_directory;
`);
console.log(JSON.stringify({sourceCount:raw.total_results,publicUnrestricted:rows.length,florida:rows.filter(r=>r.state==='FL').length,sqlPath:output}));
