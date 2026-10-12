import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const id=randomUUID(),token=randomBytes(32).toString('hex');
const query=sql=>JSON.parse(execFileSync('npx',['--no-install','supabase@2.118.0','db','query','--linked','--project-ref','vjindchxfebaltbslqwc',sql,'--output','json'],{encoding:'utf8'})).rows;
const events=[{id:randomUUID(),kind:'onboarding_step',recordedAt:Date.now()/1000,payload:{step:2,screen:'onboarding/2'}},
 {id:randomUUID(),kind:'permission_snapshot',recordedAt:Date.now()/1000,payload:{location:2,precise:false,screen:'onboarding/1'}},
 {id:randomUUID(),kind:'onboarding_complete',recordedAt:Date.now()/1000,payload:{screen:'onboarding'}}];
async function post(secret=token,items=events) {
 return fetch('https://vjindchxfebaltbslqwc.supabase.co/functions/v1/installation-telemetry',{method:'POST',headers:{'Content-Type':'application/json','x-installation-token':secret},body:JSON.stringify({installationId:id,profile:{deviceModel:'synthetic-validation',telemetryVersion:1},events:items}),signal:AbortSignal.timeout(30000)});
}
try {
 for(let i=0;i<2;i++) {const r=await post();assert.equal(r.status,200);assert.deepEqual((await r.json()).ids,events.map(e=>e.id));}
 assert.equal((await post('2'.repeat(64))).status,401);
 const p=query(`select event_count,highest_onboarding_step,onboarding_completed from app_installations where id='${id}'`)[0];
 assert.equal(Number(p.event_count),3);assert.equal(p.highest_onboarding_step,2);assert.equal(p.onboarding_completed,true);
 const rows=query(`select id,kind,payload from app_installation_events where installation_id='${id}'`);
 assert.equal(rows.length,3);for(const event of events) assert.deepEqual(rows.find(r=>r.id===event.id).payload,event.payload);
 const changed=structuredClone(events);changed[0].payload.step=0;assert.equal((await post(token,changed)).status,200);
 assert.equal(query(`select payload->>'step' as step from app_installation_events where installation_id='${id}' and id='${events[0].id}'`)[0].step,'2');
 console.log('PASS: profile, timeline, immutable retry dedup, permission values, completion and credential isolation');
} finally {
 query(`delete from app_installations where id='${id}'`);
 assert.equal(Number(query(`select count(*) as n from app_installation_events where installation_id='${id}'`)[0].n),0);
 console.log('PASS: synthetic fixture removed');
}
