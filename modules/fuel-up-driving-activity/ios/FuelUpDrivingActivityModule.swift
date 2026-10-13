import CoreMotion
import ExpoModulesCore
import Foundation

internal final class MotionActivityUnavailableException: Exception, @unchecked Sendable {
  override var reason: String {
    "Motion activity detection is unavailable on this device."
  }

  override var code: String {
    "ERR_MOTION_ACTIVITY_UNAVAILABLE"
  }
}

public final class FuelUpDrivingActivityModule: Module {
  private let activityManager = CMMotionActivityManager()
  // Bridge commands, Core Motion callbacks and authorization polling share one
  // queue. Swift dictionaries cannot be read/replaced concurrently: the old
  // concurrent callback queue raced history queries against live updates.
  private let activityQueue = OperationQueue.main
  private var isUpdating = false
  private var lastActivityPayload: [String: Any]?
  private var updateGeneration = 0

  public func definition() -> ModuleDefinition {
    Name("FuelUpDrivingActivity")

    Events("onActivityUpdate", "onNetworkStatus")
    OnCreate {
      Task { @MainActor [weak self] in
        FuelUpNetworkStatus.shared.emit = { [weak self] event in self?.sendEvent("onNetworkStatus", event) }
      }
    }
    Function("setNetworkFaultsEnabled") { (enabled: Bool) in
      UserDefaults.standard.set(enabled, forKey: APINetworkFaultGate.preferenceKey)
      Task { @MainActor in APINetworkFaultGate.shared.setEnabled(enabled) }
    }
    Function("getNetworkFaultsEnabled") {
      UserDefaults.standard.bool(forKey: APINetworkFaultGate.preferenceKey)
    }
    AsyncFunction("getNetworkStatusAsync") {
      await MainActor.run { () -> [String: Any] in
        if let connected = FuelUpNetworkStatus.shared.connected { return ["connected": connected] }
        return [:]
      }
    }

    Function("ownsBackgroundTracking") { true }
    AsyncFunction("resumeResearchAsync") {
      await MainActor.run { DrivingResearchCollector.shared.resume(reason: "bridge_ready") }
    }
    AsyncFunction("recordInstallationEventAsync") { (kind: String, fields: [String: Any]) in
      await MainActor.run { InstallationTelemetry.shared.track(kind, fields) }
    }
    AsyncFunction("recordResearchInteractionAsync") { (fields: [String: Any]) in
      await MainActor.run { DrivingResearchCollector.shared.recordInteraction(fields) }
    }
    View(DrivingResearchView.self) {
      Prop("isDark") { (view, dark: Bool) in view.setDark(dark) }
      Prop("topInset") { (view, value: Double) in view.setTopInset(value) }
      Prop("bottomInset") { (view, value: Double) in view.setBottomInset(value) }
    }


    AsyncFunction("getAuthorizationStatusAsync") {
      return authorizationStatusLabel()
    }.runOnQueue(.main)

    AsyncFunction("isActivityAvailableAsync") {
      return CMMotionActivityManager.isActivityAvailable()
    }.runOnQueue(.main)

    AsyncFunction("getLatestActivityAsync") { (lookbackMs: Double?, promise: Promise) in
      guard CMMotionActivityManager.isActivityAvailable() else {
        promise.resolve(nil)
        return
      }

      let now = Date()
      let resolvedLookbackMs = max(60_000, lookbackMs ?? 10 * 60 * 1000)
      let start = now.addingTimeInterval(-(resolvedLookbackMs / 1000))

      activityManager.queryActivityStarting(from: start, to: now, to: activityQueue) { [weak self] activities, error in
        if let error {
          promise.reject(GenericException(error.localizedDescription))
          return
        }

        guard let activity = activities?.last else {
          promise.resolve(self?.lastActivityPayload)
          return
        }

        let payload = Self.payload(from: activity)
        self?.lastActivityPayload = payload
        promise.resolve(payload)
      }
    }.runOnQueue(.main)

    AsyncFunction("requestAuthorizationAsync") { (promise: Promise) in
      guard CMMotionActivityManager.isActivityAvailable() else {
        promise.resolve([
          "authorizationStatus": "unavailable"
        ])
        return
      }

      if authorizationStatusLabel() != "notDetermined" {
        promise.resolve([
          "authorizationStatus": authorizationStatusLabel()
        ])
        return
      }

      var hasResolved = false

      func resolveCurrentStatus() {
        guard !hasResolved else {
          return
        }

        hasResolved = true
        self.activityManager.stopActivityUpdates()
        self.isUpdating = false
        promise.resolve([
          "authorizationStatus": self.authorizationStatusLabel()
        ])
      }

      func pollAuthorizationStatus(_ attemptsRemaining: Int) {
        let status = self.authorizationStatusLabel()
        if status != "notDetermined" || attemptsRemaining <= 0 {
          resolveCurrentStatus()
          return
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
          pollAuthorizationStatus(attemptsRemaining - 1)
        }
      }

      activityManager.startActivityUpdates(to: activityQueue) { [weak self] activity in
        guard let self else {
          return
        }

        if let activity {
          self.lastActivityPayload = Self.payload(from: activity)
        }
        if self.authorizationStatusLabel() != "notDetermined" {
          resolveCurrentStatus()
        }
      }

      pollAuthorizationStatus(60)
    }.runOnQueue(.main)

    AsyncFunction("startActivityUpdatesAsync") { (promise: Promise) in
      guard CMMotionActivityManager.isActivityAvailable() else {
        promise.reject(MotionActivityUnavailableException())
        return
      }

      if isUpdating {
        promise.resolve([
          "started": true,
          "authorizationStatus": authorizationStatusLabel()
        ])
        return
      }

      isUpdating = true
      updateGeneration += 1
      let generation = updateGeneration
      activityManager.startActivityUpdates(to: activityQueue) { [weak self] activity in
        guard let self, self.isUpdating, self.updateGeneration == generation, let activity else {
          return
        }

        let payload = Self.payload(from: activity)
        self.lastActivityPayload = payload
        self.sendEvent("onActivityUpdate", payload)
      }

      promise.resolve([
        "started": true,
        "authorizationStatus": authorizationStatusLabel()
      ])
    }.runOnQueue(.main)

    AsyncFunction("stopActivityUpdatesAsync") { (promise: Promise) in
      activityManager.stopActivityUpdates()
      isUpdating = false
      updateGeneration += 1
      promise.resolve([
        "stopped": true
      ])
    }.runOnQueue(.main)
  }

  private func authorizationStatusLabel() -> String {
    switch CMMotionActivityManager.authorizationStatus() {
    case .authorized:
      return "authorized"
    case .denied:
      return "denied"
    case .restricted:
      return "restricted"
    case .notDetermined:
      return "notDetermined"
    @unknown default:
      return "unknown"
    }
  }

  private static func payload(from activity: CMMotionActivity) -> [String: Any] {
    let confidence: String
    switch activity.confidence {
    case .low:
      confidence = "low"
    case .medium:
      confidence = "medium"
    case .high:
      confidence = "high"
    @unknown default:
      confidence = "unknown"
    }

    return [
      "automotive": activity.automotive,
      "cycling": activity.cycling,
      "running": activity.running,
      "stationary": activity.stationary,
      "unknown": activity.unknown,
      "walking": activity.walking,
      "confidence": confidence,
      "timestamp": activity.startDate.timeIntervalSince1970 * 1000
    ]
  }
}
