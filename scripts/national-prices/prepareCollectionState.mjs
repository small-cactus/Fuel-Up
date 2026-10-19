// One-time bounded compact-state preparation from current station values.
// Does not fetch prices, replay provider calls, or change observed/reported times.
import { execFileSync } from 'node:child_process';
const query = sql => JSON.parse(execFileSync('npx',['--no-install','supabase@2.118.0','db','query','--linked','--project-ref','vjindchxfebaltbslqwc',sql,'--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000})).rows;
const batches=query('select b.catalog_id,b.ordinal from fuel_national_batches b join fuel_national_config c on c.catalog_id=b.catalog_id order by b.ordinal');
let prepared=0;
for(let offset=0;offset<batches.length;offset+=4){
 const group=batches.slice(offset,offset+4);
 for(const batch of group) if(!/^[a-f0-9-]{36}$/.test(batch.catalog_id)||!Number.isInteger(batch.ordinal))throw Error('Invalid batch identity');
 const values=group.map(b=>`('${b.catalog_id}'::uuid,${b.ordinal})`).join(',');
 const rows=query(`begin; set local lock_timeout='3s'; set local statement_timeout='15s'; select sum(prepare_fuel_station_collection_state(catalog_id,ordinal)) as prepared from (values ${values}) as batches(catalog_id,ordinal); commit;`);
 const count=rows.find(row=>Object.hasOwn(row,'prepared'))?.prepared;
 if(!Number.isFinite(Number(count))||count===undefined)throw Error('Missing attachment result');
 prepared+=Number(count);
 console.log(JSON.stringify({throughOrdinal:group.at(-1).ordinal,prepared}));
}
const coverage=query(`select count(*) as stations,count(*) filter(where c.station_id is null) as missing from fuel_station_latest l
 join fuel_national_config cfg on cfg.catalog_id=l.observation_catalog_id
 left join fuel_station_collection_state c using(station_id)`)[0];
if(Number(coverage?.missing)!==0)throw Error('Compact preparation left active stations uncovered');
console.log(JSON.stringify({complete:true,batches:batches.length,prepared,coverage,providerRequests:0}));
