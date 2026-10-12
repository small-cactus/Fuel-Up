import Foundation
import UIKit
import CoreLocation
import CoreMotion
import AVFAudio
import CryptoKit

// Opportunistic context only: no audio activation, timers or new background mode.
@MainActor final class DrivingResearchPacketContext {
  private let defaults = UserDefaults.standard
  private let prefix = "research.packetContext.v1."
  private var active = false
  private var inForeground = false
  private var foregroundAt: Double?
  private var ownedBatteryMonitoring = false

  func start() {
    guard !active else { return }
    active = true
    if defaults.object(forKey: prefix + "since") == nil {
      defaults.set(Date().timeIntervalSince1970, forKey: prefix + "since")
    }
    ownedBatteryMonitoring = !UIDevice.current.isBatteryMonitoringEnabled
    UIDevice.current.isBatteryMonitoringEnabled = true
  }
  func stop() {
    active = false; inForeground = false; foregroundAt = nil
    if ownedBatteryMonitoring { UIDevice.current.isBatteryMonitoringEnabled = false }
    ownedBatteryMonitoring = false
    for key in defaults.dictionaryRepresentation().keys where key.hasPrefix(prefix) {
      defaults.removeObject(forKey: key)
    }
  }
  func foreground() -> [String: Any]? {
    guard active, !inForeground else { return nil }
    inForeground = true
    let now = Date().timeIntervalSince1970
    foregroundAt = now
    defaults.set(now, forKey: prefix + "app_open")
    return ["source": "fuelup_interaction", "interactionVersion": 1,
            "action": "app_foreground", "observedAt": now]
  }
  func background() -> [String: Any]? {
    guard active, inForeground else { return nil }
    inForeground = false
    let now = Date().timeIntervalSince1970
    var result: [String: Any] = ["source": "fuelup_interaction", "interactionVersion": 1,
                               "action": "app_background", "observedAt": now]
    if let foregroundAt { result["foregroundDurationSeconds"] = max(0, now - foregroundAt) }
    foregroundAt = nil
    return result
  }
  func interaction(_ action: String, fields: [String: Any]) {
    defaults.set(Date().timeIntervalSince1970, forKey: prefix + action)
    if action == "station_go", let station = fields["station"] as? [String: Any],
       let id = station["id"] as? String { defaults.set(id, forKey: prefix + "lastGoStationId") }
  }
  func snapshot() -> [String: Any] {
    let now = Date().timeIntervalSince1970
    let device = UIDevice.current
    var fields: [String: Any] = ["version": 1, "sampledAt": now,
      "systemUptimeSeconds": ProcessInfo.processInfo.systemUptime,
      "lowPowerMode": ProcessInfo.processInfo.isLowPowerModeEnabled,
      "thermalState": ProcessInfo.processInfo.thermalState.rawValue,
      "backgroundRefreshStatus": UIApplication.shared.backgroundRefreshStatus.rawValue,
      "foregroundSessionActive": inForeground,
      "stepCountingAvailable": CMPedometer.isStepCountingAvailable(),
      "walkingDistanceAvailable": CMPedometer.isDistanceAvailable(),
      "floorsAvailable": CMPedometer.isFloorCountingAvailable(),
      "appOpenHistoryAvailable": defaults.object(forKey: prefix + "app_open") != nil,
      "batteryState": device.batteryState.rawValue,
      "batteryAvailable": device.isBatteryMonitoringEnabled && device.batteryLevel >= 0]
    if device.isBatteryMonitoringEnabled && device.batteryLevel >= 0 { fields["batteryLevel"] = device.batteryLevel }
    // Only this app's observable route; absence does not mean no car connection.
    if active {
      fields["audioOutputPortTypes"] = AVAudioSession.sharedInstance().currentRoute.outputs.map { $0.portType.rawValue }
      fields["audioRouteScope"] = "app_current_route_only"
    }
    for action in ["app_open", "map_gesture", "map_show_all", "station_select", "station_go"] {
      if let time = defaults.object(forKey: prefix + action) as? Double {
        fields[action + "At"] = time
        if time <= now { fields[action + "AgeSeconds"] = now - time }
      }
    }
    if let time = defaults.object(forKey: prefix + "app_open") as? Double, time <= now {
      fields["appOpenedWithin15Minutes"] = now - time <= 900
      fields["appOpenedWithinHour"] = now - time <= 3600
    }
    if let id = defaults.string(forKey: prefix + "lastGoStationId") { fields["lastGoStationId"] = id }
    return fields
  }
  func visit(_ visit: CLVisit) -> [String: Any]? {
    guard active, CLLocationCoordinate2DIsValid(visit.coordinate),
          visit.horizontalAccuracy.isFinite, visit.horizontalAccuracy >= 0,
          let since = defaults.object(forKey: prefix + "since") as? Double else { return nil }
    let now = Date().timeIntervalSince1970
    var fields: [String: Any] = ["source": "apple_general_visit", "generalVisitVersion": 1,
      "latitude": visit.coordinate.latitude, "longitude": visit.coordinate.longitude,
      "accuracy": visit.horizontalAccuracy, "receivedAt": now, "fuelPurchaseConfirmed": false]
    let arrival = visit.arrivalDate.timeIntervalSince1970
    let departure = visit.departureDate.timeIntervalSince1970
    let validArrival = visit.arrivalDate != .distantPast && arrival >= since && arrival <= now
    let validDeparture = visit.departureDate != .distantFuture && departure >= since && departure <= now
    guard validArrival || validDeparture else { return nil }
    fields["arrivalAvailable"] = validArrival; fields["departureAvailable"] = validDeparture
    if validArrival { fields["arrivalAt"] = arrival }
    if validDeparture { fields["departureAt"] = departure }
    if validArrival && validDeparture { fields["dwellSeconds"] = max(0, departure - arrival) }
    guard let key = visitKey(fields), !(defaults.stringArray(forKey: prefix + "visits") ?? []).contains(key) else { return nil }
    return fields
  }
  func didSaveVisit(_ fields: [String: Any]) {
    guard let key = visitKey(fields) else { return }
    let keys = (defaults.stringArray(forKey: prefix + "visits") ?? []) + [key]
    defaults.set(Array(keys.suffix(128)), forKey: prefix + "visits")
  }
  private func visitKey(_ fields: [String: Any]) -> String? {
    var stable = fields; stable.removeValue(forKey: "receivedAt")
    guard let data = try? JSONSerialization.data(withJSONObject: stable, options: .sortedKeys) else { return nil }
    return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
  }
}
