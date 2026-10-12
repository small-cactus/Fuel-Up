import UIKit
import CoreLocation
import CoreMotion
import UserNotifications
import Darwin

@MainActor enum InstallationProfile {
  static func snapshot() -> [String: Any] {
    var system = utsname(); uname(&system)
    let model = withUnsafePointer(to: &system.machine) {
      $0.withMemoryRebound(to: CChar.self, capacity: 1) { String(cString: $0) }
    }
    let screen = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first?.screen ?? UIScreen.main
    let firstKey = "installation.firstOpenedAt"
    if UserDefaults.standard.object(forKey: firstKey) == nil { UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: firstKey) }
    #if targetEnvironment(simulator)
    let simulator = true
    #else
    let simulator = false
    #endif
    return ["schemaVersion": 1, "telemetryVersion": 1, "deviceModel": model, "osVersion": UIDevice.current.systemVersion,
      "appVersion": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "",
      "build": Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "",
      "screenWidthPoints": screen.bounds.width, "screenHeightPoints": screen.bounds.height,
      "screenWidthPixels": screen.nativeBounds.width, "screenHeightPixels": screen.nativeBounds.height,
      "scale": screen.scale, "nativeScale": screen.nativeScale, "idiom": UIDevice.current.userInterfaceIdiom.rawValue,
      "contentSizeCategory": UIApplication.shared.preferredContentSizeCategory.rawValue,
      "locale": Locale.current.identifier, "timeZone": TimeZone.current.identifier,
      "firstOpenedAt": UserDefaults.standard.double(forKey: firstKey), "isSimulator": simulator]
  }
  static func permissions() async -> [String: Any] {
    let location = CLLocationManager()
    let settings = await UNUserNotificationCenter.current().notificationSettings()
    return ["location": location.authorizationStatus.rawValue, "precise": location.accuracyAuthorization == .fullAccuracy,
      "locationServicesEnabled": CLLocationManager.locationServicesEnabled(),
      "motion": CMMotionActivityManager.authorizationStatus().rawValue, "notifications": settings.authorizationStatus.rawValue,
      "alertSetting": settings.alertSetting.rawValue, "soundSetting": settings.soundSetting.rawValue,
      "backgroundRefresh": UIApplication.shared.backgroundRefreshStatus.rawValue,
      "researchEnabled": UserDefaults.standard.bool(forKey: DrivingResearchCollector.enabledKey),
      "researchConsented": UserDefaults.standard.bool(forKey: DrivingResearchCollector.consentKey)]
  }
}
