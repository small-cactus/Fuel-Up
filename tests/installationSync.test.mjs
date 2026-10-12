import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync} from 'node:crypto';
import {installationPushRequest} from '../scripts/installation-telemetry/push.mjs';
import {createInstallationTelemetryHandler} from '../supabase/functions/_shared/installationTelemetry.mjs';
const id=randomUUID(),requestId=randomUUID(),credential='1'.repeat(64);
test('usage control exposes only authenticated installation RPCs, without research enrollment',async()=>{
 const calls=[];
 const handler=createInstallationTelemetryHandler({db:{rpc:async(name,args)=>{calls.push({name,args});return {data:{ok:true}}}}});
 const send=(body,token=credential)=>handler(new Request('https://fixture.invalid',{method:'POST',headers:{'x-installation-token':token},body:JSON.stringify({installationId:id,...body})}));
 for(const body of [{action:'registerPush',deviceToken:'a'.repeat(64),environment:'production'},{action:'control',requestId},{action:'control'},{action:'completeSync',requestId}]) assert.equal((await send(body)).status,200);
 assert.deepEqual(calls.map(x=>x.name),['register_installation_push','installation_sync_control','installation_sync_control','complete_installation_sync']);
 assert.ok(calls.every(x=>x.args.p_id===id && x.args.p_hash.length===64 && x.args.p_hash!==credential));
 assert.equal(calls[2].args.p_request,null);
 for(const body of [{action:'prepare_installation_sync_push'},{action:'enroll'},{action:'registerPush',deviceToken:'bad',environment:'production'},{action:'registerPush',deviceToken:'a'.repeat(64),environment:'wrong'},{action:'control',requestId:'bad'},{action:'completeSync'},{action:'control',installationId:'bad'}]) assert.equal((await send(body)).status,400);
 assert.equal((await send({action:'control'},'bad')).status,401);
 assert.equal(calls.length,4);
});
test('usage hint is silent and targets one installation with an expiring background push',()=>{
 const {privateKey:key}=generateKeyPairSync('ec',{namedCurve:'P-256'});
 const request=installationPushRequest({installationId:id,requestId,environment:'production',deviceToken:'a'.repeat(64),expiresAt:2000000000},{key,keyId:'TESTKEY123',teamId:'TESTTEAM12'});
 const payload=JSON.parse(request.payload);
 assert.deepEqual(payload,{aps:{'content-available':1},type:'fuelup.installation.sync.v1',requestId,installationId:id});
 assert.equal(request.headers['apns-push-type'],'background');assert.equal(request.headers['apns-priority'],'5');
 assert.equal(request.headers['apns-expiration'],'2000000000');
 assert.throws(()=>installationPushRequest({installationId:'bad'},{}));
});
