// Cache-only live checks; never contact either upstream source.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { buildLabStations } from '../../../src/screens/cluster-lab/stationCardModel.js';
const {url,key}=JSON.parse(fs.readFileSync('app.json')).expo.extra.supabase;
const origin={latitude:27.973,longitude:-82.764};
const results=[];
for(const radiusMiles of [5,15]) {
 const response=await fetch(`${url}/functions/v1/gas-prices`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json','x-region':'us-east-2'},body:JSON.stringify({...origin,radiusMiles,fuelType:'e85'}),signal:AbortSignal.timeout(20000)});
 assert.equal(response.status,200);const data=await response.json();assert.equal(data.source,'national-cache');
 const stations=buildLabStations({topStations:data.quotes},{origin,radiusMiles,fuelGrade:'e85'});
 assert.equal(stations.length,data.quotes.length);assert.equal(new Set(stations.map(s=>s.id)).size,stations.length);
 for(const s of stations){assert(s.distanceMiles<=radiusMiles);if(s.price==null){assert.equal(s.updatedAt,null);assert.deepEqual(s.allPrices,{});}}
 if(radiusMiles===15){
  assert(stations.length>=14);assert(stations.some(s=>s.id==='177822'&&s.name==='Thorntons'));
  assert.equal(stations.filter(s=>s.address?.includes('32490')).length,1,'Palm Harbor aliases must collapse');
 } else assert(!stations.some(s=>s.id==='177822'),'Oldsmar is outside 5 miles');
 results.push({radiusMiles,count:stations.length,unpriced:stations.filter(s=>s.price==null).length,stations:stations.map(s=>({id:s.id,name:s.name,address:s.address,price:s.price,source:s.sourceLabel,distanceMiles:s.distanceMiles}))});
}
console.log(JSON.stringify({checkedAt:new Date().toISOString(),results},null,2));
