import ExpoModulesCore
import UIKit

public final class DrivingResearchLifecycle: ExpoAppDelegateSubscriber {
  public func application(_ application:UIApplication,didFinishLaunchingWithOptions launchOptions:[UIApplication.LaunchOptionsKey:Any]?=nil)->Bool {
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
    Task { @MainActor in DrivingResearchPushRegistration.shared.registerIfAllowed() }
    if UserDefaults.standard.bool(forKey:DrivingResearchCollector.enabledKey) {
      Task { @MainActor in DrivingResearchCollector.shared.resume(reason:"foreground") }
    }
  }
  public func application(_ application:UIApplication,didRegisterForRemoteNotificationsWithDeviceToken deviceToken:Data) {
    Task { @MainActor in DrivingResearchPushRegistration.shared.registered(deviceToken) }
  }
  public func application(_ application:UIApplication,didFailToRegisterForRemoteNotificationsWithError error:Error) {
    Task { @MainActor in DrivingResearchPushRegistration.shared.failed() }
  }

}
