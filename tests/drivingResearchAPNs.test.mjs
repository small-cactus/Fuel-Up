import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,verify} from 'node:crypto';
import {providerToken,pushRequest} from '../scripts/driving-research/apns.mjs';
const {privateKey:key,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const credentials={key,keyId:'YQJ732S4LG',teamId:'39XZ43SJ93'};
test('APNs JWT uses the required raw 64-byte ES256 signature',()=>{
 const jwt=providerToken(credentials,1234),[header,claims,signature]=jwt.split('.');
 assert.deepEqual(JSON.parse(Buffer.from(header,'base64url')),{alg:'ES256',kid:credentials.keyId});
 assert.deepEqual(JSON.parse(Buffer.from(claims,'base64url')),{iss:credentials.teamId,iat:1234});
 assert.equal(Buffer.from(signature,'base64url').length,64);
 assert.ok(verify('sha256',Buffer.from(`${header}.${claims}`),{key:publicKey,dsaEncoding:'ieee-p1363'},Buffer.from(signature,'base64url')));
});
test('remote tests are visible actionable alerts with a complete cold-answer fixture',()=>{
 const claim={deviceToken:'a'.repeat(64),environment:'sandbox',test:{id:'11111111-1111-4111-8111-111111111111',participantId:'22222222-2222-4222-8222-222222222222',stationName:'Mobil',candidate:true,createdAt:100,expiresAt:200,delivery:'apns',status:'queued'}};
 const r=pushRequest(claim,credentials),p=JSON.parse(r.payload);
 assert.equal(r.host,'https://api.sandbox.push.apple.com');assert.equal(r.headers['apns-push-type'],'alert');assert.equal(r.headers['apns-priority'],'10');
 assert.equal(r.headers['apns-id'],claim.test.id);assert.equal(r.headers['apns-expiration'],'200');
 assert.deepEqual(p.researchTest,claim.test);assert.equal(p.testId,claim.test.id);
 assert.equal(p.aps.alert.title,'got fuel? 👀');assert.equal(p.aps.alert.subtitle,'help Fuel Up get better. Tap and hold to answer');
 assert.equal(p.aps.category,'fuelup.research.test.v1');assert.equal(p.aps['mutable-content'],1);
 const stop=pushRequest({...claim,environment:'production',test:{...claim.test,candidate:false}},credentials);
 assert.equal(stop.host,'https://api.push.apple.com');assert.equal(JSON.parse(stop.payload).aps.alert.title,'got something at Mobil? 👀');
 assert.throws(()=>pushRequest({...claim,environment:'development'},credentials));
});
