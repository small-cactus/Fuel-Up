import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDrivingEvents} from '../supabase/functions/_shared/drivingResearch.mjs';
const now=Date.now()/1000;
const id='22222222-2222-4222-8222-222222222222';
const event=(kind,payload)=>({id,kind,recordedAt:now,payload:JSON.stringify(payload)});
const pedometer={visitId:id,stationId:'123',source:'apple_pedometer',terminalEvent:'visit_departure',observedStartAt:now-300,observedEndAt:now-60,startAt:now-300,endAt:now-60,truncated:false,status:'available',steps:0,dataStartAt:now-300,dataEndAt:now-60,distanceMeters:0};
const visit={source:'apple_visit',fuelPurchaseConfirmed:false,latitude:27,longitude:-82,accuracy:25,arrivalAt:now-300,departureAt:now-10,stationCandidates:[{stationId:'123',distanceMeters:50}]};
test('cross-checks accept real zero values, partial visits, and unknown measurements',()=>{
 assert.equal(validateDrivingEvents([event('visit_pedometer',pedometer)]).length,1);
 for(const status of ['not_authorized','unavailable','history_expired','query_failed','invalid_window']) {
  const p={...pedometer,status};delete p.steps;delete p.distanceMeters;
  assert.equal(validateDrivingEvents([event('visit_pedometer',p)]).length,1);
 }
 for(const omitted of ['arrivalAt','departureAt','neither']) {
  const p={...visit};delete p[omitted];
  assert.equal(validateDrivingEvents([event('system_visit',p)]).length,1);
 }
});
test('invalid and unavailable data cannot masquerade as measurements',()=>{
 for(const fields of [{steps:-1},{steps:1.5},{distanceMeters:-1},{status:'not_authorized'},{startAt:now-2000},{endAt:now+1000},{dataEndAt:now-400},{visitId:'invalid'}]) {
  assert.throws(()=>validateDrivingEvents([event('visit_pedometer',{...pedometer,...fields})]));
 }
 for(const fields of [{latitude:91},{accuracy:101},{fuelPurchaseConfirmed:true},{stationCandidates:[]},{stationCandidates:[{stationId:'123',distanceMeters:151}]},{departureAt:now-500},{arrivalAt:undefined,departureAt:undefined}]) {
  assert.throws(()=>validateDrivingEvents([event('system_visit',{...visit,...fields})]));
 }
 for(const kind of ['visit_pedometer','system_visit']) assert.throws(()=>validateDrivingEvents([event(kind,{...(kind==='system_visit'?visit:pedometer),isTest:true})]),/TEST_DATA_NOT_ALLOWED/);
});
