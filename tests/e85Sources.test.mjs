import test from 'node:test';
import assert from 'node:assert/strict';
import { parseE85Source } from '../supabase/functions/_shared/e85Sources.mjs';
import { createE85DirectoryHandler, retryAfterSeconds } from '../supabase/functions/_shared/e85DirectoryWorker.mjs';
const rfaRows=()=>Array.from({length:4000},(_,id)=>({id:String(id+1),name:'RaceTrac',address:'100 Main St',city_name:'Oldsmar',state_name:'Florida',lat:'28',lng:'-82',active:'1',price_data:{price_e85:0.99,username:'private-reporter'}}));
test('RFA source keeps availability without prices; rejects invalid coordinates and incomplete snapshots',()=>{
 const rows=rfaRows();rows.push({...rows[0],id:'5000',lat:'0',lng:'0'});
 const parsed=parseE85Source('e85prices',JSON.stringify(rows));assert.equal(parsed.rows.length,4000);assert.equal(parsed.rejected,1);
 assert.deepEqual(parsed.rows[0],{source_id:'1',name:'RaceTrac',street:'100 Main St',city:'Oldsmar',state:'FL',latitude:28,longitude:-82});
 assert(!JSON.stringify(parsed).includes('price_e85'));assert(!JSON.stringify(parsed).includes('private-reporter'));
 assert.throws(()=>parseE85Source('e85prices','[]'),/INCOMPLETE/);
 assert.throws(()=>parseE85Source('e85prices',JSON.stringify([...rfaRows(),rfaRows()[0]])),/DUPLICATE/);
});
test('Thorntons reads only the explicit E85 class, not other fuels or nearby text',()=>{
 const station=(id,fuel)=>`<div data-type="store" class="store box" data-latitude="28.04289" data-longitude="-82.6771"><p class="${fuel} FL"><span data-type="name">Thorntons. #${id}</span><br><span data-type="address">3780 Tampa Rd</span><br><span data-type="city">Oldsmar</span>, <span data-type="state">FL</span><span data-type="zip">34677</span><br></p></div>`;
 const html=Array.from({length:100},(_,i)=>station(i+1,'E85')).join('')+station(101,'Unleaded15')+'E85';
 const parsed=parseE85Source('thorntons',html);assert.equal(parsed.rows.length,100);assert.equal(parsed.rows[0].city,'Oldsmar');
 assert.equal(parsed.rows[0].street,'3780 Tampa Rd');assert.throws(()=>parseE85Source('thorntons','<html>maintenance</html>'));
});
const request=()=>new Request('https://example.test',{method:'POST',headers:{'x-fuel-research-key':'secret'}});
test('worker authenticates before any network or database access',async()=>{
 const handler=createE85DirectoryHandler({secret:'secret',db:{rpc(){throw Error('unexpected DB');}},fetchImpl(){throw Error('unexpected fetch');}});
 assert.equal((await handler(new Request('https://example.test'))).status,401);
});
test('not-due lease makes no source requests',async()=>{
 let calls=0;const handler=createE85DirectoryHandler({secret:'secret',db:{rpc:async()=>({data:null})},fetchImpl:()=>{calls++;}});
 assert.equal((await handler(request())).status,200);assert.equal(calls,0);
});
test('429 records Retry-After and preserves existing data without retries',async()=>{
 const calls=[];let fetches=0;
 const db={rpc:async(name,args)=>{calls.push({name,args});return {data:name==='claim_fuel_e85_source'&&args.p_source==='e85prices'?'lease':null};}};
 const handler=createE85DirectoryHandler({secret:'secret',db,fetchImpl:async()=>{fetches++;return new Response('',{status:429,headers:{'Retry-After':'172800'}});}});
 assert.equal((await handler(request())).status,503);assert.equal(fetches,1);
 const failure=calls.find(c=>c.name==='fail_fuel_e85_source');assert.equal(failure.args.p_retry_seconds,172800);assert.equal(failure.args.p_disable,false);
 assert(!calls.some(c=>c.name==='import_fuel_e85_source'));
});
test('access denial disables source while leaving its last good cache intact',async()=>{
 const calls=[];const db={rpc:async(name,args)=>{calls.push({name,args});return {data:name==='claim_fuel_e85_source'&&args.p_source==='thorntons'?'lease':null};}};
 await createE85DirectoryHandler({secret:'secret',db,fetchImpl:async()=>new Response('',{status:403})})(request());
 assert.equal(calls.find(c=>c.name==='fail_fuel_e85_source').args.p_disable,true);
});
test('successful import sends only normalized metadata and source response hash',async()=>{
 const calls=[];const db={rpc:async(name,args)=>{calls.push({name,args});return {data:name==='claim_fuel_e85_source'?(args.p_source==='e85prices'?'lease':null):{imported:4000}};}};
 const response=await createE85DirectoryHandler({secret:'secret',db,fetchImpl:async()=>new Response(JSON.stringify(rfaRows()))})(request());
 assert.equal(response.status,200);const imported=calls.find(c=>c.name==='import_fuel_e85_source');assert.equal(imported.args.p_rows.length,4000);assert.match(imported.args.p_sha256,/^[a-f0-9]{64}$/);
 assert(!JSON.stringify(imported.args).includes('price_data'));
});
test('Retry-After date respected and invalid value defaults to a day',()=>{
 const now=Date.parse('2026-10-01T00:00:00Z');assert.equal(retryAfterSeconds('Sat, 03 Oct 2026 00:00:00 GMT',now),172800);
 assert.equal(retryAfterSeconds('bad',now),86400);
});
