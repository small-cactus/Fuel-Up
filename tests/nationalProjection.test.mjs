import test from 'node:test';
import assert from 'node:assert/strict';
import {optionalMetadata,publishArchivedProjection} from '../supabase/functions/_shared/nationalPriceProjection.mjs';

for (const stage of ['metadata','serving']) test(`${stage} hanging RPC aborts before the research lease expires`,async()=>{
 let signal;const events=[];
 const db={rpc(name,args){
  if(name==='record_fuel_national_projection_event'){events.push(args);return Promise.resolve({data:true});}
  return {abortSignal(value){signal=value;return new Promise(()=>{});}};
 }};
 const job={id:1,lease_token:'lease',station_ids:['1']};
 const result=stage==='metadata'?await optionalMetadata(db,job,5):await publishArchivedProjection(db,job,[],5);
 assert.equal(result,stage==='metadata'?false:'pending');assert.equal(signal.aborted,true);
 assert.equal(events.length,1);assert.match(events[0].p_code,/CLIENT_TIMEOUT$/);
});
