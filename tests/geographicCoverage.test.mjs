import test from 'node:test';import assert from 'node:assert/strict';
import {reconcileDCGeography} from '../scripts/national-prices/geographicCoverage.mjs';
const boundary={source:'synthetic test polygon',data:{features:[{properties:{STUSAB:'DC'},geometry:{type:'Polygon',coordinates:[[[-77.03,38.89],[-77.01,38.89],[-77.01,38.91],[-77.03,38.91],[-77.03,38.89]]]}}]}};
function observation(latitude=38.9,id='1') {
 return {observedAt:new Date().toISOString(),task:{kind:'nearby'},scopes:[{state:'DC',fullResponse:true,reportedCount:2,requestedCenter:{latitude,longitude:-77.02},stations:[
  {id,latitude:38.9,longitude:-77.02,address:{region:'DC',country:'US'}},
  {id:'outside',latitude:latitude+.22,longitude:-77.02,address:{region:'MD',country:'US'}}]}]};
}
test('geographic certificate requires distinct full circles and identical DC-only IDs',()=>{
 assert.equal(reconcileDCGeography([observation(),observation()],boundary),null);
 assert.equal(reconcileDCGeography([observation(),observation(38.92,'2')],boundary),null);
 const r=reconcileDCGeography([observation(),observation(38.92)],boundary);
 assert.equal(r.expectedCount,1);assert.deepEqual(r.ids,['1']);assert.match(r.coverageBasis,/empirically/);
});
test('partial results and boundaries outside observed footprints cannot qualify',()=>{
 const partial=observation(38.92);partial.scopes[0].fullResponse=false;
 assert.equal(reconcileDCGeography([observation(),partial],boundary),null);
 assert.equal(reconcileDCGeography([observation(38.1),observation(38.12)],boundary),null);
});
