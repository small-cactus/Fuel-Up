import {sign,createPrivateKey} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {connect} from 'node:http2';

export function loadCredentials() {
 const config=JSON.parse(readFileSync(process.env.FUELUP_APNS_CONFIG||join(homedir(),'.config/fuelup/apns.json'),'utf8'));
 if(!/^[A-Z0-9]{10}$/.test(config.keyId)||!/^[A-Z0-9]{10}$/.test(config.teamId)) throw Error('Invalid APNs key or team ID');
 return {...config,key:createPrivateKey(readFileSync(config.keyPath))};
}
export function providerToken({key,keyId,teamId},now=Math.floor(Date.now()/1000)) {
 const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
 const body=`${encode({alg:'ES256',kid:keyId})}.${encode({iss:teamId,iat:now})}`;
 return `${body}.${sign('sha256',Buffer.from(body),{key,dsaEncoding:'ieee-p1363'}).toString('base64url')}`;
}
export function pushRequest(claim,credentials) {
 if(!['sandbox','production'].includes(claim.environment)||!/^[a-f0-9]{32,512}$/.test(claim.deviceToken)) throw Error('Invalid registered push address');
 const test=claim.test;
 const title=test.candidate?'got fuel? 👀':`got something at ${test.stationName}? 👀`;
 const payload=JSON.stringify({aps:{alert:{title,subtitle:'help Fuel Up get better. Tap and hold to answer'},category:'fuelup.research.test.v1','thread-id':'fuelup.research.tests',sound:'default','mutable-content':1},testId:test.id,researchTest:test});
 if(Buffer.byteLength(payload)>4096) throw Error('APNs payload exceeds limit');
 return {host:claim.environment==='sandbox'?'https://api.sandbox.push.apple.com':'https://api.push.apple.com',payload,headers:{':method':'POST',':path':`/3/device/${claim.deviceToken}`,authorization:`bearer ${providerToken(credentials)}`,'apns-topic':'com.anthonyh.fuelup','apns-push-type':'alert','apns-priority':'10','apns-expiration':String(Math.floor(test.expiresAt)),'apns-collapse-id':test.id,'apns-id':test.id}};
}
// A transport error may happen after Apple accepted the request. Never blindly retry.
export function sendPush(request) {
 return new Promise(resolve=>{
  const client=connect(request.host);let finished=false,status=0,body='';
  const finish=result=>{if(finished)return;finished=true;clearTimeout(timer);client.destroy();resolve(result)};
  const timer=setTimeout(()=>finish({status:'unknown',reason:'TransportTimeout'}),15000);
  client.on('error',()=>finish({status:'unknown',reason:'TransportError'}));
  const stream=client.request(request.headers);
  stream.on('response',headers=>{status=Number(headers[':status'])});
  stream.on('data',data=>{if(body.length<4096)body+=data});
  stream.on('error',()=>finish({status:'unknown',reason:'StreamError'}));
  stream.on('end',()=>{
   if(status===200)return finish({status:'accepted',reason:null});
   let reason;try{reason=JSON.parse(body).reason}catch{}
   finish({status:status>=400?'rejected':'unknown',reason:/^[A-Za-z0-9]+$/.test(reason||'')?reason:`HTTP${status}`});
  });
  stream.end(request.payload);
 });
}
