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
  private let activityQueue: OperationQueue = {
    let queue = OperationQueue()
    queue.name = "com.anthonyh.fuelup.motion-activity"
    queue.qualityOfService = .utility
    return queue
  }()
  private var isUpdating = false
  private var lastActivityPayload: [String: Any]?

  public func definition() -> ModuleDefinition {
    Name("FuelUpDrivingActivity")

    Events("onActivityUpdate")

    AsyncFunction("getAuthorizationStatusAsync") {
      return authorizationStatusLabel()
    }

    AsyncFunction("isActivityAvailableAsync") {
      return CMMotionActivityManager.isActivityAvailable()
    }

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
    }

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
    }

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
      activityManager.startActivityUpdates(to: activityQueue) { [weak self] activity in
        guard let self, let activity else {
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
    }

    AsyncFunction("stopActivityUpdatesAsync") { (promise: Promise) in
      activityManager.stopActivityUpdates()
      isUpdating = false
      promise.resolve([
        "stopped": true
      ])
    }
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
