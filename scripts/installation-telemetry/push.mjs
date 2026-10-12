import {syncPushRequest} from '../driving-research/apns.mjs';
export function installationPushRequest(claim, credentials) {
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(claim.installationId||'')) throw Error('Invalid installation');
 const request=syncPushRequest(claim,credentials);
 request.payload=JSON.stringify({aps:{'content-available':1},type:'fuelup.installation.sync.v1',requestId:claim.requestId,installationId:claim.installationId});
 request.headers['apns-collapse-id']='fuelup.installation.sync';
 return request;
}
