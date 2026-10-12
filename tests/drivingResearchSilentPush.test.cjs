const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
test('native silent wake ignores other pushes and paused research, uploads, and completes once on expiration',()=>{
 const source=fs.readFileSync('modules/fuel-up-driving-activity/ios/Research/DrivingResearchLifecycle.swift','utf8');
 const start=source.indexOf('  public func application(_ application: UIApplication, didReceiveRemoteNotification');
 const end=source.indexOf('  public func application(_ application:UIApplication,didRegister',start);
 const method=source.slice(start,end).replace('public func','func');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fuel-silent-push-'));
 try {
 fs.writeFileSync(path.join(dir,'main.swift'),`
import Foundation
class UIApplication {}
enum UIBackgroundFetchResult: Equatable {case newData,noData,failed}
@MainActor final class InstallationTelemetry {
 static let shared=InstallationTelemetry();var flushes=0
 func flushForBackgroundPush(){flushes+=1}
}
@MainActor final class DrivingResearchCollector {
 static let shared=DrivingResearchCollector();var consented=true,enabled=true,prepares=0
 func prepare(){prepares+=1}
}
@MainActor final class DrivingResearchSync {
 static let shared=DrivingResearchSync();var slow=false,expires=0,runs=0
 func expire(){expires+=1}
 func backgroundWork() async {
  runs+=1
  if slow {try? await Task.sleep(for:.seconds(40));return}
  UserDefaults.standard.set(Date(),forKey:"research.lastUpload")
 }
}
@MainActor enum InstallationPushHandler { static func handle(_ payload: [AnyHashable:Any], completion: @escaping (UIBackgroundFetchResult)->Void) { completion(.noData) } }
class Delegate {${method}}
@main struct Main {
 @MainActor static func main() async {
  let delegate=Delegate(),app=UIApplication()
  let push:[AnyHashable:Any]=["type":"fuelup.research.sync.v1","requestId":UUID().uuidString,"aps":["content-available":1]]
  func invoke(_ payload:[AnyHashable:Any]) async -> UIBackgroundFetchResult {
   await withCheckedContinuation { done in delegate.application(app,didReceiveRemoteNotification:payload){done.resume(returning:$0)} }
  }
  let other=await invoke(["aps":["alert":"hello"]]);assert(other == .noData)
  DrivingResearchCollector.shared.consented=false
  let unconsented=await invoke(push);assert(unconsented == .noData)
  DrivingResearchCollector.shared.consented=true;DrivingResearchCollector.shared.enabled=false
  let paused=await invoke(push);assert(paused == .noData)
  assert(DrivingResearchSync.shared.runs==0 && InstallationTelemetry.shared.flushes==0)
  DrivingResearchCollector.shared.enabled=true
  let uploaded=await invoke(push);assert(uploaded == .newData)
  assert(DrivingResearchSync.shared.runs==1 && InstallationTelemetry.shared.flushes==1)
  DrivingResearchSync.shared.slow=true
  var calls=0
  let expired:UIBackgroundFetchResult=await withCheckedContinuation { done in
   delegate.application(app,didReceiveRemoteNotification:push){result in calls+=1;if calls==1{done.resume(returning:result)}}
  }
  try? await Task.sleep(for:.milliseconds(100))
  assert(expired == .failed && calls==1 && DrivingResearchSync.shared.expires==1)
  UserDefaults.standard.removeObject(forKey:"research.lastUpload")
  print("PASS: malformed, consent, pause, upload, timeout and exactly-once completion")
 }
}`);
 execFileSync('swiftc',['-parse-as-library',path.join(dir,'main.swift'),'-o',path.join(dir,'test')],{timeout:60000});
 assert.match(execFileSync(path.join(dir,'test'),{encoding:'utf8',timeout:35000}),/PASS:/);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
