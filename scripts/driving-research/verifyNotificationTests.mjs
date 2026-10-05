// Synthetic-only integration test. Does not send notifications to a real phone.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const a={id:randomUUID(),token:randomBytes(32).toString('hex')},b={id:randomUUID(),token:randomBytes(32).toString('hex')};
const testId=randomUUID(),realEventId=randomUUID();
const post=async(person,action,fields={})=>{
 const r=await fetch('https://vjindchxfebaltbslqwc.supabase.co/functions/v1/driving-research',{method:'POST',headers:{'Content-Type':'application/json','x-research-token':person.token},body:JSON.stringify({action,participantId:person.id,...fields}),signal:AbortSignal.timeout(30000)});
 const body=await r.json();assert.equal(r.status,200,JSON.stringify(body));return body;
};
const query=sql=>JSON.parse(execFileSync('npx',['--no-install','supabase@2.118.0','db','query','--linked','--project-ref','vjindchxfebaltbslqwc',sql,'--output','json'],{encoding:'utf8'})).rows;
try {
 await post(a,'enroll',{consentVersion:1});await post(b,'enroll',{consentVersion:1});
 await post(a,'upload',{events:[{id:realEventId,kind:'diagnostic',recordedAt:Date.now()/1000,payload:JSON.stringify({integrationControl:true})}]});
 for(let i=0;i<2;i++) assert.equal(query(`select public.request_driving_research_notification_test('${a.id}','Shell',true,'${testId}') as id`)[0].id,testId);
 assert.equal((await post(b,'control')).notificationTests.length,0);
 const list=(await post(a,'control')).notificationTests;
 assert.equal(list.length,1);assert.equal(list[0].id,testId);assert.equal(list[0].status,'queued');
 const report={testId,status:'answered',label:'fueled',responseAt:Date.now()/1000};
 assert.equal((await post(b,'testStatus',report)).saved,false,'Cross-participant answer rejected');
 assert.equal(query(`select public.delete_driving_research_notification_test('${b.id}','${testId}') as deleted`)[0].deleted,false);
 assert.equal((await post(a,'testStatus',{testId,status:'scheduled'})).saved,true);
 assert.equal((await post(a,'testStatus',report)).saved,true);
 assert.equal((await post(a,'testStatus',report)).saved,true,'Answer retry is idempotent');
 await post(a,'testStatus',{testId,status:'dismissed',responseAt:report.responseAt+1});
 await post(a,'testStatus',{...report,label:'not_fueling',responseAt:report.responseAt-1});
 assert.equal((await post(a,'control')).notificationTests[0].label,'fueled','Late dismissal and older answer cannot erase label');
 const [rights]=query(`select has_function_privilege('anon','public.request_driving_research_notification_test(uuid,text,boolean,uuid)','execute') as anon,has_function_privilege('authenticated','public.delete_driving_research_notification_test(uuid,uuid)','execute') as authenticated`);
 assert.equal(rights.anon,false);assert.equal(rights.authenticated,false);
 assert.equal(query(`select public.delete_driving_research_notification_test('${a.id}','${testId}') as deleted`)[0].deleted,true);
 assert.equal((await post(a,'control')).notificationTests.length,0);
 assert.equal((await post(a,'testStatus',report)).saved,false,'Deleted test cannot reappear');
 const [counts]=query(`select (select count(*) from driving_research_events where participant_id='${a.id}') as real_count,(select count(*) from driving_research_notification_tests where id='${testId}') as test_count`);
 assert.equal(Number(counts.real_count),1,'Test deletion preserves unrelated research records');assert.equal(Number(counts.test_count),0);
 console.log('PASS: isolated targeted test, idempotent send/answer, participant isolation, late-response handling, test-only deletion preserves research');
 const deviceToken=randomBytes(32).toString('hex');
 assert.equal((await post(a,'registerPush',{deviceToken,environment:'sandbox'})).registered,true);
 const pushId=randomUUID();
 const claim=()=>query(`select public.prepare_driving_research_push_test('${a.id}','Mobil',true,'${pushId}') as claim`)[0].claim;
 const first=claim();assert.equal(first.claimed,true);assert.equal(first.environment,'sandbox');assert.equal(first.deviceToken,deviceToken);
 assert.equal(claim().claimed,false,'A duplicate or unknown APNs attempt must never resend');
 const pushFixture=(await post(a,'control')).notificationTests.find(t=>t.id===pushId);
 assert.equal(pushFixture.delivery,'apns');assert.equal(pushFixture.pushStatus,'sending');
 assert.equal((await post(b,'control')).notificationTests.length,0);
 assert.equal((await post(a,'testStatus',{testId:pushId,status:'answered',label:'fueled',responseAt:Date.now()/1000})).saved,true,'Cold push can answer without local scheduling');
 const [pushRights]=query(`select has_table_privilege('anon','public.driving_research_push_devices','select') as anon,has_function_privilege('authenticated','public.prepare_driving_research_push_test(uuid,text,boolean,uuid)','execute') as authenticated`);
 assert.equal(pushRights.anon,false);assert.equal(pushRights.authenticated,false);
 console.log('PASS: private push registration, atomic APNs-only fixture, no duplicate sends, cold answer');

} finally {
 for(const p of [a,b]) await post(p,'delete');
 const [counts]=query(`select (select count(*) from driving_research_push_devices where participant_id in ('${a.id}','${b.id}'))+(select count(*) from driving_research_events where participant_id in ('${a.id}','${b.id}'))+(select count(*) from driving_research_notification_tests where participant_id in ('${a.id}','${b.id}')) as remaining`);
 assert.equal(Number(counts.remaining),0);console.log('PASS: synthetic fixtures removed');
}
