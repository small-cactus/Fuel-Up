import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
const results=[];
for(let start=0;start<72;start+=4){
 const sql=`begin; set local statement_timeout='10s';
 select count(*) as checked,count(*) filter(where c.station_id is null or
 (c.metadata_complete,c.e85_listed,c.price_only_compatible,c.price_signature,c.observed_at,c.observation_catalog_id,c.observation_ordinal)
 is distinct from (l.metadata_observed_at is not null,l.e85_listed_at is not null,coalesce(l.station->'id'=to_jsonb(l.station_id),false),sha256(convert_to((l.station->'prices')::text,'UTF8')),l.observed_at,l.observation_catalog_id,l.observation_ordinal)) as mismatches
 from fuel_station_latest l join fuel_national_config cfg on cfg.catalog_id=l.observation_catalog_id left join fuel_station_collection_state c using(station_id)
 where l.observation_ordinal between ${start} and ${start+3}; commit;`;
 writeFileSync('/tmp/fuel-dedup/parity-part.sql',sql);
 execFileSync(process.execPath,['/tmp/fuel-db-repair/query.mjs','/tmp/fuel-dedup/parity-part.sql','/tmp/fuel-dedup/parity-part.json'],{stdio:'pipe',timeout:20000});
 const x=JSON.parse(readFileSync('/tmp/fuel-dedup/parity-part.json'));
 if(!x.ok)throw Error('Bounded compact parity failed');
 const v=x.data.rows[0];if(Number(v.mismatches)!==0)throw Error('Compact state mismatch');
 results.push({ordinalFrom:start,ordinalTo:start+3,...v});
 writeFileSync('/tmp/fuel-dedup/compact-prepared-bounded-parity.json',JSON.stringify({complete:start===68,checked:results.reduce((a,b)=>a+Number(b.checked),0),results},null,2)+'\n');
 console.log(JSON.stringify(results.at(-1)));
}
