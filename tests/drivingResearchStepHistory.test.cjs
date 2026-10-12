const test=require('node:test');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
test('step history enforces durable cursors, bounded catchup, pause and late callback safety',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fuel-step-history-'));
 const source=fs.readFileSync('modules/fuel-up-driving-activity/ios/Research/DrivingResearchStepHistory.swift','utf8').replace('import CoreMotion','');
 const stubs=`import Foundation
 enum Authorization {case authorized,denied}
 struct CMPedometerData {var startDate:Date;var endDate:Date;var numberOfSteps:NSNumber=12;var distance:NSNumber?=8;var floorsAscended:NSNumber?=nil;var floorsDescended:NSNumber?=nil;var averageActivePace:NSNumber?=nil}
 final class CMPedometer {
 static var authorization=Authorization.authorized
 static var callbacks:[(CMPedometerData?,Error?)->Void]=[]
 static var windows:[(Double,Double)]=[]
 static func isStepCountingAvailable()->Bool {true}
 static func isDistanceAvailable()->Bool {true}
 static func isFloorCountingAvailable()->Bool {false}
 static func authorizationStatus()->Authorization {authorization}
 func queryPedometerData(from:Date,to:Date,withHandler handler:@escaping(CMPedometerData?,Error?)->Void) {Self.windows.append((from.timeIntervalSince1970,to.timeIntervalSince1970));Self.callbacks.append(handler)}
 }
 `;
 const main=`@main struct Run {
 @MainActor static func settle() async {for _ in 0..<30 {await Task.yield()};try? await Task.sleep(nanoseconds:20_000_000)}
 @MainActor static func main() async throws {
 let suite="steps-"+UUID().uuidString, defaults=UserDefaults(suiteName:suite)!
 defer {defaults.removePersistentDomain(forName:suite)}
 var now=1_000_000.0, output:[[String:Any]]=[];var save=true
 let service=DrivingResearchStepHistory(defaults:defaults,now:{now})
 let emit:(String,[String:Any])->Bool={_,p in if save {output.append(p)};return save}
 service.start(emit:emit);assert(CMPedometer.windows.isEmpty)
 now+=7200;service.drain();service.drain();assert(CMPedometer.windows.count==1)
 for _ in 0..<12 {
  let w=CMPedometer.windows.last!;assert(w.1-w.0==300)
  CMPedometer.callbacks.removeFirst()(CMPedometerData(startDate:Date(timeIntervalSince1970:w.0),endDate:Date(timeIntervalSince1970:w.1)),nil);await settle()
 }
 assert(CMPedometer.windows.count==12 && CMPedometer.callbacks.isEmpty,"Bound per wake")
 assert(output.count==12 && output[0]["floorsAscended"]==nil)
 let cursor=defaults.double(forKey:DrivingResearchStepHistory.cursorKey)
 now+=1200;service.drain();save=false
 let w=CMPedometer.windows.last!
 CMPedometer.callbacks.removeFirst()(CMPedometerData(startDate:Date(timeIntervalSince1970:w.0),endDate:Date(timeIntervalSince1970:w.1)),nil);await settle()
 assert(defaults.double(forKey:DrivingResearchStepHistory.cursorKey)==cursor,"Do not acknowledge unwritten history")
 save=true;now+=1200;service.drain();let count=output.count
 service.stop(resetBoundary:true);CMPedometer.callbacks.removeFirst()(nil,NSError(domain:"late",code:1));await settle()
 assert(output.count==count && defaults.object(forKey:DrivingResearchStepHistory.sinceKey)==nil)
 service.start(emit:emit);now+=1200;service.drain();assert(CMPedometer.windows.last!.0==now-1200)
 CMPedometer.callbacks.removeFirst()(nil,NSError(domain:"fixture",code:1));await settle()
 assert(output.last?["status"] as? String=="query_failed" && defaults.object(forKey:DrivingResearchStepHistory.cursorKey)==nil)
 service.stop(resetBoundary:true);CMPedometer.authorization = .denied;service.start(emit:emit);now+=1200
 let windows=CMPedometer.windows.count;service.drain();assert(windows==CMPedometer.windows.count)
 print("PASS")
 }
 }`;
 try{fs.writeFileSync(path.join(dir,'main.swift'),stubs+source+main);execFileSync('swiftc',['-parse-as-library',path.join(dir,'main.swift'),'-o',path.join(dir,'run')]);execFileSync(path.join(dir,'run'),{timeout:30000});}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
});
