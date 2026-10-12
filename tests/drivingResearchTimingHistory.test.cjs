const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

test('native timing history preserves collection boundaries, durable progress and late callback safety', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fuel-timing-history-'));
  const source = fs.readFileSync('modules/fuel-up-driving-activity/ios/Research/DrivingResearchTimingHistory.swift', 'utf8').replace('import CoreMotion', '');
  const stubs = `
import Foundation
enum CMAuthorizationStatus {case authorized,denied}
enum Confidence:Int {case low,medium,high}
struct CMMotionActivity {
 var startDate:Date;var confidence=Confidence.high
 var automotive=true;var stationary=false;var walking=false;var running=false;var cycling=false;var unknown=false
}
final class CMMotionActivityManager {
 static var authorization=CMAuthorizationStatus.authorized
 static var callbacks:[([CMMotionActivity]?,Error?)->Void]=[]
 static var windows:[(Double,Double)]=[]
 static func isActivityAvailable()->Bool {true}
 static func authorizationStatus()->CMAuthorizationStatus {authorization}
 func queryActivityStarting(from:Date,to:Date,to queue:OperationQueue,withHandler handler:@escaping ([CMMotionActivity]?,Error?)->Void) {
  Self.windows.append((from.timeIntervalSince1970,to.timeIntervalSince1970));Self.callbacks.append(handler)
 }
}
`;
  const main = `
@main struct Run {
 @MainActor static func settle() async {for _ in 0..<30 {await Task.yield()};try? await Task.sleep(nanoseconds:20_000_000)}
 @MainActor static func main() async throws {
  let suite="timing-"+UUID().uuidString;let defaults=UserDefaults(suiteName:suite)!
  defer {defaults.removePersistentDomain(forName:suite)}
  var now=1_000_000.0
  var out:[[String:Any]]=[];var save=true
  let emit:(String,[String:Any])->Bool={_,p in if save {out.append(p)};return save}
  let service=DrivingResearchTimingHistory(defaults:defaults,now:{now})
  service.start(emit:emit)
  assert(CMMotionActivityManager.windows.isEmpty,"First install must not query before collection boundary")
  now+=1200;service.drain();service.drain()
  assert(CMMotionActivityManager.windows.count==1,"Coalesce queries")
  let window=CMMotionActivityManager.windows.last!
  assert(window.0==1_000_000 && window.1==now-180)
  let samples=(0..<205).map {CMMotionActivity(startDate:Date(timeIntervalSince1970:window.0+Double($0)))}
  CMMotionActivityManager.callbacks.removeFirst()(samples,nil);await settle()
  assert(out.count==3 && out.allSatisfy {($0["activities"] as! [[String:Any]]).count<=100})
  assert(defaults.double(forKey:DrivingResearchTimingHistory.cursorKey)==window.1)
  for p in out {let data=try JSONSerialization.data(withJSONObject:p);assert(data.count < 32000)}
  let restored=DrivingResearchTimingHistory(defaults:defaults,now:{now})
  restored.start(emit:emit);assert(CMMotionActivityManager.windows.count==1,"Completed cursor survives relaunch")
  now+=1200;restored.drain();save=false
  CMMotionActivityManager.callbacks.removeFirst()([],nil);await settle()
  assert(defaults.double(forKey:DrivingResearchTimingHistory.cursorKey)==window.1,"Failed writes must not advance cursor")
  save=true;now+=1200;restored.drain();let count=out.count
  restored.stop(resetBoundary:true)
  CMMotionActivityManager.callbacks.removeFirst()(samples,nil);await settle()
  assert(out.count==count && defaults.object(forKey:DrivingResearchTimingHistory.sinceKey)==nil,"Pause invalidates callbacks and boundary")
  restored.start(emit:emit);now+=1200;restored.drain()
  assert(CMMotionActivityManager.windows.last!.0==now-1200,"Resume excludes paused time")
  CMMotionActivityManager.callbacks.removeFirst()(nil,NSError(domain:"fixture",code:1));await settle()
  assert(out.last?["status"] as? String == "query_failed" && defaults.object(forKey:DrivingResearchTimingHistory.cursorKey)==nil)
  restored.stop()
  defaults.set(now-10*86400,forKey:DrivingResearchTimingHistory.sinceKey)
  let timeout=DrivingResearchTimingHistory(defaults:defaults,now:{now},timeoutNanoseconds:1_000_000)
  timeout.start(emit:emit);await settle()
  assert(out.last?["timedOut"] as? Bool == true && out.last?["expiredHistorySeconds"] as! Double > 0)
  assert(CMMotionActivityManager.windows.last!.0==now-7*86400)
  let timedOutCount=out.count;CMMotionActivityManager.callbacks.removeFirst()([],nil);await settle()
  assert(out.count==timedOutCount,"Late result cannot overwrite timeout")
  timeout.stop(resetBoundary:true)
  CMMotionActivityManager.authorization = .denied
  let denied=DrivingResearchTimingHistory(defaults:defaults,now:{now})
  denied.start(emit:emit);now+=1200;let calls=CMMotionActivityManager.windows.count;denied.drain()
  assert(CMMotionActivityManager.windows.count==calls)
  denied.stop(resetBoundary:true)
  print("PASS timing history boundaries, chunks, cursor, write failure, pause, errors, expiry, timeout, permissions")
 }
}
`;
  try {
    const swift = path.join(directory, 'main.swift');
    const binary = path.join(directory, 'test');
    fs.writeFileSync(swift, stubs + source + main);
    execFileSync('swiftc', ['-parse-as-library', swift, '-o', binary], {timeout: 60000});
    execFileSync(binary, [], {timeout: 30000});
  } finally {fs.rmSync(directory, {recursive: true, force: true});}
});
