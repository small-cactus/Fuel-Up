import Foundation

// Notification bus avoids a dependency between the two native Expo modules.
enum OnboardingTelemetry {
  static func emit(_ kind: String, _ fields: [String: Any]) {
    NotificationCenter.default.post(name: Notification.Name("FuelUpInstallationTelemetry"), object: nil,
      userInfo: ["kind": kind, "fields": fields])
  }
}
