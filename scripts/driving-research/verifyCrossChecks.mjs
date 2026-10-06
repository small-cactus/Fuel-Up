// Live synthetic schema/read-back check. No real participant or device is used.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const id=randomUUID(),token=randomBytes(32).toString('hex'),visitId=randomUUID();
const now=Date.now()/1000;
const query=sql=>JSON.parse(execFileSync('npx',['--no-install','supabase@2.118.0','db','query','--linked','--project-ref','vjindchxfebaltbslqwc',sql,'--output','json'],{encoding:'utf8'})).rows;
const post=async(action,fields={},status=200)=>{
 const r=await fetch('https://vjindchxfebaltbslqwc.supabase.co/functions/v1/driving-research',{
  method:'POST',headers:{'Content-Type':'application/json','x-research-token':token},
  body:JSON.stringify({action,participantId:id,...fields}),signal:AbortSignal.timeout(30000)});
 const body=await r.json();assert.equal(r.status,status,JSON.stringify(body));return body;
};
const make=(kind,p)=>({id:randomUUID(),kind,recordedAt:now,payload:JSON.stringify({...p,validationFixture:'cross-check-smoke'})});
const p={visitId,stationId:'synthetic',source:'apple_pedometer',terminalEvent:'visit_departure',observedStartAt:now-300,observedEndAt:now-30,startAt:now-300,endAt:now-30,truncated:false};
const events=[
 make('visit_pedometer',{...p,status:'available',steps:0,distanceMeters:0,dataStartAt:now-300,dataEndAt:now-30}),
 make('visit_pedometer',{...p,visitId:randomUUID(),status:'not_authorized'}),
 make('system_visit',{source:'apple_visit',latitude:0,longitude:0,accuracy:20,arrivalAt:now-300,stationCandidates:[{stationId:'synthetic',distanceMeters:10}],fuelPurchaseConfirmed:false})
];
try {
 await post('enroll',{consentVersion:1});
 for(let i=0;i<2;i++) {
  const result=await post('upload',{events});assert.deepEqual(result.ids,events.map(e=>e.id));assert.equal(result.accepted,3);
 }
 await post('upload',{events:[make('visit_pedometer',{...p,status:'not_authorized',steps:0})]},400);
 const rows=query(`select event from driving_research_events where participant_id='${id}' order by id`);
 assert.equal(rows.length,3);
 for(const e of events) assert.deepEqual(rows.find(r=>r.event.id===e.id).event,e);
 console.log('PASS: deployed endpoint, measured zero, unavailable without measurements, partial Apple visit, original IDs, immutable read-back, retry deduplication, invalid-result rejection');
} finally {
 await post('delete');
 assert.equal(Number(query(`select count(*) as n from driving_research_events where participant_id='${id}'`)[0].n),0);
 console.log('PASS: all synthetic cross-check records deleted');
}
