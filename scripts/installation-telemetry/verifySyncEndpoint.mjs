// Creates and removes one synthetic installation. No APNs call or real user data.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const id=randomUUID(),token=randomBytes(32).toString('hex'),address=randomBytes(32).toString('hex');
const query=sql=>JSON.parse(execFileSync('npx',['--no-install','supabase@2.118.0','db','query','--linked','--project-ref','vjindchxfebaltbslqwc',sql,'--output','json'],{encoding:'utf8'})).rows;
async function post(body,secret=token) {
 const response=await fetch('https://vjindchxfebaltbslqwc.supabase.co/functions/v1/installation-telemetry',{method:'POST',headers:{'Content-Type':'application/json','x-installation-token':secret},body:JSON.stringify({installationId:id,...body}),signal:AbortSignal.timeout(30000)});
 return {status:response.status,body:await response.json()};
}
try {
 assert.deepEqual(await post({action:'registerPush',deviceToken:address,environment:'sandbox'}),{status:200,body:{registered:true}});
 assert.equal((await post({action:'control'},'2'.repeat(64))).status,401);
 const claim=query(`select prepare_installation_sync_push('${id}') as claim`)[0].claim;
 assert.equal(claim.claimed,true);
 assert.deepEqual((await post({action:'completeSync',requestId:claim.requestId})).body,{completed:false});
 assert.deepEqual((await post({action:'control',requestId:claim.requestId})).body,{requestId:claim.requestId});
 const event={id:randomUUID(),kind:'app_foreground',recordedAt:Date.now()/1000,payload:{screen:'home'}};
 assert.deepEqual(await post({profile:{deviceModel:'synthetic-silent-sync',build:'fixture'},events:[event]}),{status:200,body:{ids:[event.id]}});
 assert.deepEqual(await post({action:'completeSync',requestId:claim.requestId}),{status:200,body:{completed:true}});
 const evidence=query(`select r.received_at is not null as received,r.completed_at is not null as completed,i.event_count from app_installation_sync_requests r join app_installations i on i.id=r.installation_id where i.id='${id}'`)[0];
 assert.equal(evidence.received,true);assert.equal(evidence.completed,true);assert.equal(Number(evidence.event_count),1);
 console.log('PASS: deployed registration without research, credential isolation, authenticated control, event upload and completion');
} finally {
 query(`delete from app_installations where id='${id}'`);
 const cleanup=query(`select (select count(*) from app_installation_push_devices where installation_id='${id}')+(select count(*) from app_installation_sync_requests where installation_id='${id}')+(select count(*) from app_installation_events where installation_id='${id}') as n`)[0];
 assert.equal(Number(cleanup.n),0);console.log('PASS: fixture cascade cleanup; no APNs sent');
}
