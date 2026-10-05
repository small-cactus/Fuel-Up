const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');

test('tracking alerts deduplicate incidents, recover, respect pause/setup and retry failed delivery',()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'research-health-'));
 try {
  fs.writeFileSync(path.join(folder,'main.swift'),`
import Foundation
@MainActor final class DrivingResearchNotifications {
 static let shared=DrivingResearchNotifications()
 var attempts=0,clears=0,allowed=true,hold=false
 var response:CheckedContinuation<Bool,Never>?
 func scheduleTrackingHealth(_ message:String) async -> Bool {
   attempts+=1
   if hold {return await withCheckedContinuation{response=$0}}
   return allowed
 }
 func clearTrackingHealth(){clears+=1}
}
@main struct Tests {
 @MainActor static func settle() async {for _ in 0..<100 {await Task.yield()}}
 @MainActor static func main() async throws {
  let key="research.healthAlerts.v1"
  UserDefaults.standard.removeObject(forKey:key)
  defer {UserDefaults.standard.removeObject(forKey:key)}
  let motion=ResearchTrackingIssue(id:"motion",message:"Allow Motion & Fitness.")
  let location=ResearchTrackingIssue(id:"location",message:"Allow location.")
  var state=ResearchHealthAlertState()
  assert(state.pending([motion])==[motion]);state.acknowledge([motion])
  state=try JSONDecoder().decode(ResearchHealthAlertState.self,from:JSONEncoder().encode(state))
  assert(state.pending([motion]).isEmpty,"Restart preserves incident acknowledgement")
  assert(state.pending([motion,location])==[location],"A newly missing permission is a new incident")
  _=state.pending([]);assert(state.pending([motion])==[motion],"Recovery rearms the same problem")
  let h=DrivingResearchHealth.shared,n=DrivingResearchNotifications.shared
  h.update([motion],enabled:true,settingUp:false);await settle()
  assert(n.attempts==1 && h.message==motion.message)
  h.update([motion],enabled:true,settingUp:false);await settle();assert(n.attempts==1)
  h.update([motion,location],enabled:true,settingUp:false);await settle();assert(n.attempts==2)
  let beforePartialRecovery=n.clears
  h.update([motion],enabled:true,settingUp:false);await settle()
  assert(n.attempts==2 && n.clears>beforePartialRecovery,"Resolved reasons must not remain in an old notification")
  h.update([],enabled:true,settingUp:false);await settle();assert(h.message==nil && n.clears>0)
  h.update([motion],enabled:true,settingUp:false);await settle();assert(n.attempts==3)
  h.update([motion],enabled:false,settingUp:false);await settle();assert(n.attempts==3 && h.message==nil)
  h.update([motion],enabled:true,settingUp:true);await settle();assert(n.attempts==3 && h.message==nil)
  h.update([motion],enabled:true,settingUp:false);await settle();assert(n.attempts==4)
  h.update([],enabled:true,settingUp:false);await settle()
  n.allowed=false
  h.update([location],enabled:true,settingUp:false);await settle();assert(n.attempts==5)
  n.allowed=true
  h.update([location],enabled:true,settingUp:false);await settle();assert(n.attempts==6,"Failed delivery does not consume the alert")
  h.update([location],enabled:true,settingUp:false);await settle();assert(n.attempts==6)
  h.update([],enabled:true,settingUp:false);await settle()
  n.hold=true
  h.update([motion],enabled:true,settingUp:false);await settle();assert(n.attempts==7 && n.response != nil)
  let clears=n.clears
  h.update([motion],enabled:false,settingUp:false)
  n.response?.resume(returning:true);n.response=nil;n.hold=false;await settle()
  assert(n.clears>clears && h.message==nil,"A pause racing notification scheduling cancels it")
  h.update([motion],enabled:true,settingUp:false);await settle();assert(n.attempts==8)
  print("PASS: persisted deduplication, recurrence, pause, setup, retries and races")
 }
}
`);
  const binary=path.join(folder,'health');
  execFileSync('swiftc',['-parse-as-library','modules/fuel-up-driving-activity/ios/Research/DrivingResearchHealth.swift',path.join(folder,'main.swift'),'-o',binary],{timeout:60000});
  assert.match(execFileSync(binary,{encoding:'utf8',timeout:15000}),/PASS:/);
 } finally {fs.rmSync(folder,{recursive:true,force:true});}
});
