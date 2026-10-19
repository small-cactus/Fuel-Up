// One-time bounded membership attachment from existing successful observations.
// Does not fetch prices, replay provider calls, or change observed/reported times.
import { execFileSync } from 'node:child_process';
const query = sql => JSON.parse(execFileSync('npx',['--no-install','supabase@2.118.0','db','query','--linked','--project-ref','vjindchxfebaltbslqwc',sql,'--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000})).rows;
const batches=query('select b.catalog_id,b.ordinal from fuel_national_batches b join fuel_national_config c on c.catalog_id=b.catalog_id order by b.ordinal');
let attached=0;
for(const batch of batches){
 if(!/^[a-f0-9-]{36}$/.test(batch.catalog_id)||!Number.isInteger(batch.ordinal))throw Error('Invalid batch identity');
 const rows=query(`begin; set local lock_timeout='3s'; set local statement_timeout='15s'; select attach_fuel_station_observation_batch('${batch.catalog_id}'::uuid,${batch.ordinal}) as attached; commit;`);
 attached+=Number(rows.find(row=>Object.hasOwn(row,'attached'))?.attached||0);
 console.log(JSON.stringify({ordinal:batch.ordinal,attached}));
}
console.log(JSON.stringify({complete:true,batches:batches.length,attached,providerRequests:0}));
