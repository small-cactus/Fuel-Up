// Operator-only test lifecycle. Uses a separate table, never visit training labels.
// send PARTICIPANT_UUID [brand] [fuel|stop] [TEST_UUID for safe retry]
// status PARTICIPANT_UUID [TEST_UUID]
// delete PARTICIPANT_UUID TEST_UUID
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {loadCredentials,pushRequest,sendPush} from './apns.mjs';
const [action,participant,arg,kind='fuel',retryId]=process.argv.slice(2);
const uuid=v=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v||'');
if(!uuid(participant)||!['send','status','delete'].includes(action)) throw Error('Use send/status/delete with an exact participant UUID');
const query=sql=>JSON.parse(execFileSync('npx',['--no-install','supabase@2.118.0','db','query','--linked','--project-ref','vjindchxfebaltbslqwc',sql,'--output','json'],{encoding:'utf8'})).rows;
const quote=value=>"'"+value.replaceAll("'","''")+"'";
if(action==='send') {
 const brand=(arg||'the gas station').trim(),testId=retryId||randomUUID();
 if(!brand||brand.length>80||/[\u0000-\u001f]/.test(brand)||!['fuel','stop'].includes(kind)||!uuid(testId)) throw Error('Invalid brand, kind, or retry UUID');
 const credentials=loadCredentials();
 // Emit the identity first. Reusing it never repeats an uncertain Apple request.
 console.log(JSON.stringify({testId,participantId:participant}));
 const claim=query(`select public.prepare_driving_research_push_test('${participant}',${quote(brand)},${kind==='fuel'},'${testId}') as claim`)[0].claim;
 if(!claim.claimed) console.log(JSON.stringify({testId,status:claim.pushStatus,resent:false}));
 else {
  const request=pushRequest(claim,credentials);
  const result=await sendPush(request);
  query(`update public.driving_research_notification_tests set push_status=${quote(result.status)},push_reason=${result.reason?quote(result.reason):'null'},updated_at=now() where id='${testId}' and participant_id='${participant}'`);
  console.log(JSON.stringify({testId,...result,delivery:'APNs alert; no app launch or polling required. Accepted means Apple accepted the request, not confirmed display.'}));
 }
} else if(action==='status') {
 if(arg&&!uuid(arg)) throw Error('Invalid test UUID');
 console.log(JSON.stringify(query(`select id,station_name,candidate,status,label,response_at,created_at,expires_at,updated_at,delivery,push_status,push_reason from public.driving_research_notification_tests where participant_id='${participant}' ${arg?`and id='${arg}'`:''} order by created_at`),null,2));
} else {
 if(!uuid(arg)) throw Error('Provide the exact test UUID to delete');
 console.log(JSON.stringify(query(`select public.delete_driving_research_notification_test('${participant}','${arg}') as deleted`)));
 console.log('Phone clears this test and its notification on the next connected control check. Real data is untouched.');
}
