import ExpoModulesCore
import UIKit

public final class DrivingResearchLifecycle: ExpoAppDelegateSubscriber {
  public func application(_ application:UIApplication,didFinishLaunchingWithOptions launchOptions:[UIApplication.LaunchOptionsKey:Any]?=nil)->Bool {
    DrivingResearchNotifications.shared.install()
    DrivingResearchBackground.register()
    // Only resume an explicitly enrolled pilot. No React bridge or screen needed.
    if UserDefaults.standard.bool(forKey:DrivingResearchCollector.enabledKey) {
      Task { @MainActor in DrivingResearchCollector.shared.resume(reason:"native_launch") }
    }
    return true
  }
  public func applicationDidBecomeActive(_ application:UIApplication) {
    if UserDefaults.standard.bool(forKey:DrivingResearchCollector.enabledKey) {
      Task { @MainActor in DrivingResearchCollector.shared.resume(reason:"foreground") }
    }
  }
}
