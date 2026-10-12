// Operator only: one silent hint plus an authenticated, durable usage-upload command.
// Usage: node scripts/installation-telemetry/requestSync.mjs INSTALLATION_UUID
import {execFileSync} from 'node:child_process';
import {loadCredentials,sendPush} from '../driving-research/apns.mjs';
import {installationPushRequest} from './push.mjs';
const [id]=process.argv.slice(2);
if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id||'')) throw Error('Provide an exact installation UUID');
const query=sql=>JSON.parse(execFileSync('npx',['--no-install','supabase@2.118.0','db','query','--linked','--project-ref','vjindchxfebaltbslqwc',sql,'--output','json'],{encoding:'utf8'})).rows;
const credentials=loadCredentials();
const claim=query(`select public.prepare_installation_sync_push('${id}'::uuid) as claim`)[0].claim;
if(!claim.claimed) {
 console.log(JSON.stringify({installationId:id,requestId:claim.requestId,status:claim.pushStatus,resent:false}));
} else {
 console.log(JSON.stringify({installationId:id,requestId:claim.requestId,status:'sending'}));
 const result=await sendPush(installationPushRequest(claim,credentials));
 const quote=value=>"'"+value.replaceAll("'","''")+"'";
 query(`update public.app_installation_sync_requests set push_status=${quote(result.status)},push_reason=${result.reason?quote(result.reason):'null'} where id='${claim.requestId}' and installation_id='${id}'`);
 console.log(JSON.stringify({installationId:id,requestId:claim.requestId,...result,delivery:'Apple acceptance is not device receipt. received_at records authenticated control retrieval; completed_at records client-reported outbox drain. Inspect new event rows separately.'}));
}
