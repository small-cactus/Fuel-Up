import Foundation

enum InstallationEventPolicy {
  static let kinds: Set<String> = ["app_launch","app_foreground","app_background","screen_view","screen_exit","screen_heartbeat",
    "onboarding_step","onboarding_action","onboarding_complete","onboarding_error","permission_request","permission_snapshot",
    "research_consent","ui_action","preferences_changed"]
  static let keys: Set<String> = ["schemaVersion","sessionId","screenSegmentId","build","screen","previousScreen","durationSeconds","durationIsObserved","observedAt",
    "step","previousStep","action","phase","permission","status","previousStatus","location","precise","motion","notifications",
    "alertSetting","soundSetting","backgroundRefresh","locationServicesEnabled","researchEnabled","researchConsented",
    "stationId","fuelGrade","displayedRank","surface","gesture","skippedPreferences","errorCode","radiusMiles","requiresE85",
    "selectedBrandCount","membershipCount","clientOccurredAt","reason","lowPowerMode","thermalState"]
  static func accepts(_ kind: String, _ payload: [String: Any]) -> Bool {
    guard kinds.contains(kind) else { return false }
    return payload.allSatisfy { key, value in
      guard keys.contains(key) else { return false }
      if let string = value as? String { return string.count <= 240 }
      if let number = value as? NSNumber { return number.doubleValue.isFinite }
      return value is NSNull
    }
  }
}
