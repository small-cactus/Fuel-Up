import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {alertRequest} from '../scripts/price-alerts/worker.mjs';
import {priceWatchStations} from '../src/lib/priceWatchStations.js';
import {installationSyncCall} from '../supabase/functions/_shared/installationSync.mjs';

test('watch only station-level, in-radius, selected-grade quotes',()=>{
 const base={fuelType:'regular',distanceMiles:1,price:3.2,providerTier:'station',id:'a'};
 const rows=[base,{...base,id:'b',price:3},{...base,id:'far',distanceMiles:8},{...base,id:'diesel',fuelType:'diesel'},
  {...base,id:'estimate',isEstimated:true},{...base,id:'region',providerTier:'state'},{...base,id:'invalid',price:null}];
 assert.deepEqual(priceWatchStations(rows,'regular',5),['b','a']);
});
test('watch registration is bounded and supports authenticated withdrawal',()=>{
 const b={action:'priceWatch',installationId:randomUUID(),product:'diesel',stationIds:[],zone:'America/New_York'};
 assert.deepEqual(installationSyncCall(b,'hashed').args.p_stations,[]);
 for(const change of [{stationIds:Array(41).fill('x')},{zone:'../test.'},{stationIds:['bad id']},{product:'random'}])
  assert.throws(()=>installationSyncCall({...b,...change},'hashed'));
});
test('Apple receives a visible short-lived price alert with the actual grade and payment',()=>{
 const creds={key:generateKeyPairSync('ec',{namedCurve:'P-256'}).privateKey,keyId:'test',teamId:'test'};
 const c={id:randomUUID(),stationId:'42',station:'Example',product:'regular_gas',payment:'credit',
  price:2.80, previous:3.90,environment:'sandbox',deviceToken:'a'.repeat(64),expiresAt:123};
 const r=alertRequest(c,creds),p=JSON.parse(r.payload);
 assert.equal(r.host,'https://api.sandbox.push.apple.com');assert.equal(r.headers['apns-expiration'],'123');
 assert.equal(r.headers['apns-push-type'],'alert');assert.equal(p.aps.alert.title,'Regular dropped $1.10 nearby');
 assert.equal(p.aps.alert.body,'Example reported $2.80/gal (credit).');
 assert.throws(()=>alertRequest({...c,environment:'untrusted'},creds));
});
