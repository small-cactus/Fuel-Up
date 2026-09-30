import test from 'node:test';import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';import {createHash} from 'node:crypto';
import {auditArchive} from '../scripts/national-prices/auditArchive.mjs';
const run={slot_at:'2026-09-30T22:00:00Z',deadline_at:'2026-09-30T23:00:00Z'};
const snapshot={version:1,provider:'gasbuddy',executionRegion:'us-east-1',startedAt:'2026-09-30T22:01:00Z',observedAt:'2026-09-30T22:01:02Z',stations:[{id:'1',prices:[{fuelProduct:'regular',cash:{price:3.2,postedTime:null},credit:null}]},{id:'2',prices:[]}]};
const fixture=(s=snapshot)=>{const bytes=gzipSync(JSON.stringify(s));return {bytes,job:{archive_bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),execution_region:'us-east-1',station_ids:['1','2'],started_at:s.startedAt,observed_at:s.observedAt,priced_count:1}};};
test('read-back audit verifies real bytes, exact IDs, region, window, and unpriced coverage',()=>{
 const {bytes,job}=fixture();const result=auditArchive(bytes,job,run);assert.equal(result.stations,2);assert.equal(result.priced,1);
 for(const override of [{sha256:'0'.repeat(64)},{archive_bytes:bytes.length+1},{station_ids:['2','1']},{execution_region:'us-west-1'},{priced_count:2}])assert.throws(()=>auditArchive(bytes,{...job,...override},run));
});
test('validly hashed stale or wrong-region snapshots still fail the audit',()=>{
 for(const override of [{executionRegion:'us-west-2'},{startedAt:'2026-09-30T21:59:59Z'},{observedAt:'2026-09-30T23:01:00Z'}]){
  const {bytes,job}=fixture({...snapshot,...override});assert.throws(()=>auditArchive(bytes,job,run));
 }
});
