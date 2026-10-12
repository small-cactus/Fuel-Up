import Foundation
import CoreMotion

// Five-minute bins, recovered on ordinary wakes. No new wakeups or live sensor
// stream. Durable cursor + collection boundary prevent paused-period collection.
@MainActor final class DrivingResearchStepHistory {
  private let pedometer = CMPedometer()
  private let defaults: UserDefaults
  private let now: () -> Double
  private let timeoutNanoseconds: UInt64
  static let sinceKey = "research.stepHistory.since.v1"
  static let cursorKey = "research.stepHistory.cursor.v1"
  private var emit: ((String, [String: Any]) -> Bool)?
  private var requestID: UUID?
  private var deadline: Task<Void, Never>?
  private var lastAttempt = -Double.infinity
  private var remaining = 0
  init(defaults: UserDefaults = .standard, now: @escaping () -> Double = { Date().timeIntervalSince1970 },
       timeoutNanoseconds: UInt64 = 20_000_000_000) {
    self.defaults = defaults; self.now = now; self.timeoutNanoseconds = timeoutNanoseconds
  }
  func start(emit: @escaping (String, [String: Any]) -> Bool) {
    self.emit = emit
    if defaults.object(forKey: Self.sinceKey) == nil { defaults.set(now(), forKey: Self.sinceKey) }
    drain()
  }
  func stop(resetBoundary: Bool = false) {
    emit = nil; requestID = nil; deadline?.cancel(); deadline = nil; remaining = 0
    if resetBoundary {
      defaults.removeObject(forKey: Self.sinceKey); defaults.removeObject(forKey: Self.cursorKey)
      lastAttempt = -Double.infinity
    }
  }
  func drain() {
    guard emit != nil, requestID == nil, now() - lastAttempt >= 900 else { return }
    lastAttempt = now(); remaining = 12
    queryNext()
  }
  private func queryNext() {
    guard let emit, requestID == nil, remaining > 0,
          CMPedometer.isStepCountingAvailable(), CMPedometer.authorizationStatus() == .authorized,
          let since = defaults.object(forKey: Self.sinceKey) as? Double else { return }
    let cursor = defaults.object(forKey: Self.cursorKey) as? Double ?? since
    let start = max(since, cursor, now() - 7 * 86400)
    let end = min(start + 300, now() - 180)
    guard end - start >= 300 else { return }
    remaining -= 1
    let ticket = UUID(); requestID = ticket
    let base: [String: Any] = ["source": "apple_step_history", "stepHistoryVersion": 1,
      "queryStartAt": start, "queryEndAt": end, "expiredHistorySeconds": max(0, start - max(cursor, since)),
      "distanceAvailable": CMPedometer.isDistanceAvailable(), "floorsAvailable": CMPedometer.isFloorCountingAvailable()]
    deadline = Task { [weak self] in
      guard let self else { return }
      do { try await Task.sleep(nanoseconds: self.timeoutNanoseconds) } catch { return }
      guard self.requestID == ticket, self.emit != nil else { return }
      self.requestID = nil
      var fields = base; fields["status"] = "query_failed"; fields["timedOut"] = true
      _ = self.emit?("diagnostic", fields)
    }
    pedometer.queryPedometerData(from: Date(timeIntervalSince1970: start), to: Date(timeIntervalSince1970: end)) { [weak self] value, error in
      Task { @MainActor in
        guard let self, self.emit != nil, self.requestID == ticket else { return }
        self.deadline?.cancel(); self.deadline = nil; self.requestID = nil
        var fields = base
        guard let value, error == nil else {
          fields["status"] = "query_failed"
          if let error { fields["errorCode"] = (error as NSError).code }
          _ = emit("diagnostic", fields); return
        }
        fields["status"] = "available"; fields["steps"] = value.numberOfSteps.intValue
        fields["dataStartAt"] = value.startDate.timeIntervalSince1970
        fields["dataEndAt"] = value.endDate.timeIntervalSince1970
        for (key, number) in [("distanceMeters", value.distance), ("floorsAscended", value.floorsAscended),
                              ("floorsDescended", value.floorsDescended), ("averageActivePace", value.averageActivePace)] {
          if let number, number.doubleValue.isFinite, number.doubleValue >= 0 { fields[key] = number.doubleValue }
        }
        guard emit("diagnostic", fields) else { return }
        self.defaults.set(end, forKey: Self.cursorKey)
        self.queryNext()
      }
    }
  }
}
