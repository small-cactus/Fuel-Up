import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createInstallationTelemetryHandler,validateInstallationBatch} from '../supabase/functions/_shared/installationTelemetry.mjs';
const fixture=()=>({installationId:randomUUID(),profile:{deviceModel:'fixture',screenWidthPoints:390},
 events:[{id:randomUUID(),kind:'onboarding_step',recordedAt:Date.now()/1000,payload:JSON.stringify({step:1,screen:'onboarding/1',sessionId:randomUUID()})}]});
test('installation batch preserves denied/not-determined states and causal timestamps',()=>{
 const body=fixture(); body.events.push({id:randomUUID(),kind:'permission_snapshot',recordedAt:Date.now()/1000,payload:{location:0,motion:2,notifications:1,precise:false,screen:'onboarding/1'}});
 const validated=validateInstallationBatch(body); assert.equal(validated.events[1].payload.location,0); assert.equal(validated.events[1].payload.precise,false);
 assert.equal(validated.events[0].recordedAt,body.events[0].recordedAt);
});
test('rejects unknown fields, raw locations, oversized values, future timestamps and duplicate IDs',()=>{
 for(const mutate of [b=>b.events[0].payload={latitude:27},b=>b.profile.advertisingId='x',b=>b.events[0].payload={screen:'x'.repeat(241)},b=>b.events[0].recordedAt+=1000,b=>b.events.push(b.events[0]),b=>b.events[0].payload={status:NaN}]) {
  const body=fixture(); mutate(body); assert.throws(()=>validateInstallationBatch(body));
 }
});
test('endpoint requires credential, hashes it, and returns only durable acknowledgments',async()=>{
 let called=0; const body=fixture(),token='1'.repeat(64);
 const handler=createInstallationTelemetryHandler({db:{rpc:async(name,args)=>{called++;assert.equal(name,'ingest_installation_telemetry');assert.notEqual(args.p_hash,token);assert.equal(args.p_hash.length,64);return {data:{ids:args.p_events.map(e=>e.id)}};}}});
 const request=(secret)=>new Request('https://fixture.invalid',{method:'POST',headers:{'x-installation-token':secret},body:JSON.stringify(body)});
 assert.equal((await handler(request('bad'))).status,401);assert.equal(called,0);
 const response=await handler(request(token));assert.equal(response.status,200);assert.deepEqual((await response.json()).ids,[body.events[0].id]);assert.equal(called,1);
});
test('denial, throttling and server errors never acknowledge data',async()=>{
 for(const [message,status] of [['unauthorized',401],['rate_limited',429],['internal',503]]) {
  const handler=createInstallationTelemetryHandler({db:{rpc:async()=>({error:{message}})}});
  const response=await handler(new Request('https://fixture.invalid',{method:'POST',headers:{'x-installation-token':'1'.repeat(64)},body:JSON.stringify(fixture())}));
  assert.equal(response.status,status);assert.equal((await response.json()).ids,undefined);
 }
});
