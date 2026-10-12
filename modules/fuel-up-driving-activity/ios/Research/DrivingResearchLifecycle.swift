import ExpoModulesCore
import UIKit

public final class DrivingResearchLifecycle: ExpoAppDelegateSubscriber {
  public func application(_ application:UIApplication,didFinishLaunchingWithOptions launchOptions:[UIApplication.LaunchOptionsKey:Any]?=nil)->Bool {
    Task { @MainActor in InstallationTelemetry.shared.start() }
    DrivingResearchNotifications.shared.install()
    DrivingResearchBackground.register()
    Task { @MainActor in DrivingResearchPushRegistration.shared.registerIfAllowed() }
    // Only resume an explicitly enrolled pilot. No React bridge or screen needed.
    if UserDefaults.standard.bool(forKey:DrivingResearchCollector.enabledKey) {
      Task { @MainActor in DrivingResearchCollector.shared.resume(reason:"native_launch") }
    }
    return true
  }
  public func applicationDidBecomeActive(_ application:UIApplication) {
    Task { @MainActor in InstallationTelemetry.shared.foreground() }
    Task { @MainActor in DrivingResearchPushRegistration.shared.registerIfAllowed() }
    Task { @MainActor in
      let collector=DrivingResearchCollector.shared
      if collector.enabled { collector.resume(reason:"foreground") }
      await collector.checkNotificationsOnAppOpen()
    }
  }
  public func applicationDidEnterBackground(_ application:UIApplication) {
    Task { @MainActor in
      InstallationTelemetry.shared.background()
      DrivingResearchCollector.shared.recordAppBackground()
    }
  }
  public func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String,
                          completionHandler: @escaping () -> Void) {
    Task { @MainActor in
      if !InstallationTelemetry.shared.handleBackgroundSession(identifier, completion: completionHandler) { completionHandler() }
    }
  }
  public func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any],
                          fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
    guard userInfo["type"] as? String == "fuelup.research.sync.v1",
          let requestID = userInfo["requestId"] as? String, UUID(uuidString: requestID) != nil,
          let aps = userInfo["aps"] as? [String: Any], aps["content-available"] as? Int == 1 else {
      completionHandler(.noData); return
    }
    Task { @MainActor in
      let collector = DrivingResearchCollector.shared
      // A push is only a wake hint. The authenticated control endpoint owns the
      // sync command; a notification can never enroll or unpause someone.
      guard collector.consented, collector.enabled else { completionHandler(.noData); return }
      collector.prepare()
      InstallationTelemetry.shared.flushForBackgroundPush()
      let before = UserDefaults.standard.object(forKey: "research.lastUpload") as? Date
      var finished = false
      var work: Task<Void, Never>?
      let timeout = Task { @MainActor in
        do { try await Task.sleep(for: .seconds(25)) } catch { return }
        guard !finished else { return }
        finished = true; work?.cancel(); DrivingResearchSync.shared.expire()
        completionHandler(.failed)
      }
      work = Task { @MainActor in
        await DrivingResearchSync.shared.backgroundWork()
        guard !finished else { return }
        finished = true; timeout.cancel()
        let after = UserDefaults.standard.object(forKey: "research.lastUpload") as? Date
        completionHandler(after != before ? .newData : .noData)
      }
    }
  }
  public func application(_ application:UIApplication,didRegisterForRemoteNotificationsWithDeviceToken deviceToken:Data) {
    Task { @MainActor in DrivingResearchPushRegistration.shared.registered(deviceToken) }
  }
  public func application(_ application:UIApplication,didFailToRegisterForRemoteNotificationsWithError error:Error) {
    Task { @MainActor in DrivingResearchPushRegistration.shared.failed() }
  }

}
