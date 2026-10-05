// Live, synthetic control-plane test. Creates then deletes two temporary pilots.
// No phone, real participant, location history, or provider request is involved.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const a={id:randomUUID(),token:randomBytes(32).toString('hex')},b={id:randomUUID(),token:randomBytes(32).toString('hex')};
const post=async(person,action,fields={})=>{
 const r=await fetch('https://vjindchxfebaltbslqwc.supabase.co/functions/v1/driving-research',{method:'POST',headers:{'Content-Type':'application/json','x-research-token':person.token},body:JSON.stringify({action,participantId:person.id,...fields}),signal:AbortSignal.timeout(30000)});
 const body=await r.json();assert.equal(r.status,200,JSON.stringify(body));return body;
};
const query=sql=>JSON.parse(execFileSync('npx',['--no-install','supabase@2.118.0','db','query','--linked','--project-ref','vjindchxfebaltbslqwc',sql,'--output','json'],{encoding:'utf8'})).rows;
try {
 await post(a,'enroll',{consentVersion:1});await post(b,'enroll',{consentVersion:1});
 const [{request_id:command}]=query(`select public.request_driving_research_sync('${a.id}'::uuid) as request_id`);
 assert.equal(query(`select public.request_driving_research_sync('${a.id}'::uuid) as request_id`)[0].request_id,command,'repeat admin request is idempotent');
 assert.equal((await post(b,'control',{completedRequestId:command})).syncRequestId,null);
 assert.equal((await post(a,'control',{total:1400,pending:1201})).syncRequestId,command,'other participant cannot consume or complete the command');
 const events=Array.from({length:1201},()=>({id:randomUUID(),kind:'diagnostic',recordedAt:Date.now()/1000,payload:JSON.stringify({test:'bulk-sync-control'})}));
 for(const batch of [events.slice(0,1000),events.slice(0,1000),events.slice(1000)]) {
  const result=await post(a,'upload',{events:batch});assert.equal(result.accepted,batch.length);assert.deepEqual(result.ids,batch.map(e=>e.id));
 }
 const [stats]=query(`select (select count(*) from driving_research_events where participant_id='${a.id}') as records,(select pending from driving_research_device_counts where participant_id='${a.id}') as pending,has_function_privilege('anon','public.request_driving_research_sync(uuid)','execute') as anon,has_function_privilege('authenticated','public.request_driving_research_sync(uuid)','execute') as authenticated`);
 assert.equal(Number(stats.records),1201);assert.equal(Number(stats.pending),1201);assert.equal(stats.anon,false);assert.equal(stats.authenticated,false);
 assert.equal((await post(a,'control',{completedRequestId:command})).syncRequestId,null);
 console.log('PASS: targeted request isolation, operator-only access, count reporting, 1,201 immutable records, retry idempotency, completion acknowledgement');
} finally {
 for(const p of [a,b]) {await post(p,'delete')}
 const [remaining]=query(`select (select count(*) from driving_research_events where participant_id in ('${a.id}','${b.id}'))+(select count(*) from driving_research_device_counts where participant_id in ('${a.id}','${b.id}'))+(select count(*) from driving_research_sync_requests where participant_id in ('${a.id}','${b.id}')) as records`);
 assert.equal(Number(remaining.records),0);console.log('PASS: synthetic data, counts and requests deleted');
}
