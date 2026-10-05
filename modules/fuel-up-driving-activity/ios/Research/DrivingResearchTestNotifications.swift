import Foundation
import Combine
import UIKit
import UserNotifications

@MainActor
final class DrivingResearchTestNotifications: ObservableObject {
  static let shared = DrivingResearchTestNotifications()
  nonisolated static let category = "fuelup.research.test.v1"
  nonisolated static let prefix = "research-test:"
  @Published private(set) var tests:[ResearchNotificationTest] = []
  @Published var openTestID:String?
  private let store=DrivingResearchTestStore.shared
  private let transport=DrivingResearchTransport()
  private var flushing:Task<Void,Never>?

  func refresh() {tests=(try? store.all()) ?? []}
  func receive(_ records:Any) async throws {
    let remote=try JSONDecoder().decode([ResearchNotificationTest].self,from:JSONSerialization.data(withJSONObject:records))
    let removed=try store.reconcile(remote)
    for id in removed {removeNotification(id);if openTestID==id {openTestID=nil}}
    for test in try store.all() where test.status=="queued" && test.delivery != "apns" {
      // Claim before scheduling. Repeated control checks never repeat a prompt.
      try store.update(test.id) {$0.status="preparing";$0.dirty=true}
      let outcome=await schedule(test)
      try store.update(test.id) {if $0.label==nil && $0.status=="preparing" {$0.status=outcome;$0.dirty=true}}
    }
    refresh();await flush()
  }
  nonisolated static func receivePush(_ userInfo:[AnyHashable:Any]) throws {
    guard UserDefaults.standard.bool(forKey:DrivingResearchCollector.consentKey),
      let payload=userInfo["researchTest"] as? [String:Any],
      let participant=payload["participantId"] as? String,participant == (try ResearchIdentity.load()).id,
      let id=userInfo["testId"] as? String,payload["id"] as? String == id else{return}
    let test=try JSONDecoder().decode(ResearchNotificationTest.self,from:JSONSerialization.data(withJSONObject:payload))
    _=try DrivingResearchTestStore.shared.receivePush(test)
  }
  func answer(_ id:String,label:String) {
    do {
      guard try store.answer(id,label:label) else{return}
      removeNotification(id);refresh()
      Task {await flush()}
    } catch {DrivingResearchCollector.shared.issue="Test answer wasn't saved. Try again."}
  }
  func flush() async {
    if let flushing {await flushing.value;return}
    let task=Task {
      var background:UIBackgroundTaskIdentifier = .invalid
      background=UIApplication.shared.beginBackgroundTask(withName:"Save notification test") { [weak self] in self?.flushing?.cancel() }
      defer {if background != .invalid {UIApplication.shared.endBackgroundTask(background)};refresh()}
      do {
        let identity=try ResearchIdentity.load()
        while let test=try store.all().first(where:{$0.dirty==true}) {
          try Task.checkCancellation()
          var fields:[String:Any]=["testId":test.id,"status":test.status]
          if let label=test.label {fields["label"]=label}
          if let time=test.responseAt {fields["responseAt"]=time}
          let response=try await transport.send("testStatus",identity:identity,fields:fields)
          try Task.checkCancellation()
          if response["saved"] as? Bool == true {try store.acknowledge(test)}
          else if response["saved"] as? Bool == false {try store.remove(test.id);removeNotification(test.id)}
          else {throw URLError(.cannotParseResponse)}
        }
      } catch { /* Test-only outbox retries on the next connected control check. */ }
    }
    flushing=task;await task.value;flushing=nil
  }
  func erase() throws {
    flushing?.cancel()
    for test in try store.all() {removeNotification(test.id)}
    try store.erase();openTestID=nil;refresh()
  }
  func removeNotification(_ id:String) {
    let center=UNUserNotificationCenter.current(),key=Self.prefix+id
    center.removePendingNotificationRequests(withIdentifiers:[key])
    center.removeDeliveredNotifications(withIdentifiers:[key])
    center.getDeliveredNotifications {items in
      center.removeDeliveredNotifications(withIdentifiers:items.filter{$0.request.content.categoryIdentifier == Self.category && $0.request.content.userInfo["testId"] as? String == id}.map{$0.request.identifier})
    }
  }
  private func schedule(_ test:ResearchNotificationTest) async -> String {
    DrivingResearchNotifications.shared.install()
    let center=UNUserNotificationCenter.current(),settings=await center.notificationSettings()
    guard [.authorized,.provisional,.ephemeral].contains(settings.authorizationStatus) else{return "permission_missing"}
    let content=UNMutableNotificationContent()
    content.title=test.title;content.subtitle=ResearchConfirmation.notificationSubtitle
    content.categoryIdentifier=Self.category;content.threadIdentifier="fuelup.research.tests"
    content.userInfo=["testId":test.id];content.sound = .default;content.interruptionLevel = .active
    do {
      guard let bundleURL=Bundle.main.url(forResource:"FuelUpResearch",withExtension:"bundle"),
            let bundle=Bundle(url:bundleURL),let source=bundle.url(forResource:"fuelup-test-blue",withExtension:"png") else {return "schedule_failed"}
      let temporary=FileManager.default.temporaryDirectory.appendingPathComponent("research-test-\(test.id).png")
      if FileManager.default.fileExists(atPath:temporary.path) {try FileManager.default.removeItem(at:temporary)}
      try FileManager.default.copyItem(at:source,to:temporary)
      defer {try? FileManager.default.removeItem(at:temporary)}
      content.attachments=[try UNNotificationAttachment(identifier:"fuelup-blue",url:temporary,options:nil)]
      try await center.add(UNNotificationRequest(identifier:Self.prefix+test.id,content:content,
        trigger:UNTimeIntervalNotificationTrigger(timeInterval:1,repeats:false)))
      return "scheduled"
    } catch {return "schedule_failed"}
  }
}
