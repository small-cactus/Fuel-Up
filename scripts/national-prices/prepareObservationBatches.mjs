// One-time bounded membership attachment from existing successful observations.
// Does not fetch prices, replay provider calls, or change observed/reported times.
import { execFileSync } from 'node:child_process';
const query = sql => JSON.parse(execFileSync('npx',['--no-install','supabase@2.118.0','db','query','--linked','--project-ref','vjindchxfebaltbslqwc',sql,'--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000})).rows;
const batches=query('select b.catalog_id,b.ordinal from fuel_national_batches b join fuel_national_config c on c.catalog_id=b.catalog_id order by b.ordinal');
let attached=0;
for(let offset=0;offset<batches.length;offset+=4){
 const group=batches.slice(offset,offset+4);
 for(const batch of group) if(!/^[a-f0-9-]{36}$/.test(batch.catalog_id)||!Number.isInteger(batch.ordinal))throw Error('Invalid batch identity');
 const values=group.map(b=>`('${b.catalog_id}'::uuid,${b.ordinal})`).join(',');
 const rows=query(`begin; set local lock_timeout='3s'; set local statement_timeout='15s'; select sum(attach_fuel_station_observation_batch(catalog_id,ordinal)) as attached from (values ${values}) as batches(catalog_id,ordinal); commit;`);
 const count=rows.find(row=>Object.hasOwn(row,'attached'))?.attached;
 if(!Number.isFinite(Number(count))||count===undefined)throw Error('Missing attachment result');
 attached+=Number(count);
 console.log(JSON.stringify({throughOrdinal:group.at(-1).ordinal,attached}));
}
console.log(JSON.stringify({complete:true,batches:batches.length,attached,providerRequests:0}));
