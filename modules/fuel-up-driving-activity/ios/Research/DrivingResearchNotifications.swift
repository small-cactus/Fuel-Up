import Foundation
import UIKit
import UserNotifications
import ExpoNotifications

// Intercept only our category. Forward all other notifications to Expo's existing
// delegate, avoiding duplicate completion calls from its delegate fan-out.
final class DrivingResearchNotifications: NSObject, UNUserNotificationCenterDelegate, @unchecked Sendable {
  static let shared = DrivingResearchNotifications()
  private var forwarding: UNUserNotificationCenterDelegate?
  private let center = UNUserNotificationCenter.current()
  private static let healthCategory="fuelup.research.health"
  private static let healthID="fuelup.research.tracking-health"

  func install() {
    _ = NotificationCenterManager.shared
    if center.delegate !== self { forwarding = center.delegate; center.delegate = self }
    center.getNotificationCategories { [center] categories in
      let actions = ResearchConfirmation.actions.map { item in
        UNNotificationAction(identifier: item.0, title: NSLocalizedString(item.1, comment: ""), options: [],
                             icon: UNNotificationActionIcon(systemImageName: item.2))
      }
      let category = UNNotificationCategory(identifier: ResearchConfirmation.category, actions: actions,
        intentIdentifiers: [], hiddenPreviewsBodyPlaceholder: "Confirm your station stop",
        options: [.customDismissAction])
      let testCategory = UNNotificationCategory(identifier: DrivingResearchTestNotifications.category, actions: actions,
        intentIdentifiers: [], hiddenPreviewsBodyPlaceholder: "Confirm your station stop", options: [.customDismissAction])
      center.setNotificationCategories(Set(categories.filter { $0.identifier != ResearchConfirmation.category && $0.identifier != DrivingResearchTestNotifications.category && $0.identifier != Self.healthCategory }).union([category,testCategory,UNNotificationCategory(identifier:Self.healthCategory,actions:[],intentIdentifiers:[],options:[])]))
    }
  }
  func requestPermission() async -> Bool {
    install()
    return (try? await center.requestAuthorization(options: [.alert, .sound])) ?? false
  }
  func permission() async -> String {
    let settings = await center.notificationSettings()
    switch settings.authorizationStatus {
    case .authorized: return settings.alertSetting == .enabled ? "On" : "Alerts off"
    case .provisional, .ephemeral: return "Quiet delivery"
    case .denied: return "Off"
    default: return "Not requested"
    }
  }
  func scheduleTrackingHealth(_ message:String) async -> Bool {
    install()
    let settings=await center.notificationSettings()
    guard [.authorized,.provisional,.ephemeral].contains(settings.authorizationStatus) else{return false}
    let content=UNMutableNotificationContent()
    content.title=NSLocalizedString("Tracking needs attention 👀", comment: "")
    content.body=message+" "+NSLocalizedString("Tap to review.", comment: "")
    content.categoryIdentifier=Self.healthCategory
    content.threadIdentifier="fuelup.research.health"
    content.sound = .default
    content.interruptionLevel = .active
    do {
      try await center.add(UNNotificationRequest(identifier:Self.healthID,content:content,
        trigger:UNTimeIntervalNotificationTrigger(timeInterval:3,repeats:false)))
      return true
    } catch {return false}
  }
  func clearTrackingHealth() {
    center.removePendingNotificationRequests(withIdentifiers:[Self.healthID])
    center.removeDeliveredNotifications(withIdentifiers:[Self.healthID])
  }
  func schedule(_ visit: ResearchVisit) async -> String {
    install()
    let settings = await center.notificationSettings()
    guard [.authorized, .provisional, .ephemeral].contains(settings.authorizationStatus) else { return "permission_missing" }
    let content = UNMutableNotificationContent()
    content.title = ResearchConfirmation.notificationTitle(for: visit)
    content.subtitle = ResearchConfirmation.notificationSubtitle
    content.categoryIdentifier = ResearchConfirmation.category
    content.threadIdentifier = "fuelup.research.stops"
    content.sound = .default
    content.interruptionLevel = .active
    content.userInfo = ["visit": String(decoding: (try? JSONEncoder().encode(visit)) ?? Data(), as: UTF8.self)]
    let request = UNNotificationRequest(identifier: ResearchConfirmation.prefix + visit.id, content: content,
                                        trigger: UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false))
    do { try await center.add(request); return "scheduled" }
    catch { return "schedule_failed" }
  }
  func remove(_ visitID: String) {
    let id = ResearchConfirmation.prefix + visitID
    center.removePendingNotificationRequests(withIdentifiers: [id])
    center.removeDeliveredNotifications(withIdentifiers: [id])
  }
  func cancelAll() {
    center.getPendingNotificationRequests { [center] requests in
      center.removePendingNotificationRequests(withIdentifiers: requests.map(\.identifier).filter { $0.hasPrefix(ResearchConfirmation.prefix) })
    }
    center.getDeliveredNotifications { [center] notifications in
      center.removeDeliveredNotifications(withIdentifiers: notifications.map { $0.request.identifier }.filter { $0.hasPrefix(ResearchConfirmation.prefix) })
    }
  }
  func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                              withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
    guard [ResearchConfirmation.category,DrivingResearchTestNotifications.category,Self.healthCategory].contains(notification.request.content.categoryIdentifier) else {
      if let forwarding, forwarding.responds(to: #selector(UNUserNotificationCenterDelegate.userNotificationCenter(_:willPresent:withCompletionHandler:))) {
        forwarding.userNotificationCenter?(center, willPresent: notification, withCompletionHandler: completionHandler)
      } else { completionHandler([]) }
      return
    }
    if notification.request.content.categoryIdentifier == DrivingResearchTestNotifications.category {
      try? DrivingResearchTestNotifications.receivePush(notification.request.content.userInfo)
      Task { @MainActor in await DrivingResearchTestNotifications.shared.flush() }
    }
    completionHandler([.banner, .list, .sound])
  }
  func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                              withCompletionHandler completionHandler: @escaping () -> Void) {
    if response.notification.request.content.categoryIdentifier == Self.healthCategory {
      if response.actionIdentifier == UNNotificationDefaultActionIdentifier {
        Task { @MainActor in
          guard DrivingResearchCollector.shared.consented else{return}
          if let url=URL(string:"fuelup:///driving-research") {UIApplication.shared.open(url)}
        }
      }
      completionHandler();return
    }
    if response.notification.request.content.categoryIdentifier == DrivingResearchTestNotifications.category {
      defer {completionHandler()}
      guard UserDefaults.standard.bool(forKey:DrivingResearchCollector.consentKey),
            let id=response.notification.request.content.userInfo["testId"] as? String else{return}
      do {
        try DrivingResearchTestNotifications.receivePush(response.notification.request.content.userInfo)
        guard try DrivingResearchTestStore.shared.all().contains(where:{$0.id==id && $0.expiresAt>Date().timeIntervalSince1970}) else{return}
        if response.actionIdentifier == UNNotificationDefaultActionIdentifier {
          Task { @MainActor in
            DrivingResearchTestNotifications.shared.refresh()
            DrivingResearchTestNotifications.shared.openTestID=id
            if let url=URL(string:"fuelup:///driving-research") {UIApplication.shared.open(url)}
          }
        } else if let label=ResearchConfirmation.label(for:response.actionIdentifier) {
          try DrivingResearchTestStore.shared.answer(id,label:label)
          Task { @MainActor in
            DrivingResearchTestNotifications.shared.removeNotification(id)
            DrivingResearchTestNotifications.shared.refresh()
            await DrivingResearchTestNotifications.shared.flush()
          }
        } else if response.actionIdentifier == UNNotificationDismissActionIdentifier {
          try DrivingResearchTestStore.shared.answer(id,label:nil)
          Task { @MainActor in await DrivingResearchTestNotifications.shared.flush() }
        }
      } catch {
        Task { @MainActor in DrivingResearchCollector.shared.issue="Test answer wasn't saved. Try again in Test Notifications." }
      }
      return // A test can never fall through to the real research event store.
    }
    guard response.notification.request.content.categoryIdentifier == ResearchConfirmation.category else {
      if let forwarding, forwarding.responds(to: #selector(UNUserNotificationCenterDelegate.userNotificationCenter(_:didReceive:withCompletionHandler:))) {
        forwarding.userNotificationCenter?(center, didReceive: response, withCompletionHandler: completionHandler)
      } else { completionHandler() }
      return
    }
    defer { completionHandler() }
    guard UserDefaults.standard.bool(forKey: DrivingResearchCollector.consentKey),
          let text = response.notification.request.content.userInfo["visit"] as? String,
          let visit = try? JSONDecoder().decode(ResearchVisit.self, from: Data(text.utf8)) else { return }
    if response.actionIdentifier == UNNotificationDefaultActionIdentifier {
      Task { @MainActor in
        DrivingResearchCollector.shared.openConfirmation(visit)
        if let url = URL(string: "fuelup:///driving-research") { UIApplication.shared.open(url) }
      }
      return
    }
    // Persist synchronously before telling iOS we're finished, including a cold
    // background launch. A label does not depend on the React bridge or network.
    do {
      let folder = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("DrivingResearch", isDirectory: true)
      let store = try DrivingResearchStore(directory: folder)
      if let label = ResearchConfirmation.label(for: response.actionIdentifier),
         let payload = ResearchConfirmation.payload(visit: visit, label: label, source: "notification") {
        try store.append(ResearchEvent(kind: "visit_label", payload: payload))
        remove(visit.id)
      } else if response.actionIdentifier == UNNotificationDismissActionIdentifier {
        try store.append(ResearchEvent(kind: "visit_prompt", payload: ["visitId": visit.id, "stationId": visit.station.id,
          "status": "dismissed", "confirmationState": "unconfirmed", "schemaVersion": 1]))
      }
      Task { @MainActor in DrivingResearchCollector.shared.refreshConfirmations() }
    } catch {
      Task { @MainActor in DrivingResearchCollector.shared.issue = "Answer wasn't saved. Confirm this stop in Station Visits." }
    }
  }
  func userNotificationCenter(_ center: UNUserNotificationCenter, openSettingsFor notification: UNNotification?) {
    forwarding?.userNotificationCenter?(center, openSettingsFor: notification)
  }
}
