const test=require('node:test');
const assert=require('node:assert/strict');
const {interactionPayload}=require('../src/lib/researchInteractionPayload.cjs');
test('station tap preserves exact selected station and timing, without serializing unrelated provider data',()=>{
 const p=interactionPayload('station_go',{station:{id:'station-b',name:'Example',latitude:27,longitude:-82,price:3.14,token:'not-to-upload',allPrices:{private:'no'}},fuelGrade:'regular',rank:3,surface:'station_card'},123000);
 assert.equal(p.station.id,'station-b');assert.equal(p.station.displayedRank,3);assert.equal(p.clientOccurredAt,123);
 assert.equal(p.station.token,undefined);assert.equal(p.station.allPrices,undefined);
});
test('map events are bounded and malformed numeric values are omitted',()=>{
 const p=interactionPayload('map_gesture',{gesture:'pan',viewport:{latitude:NaN,longitude:-82,heading:Infinity,secret:'no'}},0);
 assert.deepEqual(p.viewport,{longitude:-82});assert.equal(interactionPayload('anything'),null);
});
