const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
test('real native usage handler validates target, drains independently of research and completes once on expiry',()=>{
 const source=fs.readFileSync('modules/fuel-up-driving-activity/ios/Telemetry/InstallationPushHandler.swift','utf8').replace('import UIKit','');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fuel-installation-push-'));
 try {
 fs.writeFileSync(path.join(dir,'main.swift'),`
import Foundation
enum UIBackgroundFetchResult: Equatable {case newData,noData,failed}
struct InstallationIdentity { let id:String; static func load() throws -> Self { Self(id:"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa") } }
// Deliberately no research collector or notification-authorization objects exist.
@MainActor final class InstallationSync {
 static let shared=InstallationSync();var slow=false,success=true,calls=0,cancelled=false
 func sync(requestID:String?) async -> Bool {
  calls+=1
  if slow {do {try await Task.sleep(for:.seconds(40))} catch {cancelled=true}}
  return success
 }
}
${source}
@main struct Main {
 @MainActor static func main() async {
  let push:[AnyHashable:Any]=["requestId":UUID().uuidString,"installationId":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","aps":["content-available":1]]
  func invoke(_ payload:[AnyHashable:Any]) async -> UIBackgroundFetchResult {
   await withCheckedContinuation { done in InstallationPushHandler.handle(payload){done.resume(returning:$0)} }
  }
  for key in ["requestId","installationId","aps"] {
   var invalid=push;invalid.removeValue(forKey:key)
   let result=await invoke(invalid);assert(result == .noData)
  }
  var wrong=push;wrong["installationId"]=UUID().uuidString
  let mismatch=await invoke(wrong);assert(mismatch == .noData && InstallationSync.shared.calls==0)
  let success=await invoke(push);assert(success == .newData)
  InstallationSync.shared.success=false
  let incomplete=await invoke(push);assert(incomplete == .noData)
  InstallationSync.shared.slow=true;var calls=0
  let expired:UIBackgroundFetchResult=await withCheckedContinuation { done in
   InstallationPushHandler.handle(push){result in calls+=1;if calls==1{done.resume(returning:result)}}
  }
  try? await Task.sleep(for:.milliseconds(100))
  assert(expired == .failed && calls==1 && InstallationSync.shared.cancelled)
  print("PASS: target isolation, no research/alert dependency, incomplete drain, timeout, callback once")
 }
}`);
 execFileSync('swiftc',['-parse-as-library',path.join(dir,'main.swift'),'-o',path.join(dir,'test')],{timeout:60000});
 assert.match(execFileSync(path.join(dir,'test'),{encoding:'utf8',timeout:35000}),/PASS:/);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
