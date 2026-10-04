import test from 'node:test';
import assert from 'node:assert/strict';
import {createDrivingResearchHandler,validateDrivingEvents} from '../supabase/functions/_shared/drivingResearch.mjs';
const id='22222222-2222-4222-8222-222222222222';
const event={id:'11111111-1111-4111-8111-111111111111',kind:'location',recordedAt:Date.now()/1000,payload:JSON.stringify({timestamp:Date.now()/1000,latitude:27,longitude:-82,accuracy:12})};
const token='a'.repeat(64);
const request=(body,auth=token)=>new Request('https://example.com',{method:'POST',headers:auth?{'x-research-token':auth}:{},body:JSON.stringify(body)});
test('requires participant token and consent; enrollment binds a hash, not a raw token',async()=>{
 const calls=[];const handler=createDrivingResearchHandler({db:{rpc:async(name,args)=>{calls.push({name,args});return{data:true}}}});
 assert.equal((await handler(request({action:'enroll',participantId:id},null))).status,401);
 assert.equal((await handler(request({action:'enroll',participantId:id}))).status,400);
 assert.equal((await handler(request({action:'enroll',participantId:id,consentVersion:1}))).status,200);
 assert.equal(calls.length,1);assert.notEqual(calls[0].args.p_hash,token);assert.equal(calls[0].args.p_hash.length,64);
});
test('revoked or invalid participants cannot upload, query stations or delete another participant',async()=>{
 for(const action of ['upload','stations','delete']) {
  const calls=[];const handler=createDrivingResearchHandler({db:{rpc:async name=>{calls.push(name);return{data:false}}}});
  assert.equal((await handler(request({action,participantId:id,events:[event]}))).status,403);
  assert.deepEqual(calls,[action==='delete'?'delete_driving_research':'access_driving_research']);
 }
});
test('upload acknowledges original IDs only after database success',async()=>{
 const handler=createDrivingResearchHandler({db:{rpc:async name=>name==='access_driving_research'?{data:true}:{data:1}}});
 const response=await handler(request({action:'upload',participantId:id,events:[event]}));
 assert.deepEqual(await response.json(),{accepted:1,ids:[event.id]});
 const failed=createDrivingResearchHandler({db:{rpc:async name=>name==='access_driving_research'?{data:true}:{error:{message:'database'}}}});
 assert.equal((await failed(request({action:'upload',participantId:id,events:[event]}))).status,503);
});
test('validates batches, coordinates, timestamps, labels, and duplicate IDs',()=>{
 assert.equal(validateDrivingEvents([event]).length,1);
 for(const events of [[],[event,event],[{...event,payload:'{}'}],[{...event,recordedAt:Date.now()/1000+1000}],[{...event,kind:'visit_label',payload:JSON.stringify({visitId:id,label:'verified-pump-truth'})}]]) assert.throws(()=>validateDrivingEvents(events));
});
test('station lookup uses only existing catalog coordinates',async()=>{
 const calls=[];const handler=createDrivingResearchHandler({db:{rpc:async(name,args)=>{calls.push({name,args});return{data:name==='access_driving_research'?true:[]}}}});
 assert.equal((await handler(request({action:'stations',participantId:id,latitude:27,longitude:-82}))).status,200);
 assert.deepEqual(calls.map(c=>c.name),['access_driving_research','driving_research_stations']);
});

test('delete can retry after a lost response and revocation',async()=>{
 const calls=[];const handler=createDrivingResearchHandler({db:{rpc:async name=>{calls.push(name);return{data:true}}}});
 assert.equal((await handler(request({action:'delete',participantId:id}))).status,200);
 assert.equal((await handler(request({action:'delete',participantId:id}))).status,200);
 assert.deepEqual(calls,['delete_driving_research','delete_driving_research']);
});
