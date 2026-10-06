const test=require('node:test');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const root='modules/fuel-up-driving-activity/ios/Research/';
test('native cross-check queue survives relaunch, respects pause, and keeps unknown distinct from zero',()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'fuel-cross-check-test-'));
 const stubs=`
import Foundation
struct Coordinate {var latitude:Double;var longitude:Double}
struct CLVisit {var arrivalDate:Date;var departureDate:Date;var coordinate:Coordinate;var horizontalAccuracy:Double}
enum CMAuthorizationStatus {case authorized,denied,notDetermined}
struct CMPedometerData {var numberOfSteps:NSNumber;var startDate:Date;var endDate:Date;var distance:NSNumber?}
final class CMPedometer {
 static var status=CMAuthorizationStatus.authorized
 static var calls=0
 static var callbacks:[(CMPedometerData?,Error?)->Void]=[]
 static func isStepCountingAvailable()->Bool {true}
 static func isDistanceAvailable()->Bool {true}
 static func authorizationStatus()->CMAuthorizationStatus {status}
 func queryPedometerData(from:Date,to:Date,withHandler handler:@escaping (CMPedometerData?,Error?)->Void) {Self.calls+=1;Self.callbacks.append(handler)}
}
`;
 const source=fs.readFileSync(root+'DrivingResearchCrossChecks.swift','utf8').replace('import CoreMotion','').replace('import CoreLocation','');
 const main=`
@main struct Run {
 @MainActor static func settle() async {for _ in 0..<20 {await Task.yield()};try? await Task.sleep(nanoseconds:20_000_000)}
 @MainActor static func main() async throws {
  let suite="fuel-cross-check-test-"+UUID().uuidString
  let defaults=UserDefaults(suiteName:suite)!
  defer {defaults.removePersistentDomain(forName:suite)}
  let now=Date().timeIntervalSince1970
  defaults.set(now-1000,forKey:"research.crossChecksSince")
  let folder=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer {try? FileManager.default.removeItem(at:folder)}
  let store=try DrivingResearchStore(directory:folder)
  func terminal(_ id:String) throws {
   try store.append(ResearchEvent(kind:"visit_departure",payload:["visitId":id,"stationId":"123","startedAt":now-300,"lastInsideAt":now-30],now:now))
  }
  var outputs:[[String:Any]]=[]
  let emit:(String,[String:Any])->Bool={kind,p in outputs.append(p);try! store.append(ResearchEvent(kind:kind,payload:p));return true}
  let id=UUID().uuidString
  try terminal(id)
  let service=DrivingResearchCrossChecks(defaults:defaults)
  service.start(store:store,emit:emit);service.drain()
  assert(CMPedometer.calls==1,"Overlapping drains must not issue duplicate sensor queries")
  let data=CMPedometerData(numberOfSteps:0,startDate:Date(timeIntervalSince1970:now-300),endDate:Date(timeIntervalSince1970:now-30),distance:0)
  CMPedometer.callbacks.removeFirst()(data,nil);await settle()
  assert(outputs.count==1 && outputs[0]["steps"] as? Int == 0)
  let remaining=try store.pendingPedometerVisits(since:now-1000);assert(remaining.isEmpty)
  let restored=DrivingResearchCrossChecks(defaults:defaults)
  restored.start(store:store,emit:emit)
  assert(CMPedometer.calls==1,"Durable completion must survive relaunch")
  try terminal(UUID().uuidString);restored.drain()
  assert(CMPedometer.calls==2)
  restored.stop();CMPedometer.callbacks.removeFirst()(data,nil);await settle()
  assert(outputs.count==1,"An in-flight callback must not write after pause")
  // Recreate the pre-pause boundary only in this fixture to exercise an unknown result.
  defaults.set(now-1000,forKey:"research.crossChecksSince")
  CMPedometer.status = .denied
  restored.start(store:store,emit:emit);await settle()
  assert(CMPedometer.calls==2,"Denied authorization must never issue a query/prompt")
  assert(outputs.count==2 && outputs[1]["status"] as? String == "not_authorized" && outputs[1]["steps"] == nil)
  let station=ResearchStation(id:"123",name:"Fixture",latitude:27,longitude:-82)
  let v=CLVisit(arrivalDate:Date(timeIntervalSince1970:now-300),departureDate:Date(timeIntervalSince1970:now-30),coordinate:Coordinate(latitude:27,longitude:-82),horizontalAccuracy:20)
  restored.visit(v,stations:[station]);restored.visit(v,stations:[station])
  assert(outputs.count==3,"Duplicate Apple visit must not generate duplicate research records")
  restored.stop();restored.visit(v,stations:[station]);assert(outputs.count==3)
  restored.erase();assert(defaults.stringArray(forKey:"research.systemVisitKeys")==nil)
  assert(ResearchPedometerWindow(visitStart:now-3000,visitEnd:now-30,collectingSince:now-4000,now:now)!.truncated)
  let limited=ResearchPedometerWindow(visitStart:now-300,visitEnd:now-30,collectingSince:now-100,now:now)!
  assert(limited.start==now-100 && limited.truncated,"Never query before collection began")
  assert(ResearchPedometerWindow(visitStart:now,visitEnd:now-1,collectingSince:now-100,now:now)==nil)
  func fields(_ lat:Double=27,_ acc:Double=20,_ arrival:Double?=nil,_ departure:Double?=nil)->[String:Any]? {
   ResearchSystemVisitPolicy.payload(latitude:lat,longitude:-82,accuracy:acc,arrival:arrival,departure:departure,now:now,collectingSince:now-1000,stations:[station])
  }
  assert(fields(27,20,now-100,nil) != nil,"Arrival-only visits are valid")
  assert(fields(27,20,nil,now-10) != nil,"Departure-only visits are valid")
  assert(fields()==nil && fields(28,20,now-100,now-10)==nil)
  assert(fields(27,101,now-100,now-10)==nil && fields(27,20,now-2000,now-10)==nil)
  assert(fields(27,20,now-10,now-100)==nil && fields(27,20,now+10,nil)==nil)
  CMPedometer.status = .authorized
  defaults.set(now-1000,forKey:"research.crossChecksSince")
  try terminal(UUID().uuidString)
  let timeout=DrivingResearchCrossChecks(defaults:defaults,timeoutNanoseconds:1_000_000)
  timeout.start(store:store,emit:emit);await settle()
  let count=outputs.count
  assert(outputs.last?["timedOut"] as? Bool == true && outputs.last?["steps"] == nil)
  CMPedometer.callbacks.removeFirst()(data,nil);await settle()
  assert(outputs.count==count,"Late callback must not overwrite a timeout")
  timeout.stop()
  print("PASS: durable completion, coalescing, pause, timeout, unknown versus zero, station/time/accuracy scope, partial visits, deduplication, deletion")
 }
}
`;
 try {
  const file=path.join(folder,'main.swift');fs.writeFileSync(file,stubs+source+main);
  const binary=path.join(folder,'test');
  execFileSync('swiftc',['-parse-as-library',root+'DrivingResearchModels.swift',root+'DrivingResearchStore.swift',root+'DrivingResearchCrossCheckPolicy.swift',file,'-lsqlite3','-o',binary],{timeout:60000,stdio:'pipe'});
  process.stdout.write(execFileSync(binary,{timeout:30000,encoding:'utf8'}));
 } finally {fs.rmSync(folder,{recursive:true,force:true})}
});
