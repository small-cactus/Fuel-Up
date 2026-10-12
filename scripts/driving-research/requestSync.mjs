// Operator-only silent APNs wake plus durable, authenticated sync command.
// Usage: node scripts/driving-research/requestSync.mjs PARTICIPANT_UUID
import {execFileSync} from 'node:child_process';
import {loadCredentials,syncPushRequest,sendPush} from './apns.mjs';
const [participant]=process.argv.slice(2);
if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(participant||'')) throw Error('Provide an exact participant UUID');
const query=sql=>JSON.parse(execFileSync('npx',['--no-install','supabase@2.118.0','db','query','--linked','--project-ref','vjindchxfebaltbslqwc',sql,'--output','json'],{encoding:'utf8'})).rows;
const credentials=loadCredentials();
const claim=query(`select public.prepare_driving_research_sync_push('${participant}'::uuid) as claim`)[0].claim;
if(!claim.claimed) {
 console.log(JSON.stringify({participantId:participant,requestId:claim.requestId,status:claim.pushStatus,resent:false,delivery:'Durable request remains available at the next connected native wake.'}));
} else {
 console.log(JSON.stringify({participantId:participant,requestId:claim.requestId,status:'sending'}));
 const result=await sendPush(syncPushRequest(claim,credentials));
 const quote=value=>"'"+value.replaceAll("'","''")+"'";
 query(`update public.driving_research_sync_requests set push_status=${quote(result.status)},push_reason=${result.reason?quote(result.reason):'null'} where id='${claim.requestId}' and participant_id='${participant}'`);
 console.log(JSON.stringify({participantId:participant,requestId:claim.requestId,...result,delivery:'Silent APNs background push. Apple acceptance is not proof of device wake or completed upload; iOS controls delivery. The durable request survives delayed delivery.'}));
}
