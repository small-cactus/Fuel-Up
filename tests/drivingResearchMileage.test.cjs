const test=require('node:test');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
test('native mileage ledger measures all samples and survives lifecycle boundaries',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fuel-mileage-test-'));
  const binary=path.join(dir,'test');
  try {
    execFileSync('swiftc',['-parse-as-library','modules/fuel-up-driving-activity/ios/Research/DrivingResearchModels.swift','modules/fuel-up-driving-activity/ios/Research/DrivingResearchMileage.swift','tests/swift/mileageLedgerTests.swift','-o',binary],{timeout:60000,stdio:'pipe'});
    process.stdout.write(execFileSync(binary,{timeout:30000,encoding:'utf8'}));
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('mileage metadata travels in the supported research diagnostic envelope',async()=>{
  const assert=require('node:assert/strict');
  const {validateDrivingEvents}=await import('../supabase/functions/_shared/drivingResearch.mjs');
  const now=Date.now()/1000;
  const mileageAtReceipt={version:1,epoch:'fixture',capturedMeters:1234.5,coveredSeconds:100,unmeasuredGapSeconds:300,gapCount:1,acceptedSamples:80,delayedSamples:12,rejectedSamples:2,duplicateOrOutOfOrderSamples:1,collectionBoundaryCount:0,collectingSince:now-1000,lastSampleAt:now-10,distanceType:'captured_gps_driving_segments',completeOdometer:false};
  const event={id:'11111111-1111-4111-8111-111111111111',kind:'diagnostic',recordedAt:now,payload:JSON.stringify({schemaVersion:1,mileageCheckpoint:true,mileageAtReceipt})};
  const validated=validateDrivingEvents([event],now);
  assert.equal(validated.length,1);
  assert.deepEqual(JSON.parse(validated[0].payload).mileageAtReceipt,mileageAtReceipt);
});
