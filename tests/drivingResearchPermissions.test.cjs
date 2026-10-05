const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Run the production permission methods against controllable system prompts.
// This exercises interleaved screen/foreground/setup calls without changing
// permission decisions on a tester's phone.
test('research permission setup automatically requests notifications and serializes system prompts', () => {
  const source = fs.readFileSync('modules/fuel-up-driving-activity/ios/Research/DrivingResearchCollector.swift', 'utf8');
  const method = name => {
    const start = source.indexOf(`  ${name}`);
    assert.ok(start >= 0, name);
    const open = source.indexOf('{', start);
    let depth = 1, end = open + 1;
    for (; depth && end < source.length; end++) {
      if (source[end] === '{') depth++;
      if (source[end] === '}') depth--;
    }
    return source.slice(start, end);
  };
  const methods = ['func requestPermissions()', 'private func continueLocationSetup()',
    'private func continueMotionSetup()', 'private func requestMotion()', 'private func finishPermissionSetup()',
    'func locationManagerDidChangeAuthorization(', 'func requestStopNotifications()', 'func researchScreenBecameActive()'].map(method).join('\n');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'fuel-research-permissions-'));
  try {
    fs.writeFileSync(path.join(folder, 'main.swift'), `
import Foundation
@MainActor final class UIApplication {
  static let shared=UIApplication()
  enum State {case active,inactive,background}
  var applicationState=State.active
}
@MainActor final class DrivingResearchNotifications {
  static let shared=DrivingResearchNotifications()
  var value="Not requested", requests=0
  var response:CheckedContinuation<Bool,Never>?
  func permission() async -> String {value}
  func requestPermission() async -> Bool {
    requests+=1
    return await withCheckedContinuation {response=$0}
  }
  func answer(_ allowed:Bool) {
    value=allowed ? "On" : "Off"
    response?.resume(returning:allowed);response=nil
  }
}
@MainActor final class LocationManager {
  enum Authorization {case notDetermined,authorizedWhenInUse,authorizedAlways,denied,restricted}
  var authorizationStatus=Authorization.notDetermined
  var requests=0
  func requestWhenInUseAuthorization(){requests+=1}
  func requestAlwaysAuthorization(){requests+=1}
}
typealias CLLocationManager=LocationManager
@MainActor final class CMMotionActivityManager {
  enum Authorization {case notDetermined,authorized,denied}
  static var authorization=Authorization.authorized
  static func authorizationStatus()->Authorization {authorization}
  static func isActivityAvailable()->Bool {true}
  var requests=0
  var response:(([Int]?,Error?)->Void)?
  func queryActivityStarting(from:Date,to:Date,to queue:OperationQueue,withHandler handler:@escaping ([Int]?,Error?)->Void) {
    requests+=1;response=handler
  }
  func answer(_ allowed:Bool) {
    Self.authorization=allowed ? .authorized : .denied
    response?([],nil);response=nil
  }
}
@MainActor final class Collector {
  var consented=false,enabled=false,permissionSetup=false,pendingLocationSetup=false,pendingMotionSetup=false,motionRequestInFlight=false,locationSetupStarted=false
  var permissionRevision=0,configured=false
  var notificationPermissionTask:Task<Void,Never>?
  var notificationPermission="Checking",status=""
  let manager=LocationManager()
  let activity=CMMotionActivityManager()
  func checkTrackingHealth() {}
  func resume(reason:String){continueMotionSetup();continueLocationSetup()}
  func foreground(){resume(reason:"foreground")}
${methods}
}
@main struct PermissionTests {
  @MainActor static func settle() async {for _ in 0..<100 {await Task.yield()}}
  @MainActor static func main() async {
    let system=DrivingResearchNotifications.shared, app=UIApplication.shared
    let c=Collector()
    await c.researchScreenBecameActive()
    c.requestPermissions();await settle()
    assert(system.requests==0 && c.manager.requests==0,"No consent means no prompts")
    c.consented=true;app.applicationState = .background
    await c.researchScreenBecameActive();c.requestPermissions();await settle()
    assert(system.requests==0,"Background callbacks cannot ask permission")
    app.applicationState = .active
    let screen=Task {await c.researchScreenBecameActive()}
    await settle();assert(system.requests==1)
    c.requestPermissions();c.requestPermissions();await settle()
    assert(system.requests==1 && c.manager.requests==0,"Screen and setup share the same notification prompt")
    app.applicationState = .inactive;system.answer(true)
    await screen.value;await settle()
    assert(c.manager.requests==0,"Location waits for alert dismissal")
    app.applicationState = .active;c.foreground();await settle()
    assert(c.manager.requests==1 && c.notificationPermission=="On")
    c.foreground();assert(c.manager.requests==1,"Foreground cannot duplicate the location prompt")
    let denied=Collector();denied.consented=true;system.value="Off"
    await denied.researchScreenBecameActive();denied.requestPermissions();await settle()
    assert(system.requests==1 && denied.manager.requests==1,"Denied notifications do not loop or block other setup")
    let enrolled=Collector();enrolled.consented=true;system.value="Not requested"
    let opening=Task {await enrolled.researchScreenBecameActive()}
    await settle();assert(system.requests==2,"Existing participants are prompted on screen entry")
    system.answer(false);await opening.value
    await enrolled.researchScreenBecameActive()
    assert(system.requests==2 && enrolled.notificationPermission=="Off")
    system.value="On";CMMotionActivityManager.authorization = .notDetermined
    let motion=Collector();motion.consented=true;motion.enabled=true
    motion.manager.authorizationStatus = .authorizedWhenInUse
    await motion.researchScreenBecameActive()
    motion.locationManagerDidChangeAuthorization(motion.manager)
    assert(motion.manager.requests==0,"An initial location delegate callback cannot bypass motion setup")
    await settle()
    assert(motion.activity.requests==1 && motion.manager.requests==0,"Motion is requested before the Always upgrade, including existing participants")
    app.applicationState = .inactive;motion.activity.answer(true);await settle()
    assert(motion.manager.requests==0)
    app.applicationState = .active;motion.foreground();await settle()
    assert(motion.manager.requests==1 && !motion.permissionSetup,"Unchanged When In Use authorization cannot leave setup hanging")
    CMMotionActivityManager.authorization = .notDetermined
    let location=Collector();location.consented=true
    location.requestPermissions();await settle()
    assert(location.activity.requests==1 && location.manager.requests==0)
    location.activity.answer(false);await settle()
    assert(location.manager.requests==1,"Motion denial still allows the rest of setup")
    app.applicationState = .inactive;location.manager.authorizationStatus = .authorizedWhenInUse
    location.locationManagerDidChangeAuthorization(location.manager)
    assert(location.manager.requests==1)
    app.applicationState = .active;location.foreground()
    assert(location.manager.requests==2 && !location.permissionSetup,"Inactive location callbacks resume the permission flow")
    print("PASS: consent, foreground, coalescing, sequential prompts, denial, existing participants")
  }
}
`);
    const binary = path.join(folder, 'permissions');
    execFileSync('swiftc', ['-parse-as-library', path.join(folder, 'main.swift'), '-o', binary], { timeout: 60000 });
    assert.match(execFileSync(binary, { encoding: 'utf8', timeout: 15000 }), /PASS:/);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

test('the research screen uses automatic setup after consent dismissal, with no separate notification button', () => {
  const view = fs.readFileSync('modules/fuel-up-driving-activity/ios/Research/DrivingResearchView.swift', 'utf8');
  assert.doesNotMatch(view, /Enable Stop Notifications|Button[^\n]*requestStopNotifications/);
  assert.match(view, /if !collector\.consented && selectedVisit == nil && selectedTest == nil/);
  assert.match(view, /if !showConsent \{await collector\.researchScreenBecameActive\(\)\}/);
  assert.match(view, /onDismiss:[\s\S]*if shouldEnable \{await collector\.enable\(\)\}/);
});
