import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { verifiedProjection, repairNationalProjection, createProjectionRepairHandler } from '../supabase/functions/_shared/nationalProjectionRepair.mjs';

function fixture(change={}) {
  const snapshot={version:1,provider:'gasbuddy',executionRegion:'us-east-1',startedAt:'2026-10-04T22:01:00Z',observedAt:'2026-10-04T22:01:01Z',stations:[{id:'1',prices:[{fuelProduct:'regular_gas',credit:{price:3.25,postedTime:'2026-10-04T21:00:00Z'}}]}],...change};
  const bytes=gzipSync(JSON.stringify(snapshot));
  const job={id:7,run_id:5,repair_token:'lease',object_path:'5/7/a.gz',sha256:createHash('sha256').update(bytes).digest('hex'),archive_bytes:bytes.length,station_ids:['1'],execution_region:'us-east-1',assigned_region:'us-east-1',started_at:'2026-10-04T22:01:00Z',observed_at:'2026-10-04T22:01:01Z',slot_at:'2026-10-04T22:00:00Z',deadline_at:'2026-10-04T23:00:00Z',priced_count:1};
  return {snapshot,bytes,job};
}
test('replay preserves original prices and timestamps',async()=>{
  const f=fixture();assert.deepEqual(await verifiedProjection(f.bytes,f.job),f.snapshot.stations);
});
test('corrupt or swapped archive is rejected before publishing',async()=>{
  const f=fixture();await assert.rejects(()=>verifiedProjection(f.bytes,{...f.job,sha256:'0'.repeat(64)}),/HASH/);
  await assert.rejects(()=>verifiedProjection(f.bytes,{...f.job,assigned_region:'us-west-1'}),/REGION/);
  await assert.rejects(()=>verifiedProjection(f.bytes,{...f.job,station_ids:['2']}),/mismatched/);
  await assert.rejects(()=>verifiedProjection(f.bytes,{...f.job,deadline_at:'2026-10-04T22:00:30Z'}),/TIME/);
  await assert.rejects(()=>verifiedProjection(f.bytes,{...f.job,priced_count:0}),/COUNT/);
});
test('only Storage and serving RPCs are used; original research job is never recollected',async()=>{
  const f=fixture(),calls=[];
  const db={rpc(name,args){calls.push([name,args]);if(name==='claim_fuel_projection_repair')return Promise.resolve({data:f.job});if(name==='publish_fuel_station_batch')return {abortSignal:()=>Promise.resolve({data:1})};if(name==='finish_fuel_projection_repair')return Promise.resolve({data:true});throw Error('Unexpected provider or research write');},storage:{from(bucket){assert.equal(bucket,'fuel-national');return {download:async path=>{assert.equal(path,f.job.object_path);return {data:new Blob([f.bytes])};}};}}};
  const result=await repairNationalProjection({db});assert.equal(result.status,'published');assert.equal(result.providerRequests,0);
  assert.deepEqual(calls.map(c=>c[0]),['claim_fuel_projection_repair','publish_fuel_station_batch','finish_fuel_projection_repair']);
  assert.deepEqual(calls[1][1].p_stations,f.snapshot.stations);
});
test('failed archive verification records a bounded retry, never publishes',async()=>{
  const f=fixture(),calls=[];const db={rpc:async(name,args)=>{calls.push([name,args]);return {data:name==='claim_fuel_projection_repair'?f.job:true};},storage:{from:()=>({download:async()=>({data:new Blob(['bad'])})})}};
  const r=await repairNationalProjection({db});assert.equal(r.status,'retry_pending');assert.equal(r.error,'ARCHIVE_HASH_MISMATCH');
  assert.deepEqual(calls.map(c=>c[0]),['claim_fuel_projection_repair','finish_fuel_projection_repair']);
});
test('public app credentials cannot start repair',async()=>{
  let called=false;const handler=createProjectionRepairHandler({secret:'server-only-secret',repair:async()=>{called=true;}});
  const r=await handler(new Request('https://example.test',{method:'POST'}));assert.equal(r.status,401);assert.equal(called,false);
});
