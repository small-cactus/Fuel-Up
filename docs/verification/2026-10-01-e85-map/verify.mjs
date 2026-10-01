// Public cache-only integration check. No provider collection requests.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const {url,key}=JSON.parse(readFileSync('app.json')).expo.extra.supabase;
const {buildLabStations}=await import('../../../src/screens/cluster-lab/stationCardModel.js');
const now=Date.now(),origin={latitude:27.973,longitude:-82.764};
const checks=[];
for (const fuelType of ['e85','regular']) {
 const response=await fetch(`${url}/functions/v1/gas-prices`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json','x-region':'us-east-2'},
 body:JSON.stringify({...origin,radiusMiles:15,fuelType}),signal:AbortSignal.timeout(20000)});
 const result=await response.json();assert.equal(response.status,200);assert.equal(result.source,'national-cache');
 const stations=buildLabStations({topStations:result.quotes},{origin,radiusMiles:15,fuelGrade:fuelType,now});
 if(fuelType==='e85') {assert(result.quotes.length>=13);assert(result.quotes.some(q=>q.price===null));assert.equal(stations.length,result.quotes.length);}
 for (const q of result.quotes) {
  assert(q.distanceMiles<=15);
  if(q.price===null){assert.equal(fuelType,'e85');assert.equal(q.offersE85,true);assert.equal(q.updatedAt,null);assert.deepEqual(q.allPrices,{});}
  else {assert(q.price>0);assert(now-Date.parse(q.updatedAt)<=86400000);}
 }
 checks.push({fuelType,count:result.quotes.length,unpriced:result.quotes.filter(q=>q.price===null).length,
  stations:fuelType==='e85'?stations.map(q=>({id:q.id,name:q.name,price:q.price,updatedAt:q.updatedAt})):undefined});
}
console.log(JSON.stringify({verifiedAt:new Date().toISOString(),providerRequests:0,checks},null,2));
