import Foundation
import CoreMotion

// Recover activity transitions during process suspension. Never treat missing
// history as stationary, and never feed historical movement into live tracking.
@MainActor final class DrivingResearchTimingHistory {
  private let activity = CMMotionActivityManager()
  private let defaults: UserDefaults
  private let now: () -> Double
  private let timeoutNanoseconds: UInt64
  private var active = false
  private var requestID: UUID?
  private var deadline: Task<Void, Never>?
  private var emit: ((String, [String: Any]) -> Bool)?
  private var lastAttempt: Double = 0
  static let sinceKey = "research.timingHistory.since.v1"
  static let cursorKey = "research.timingHistory.cursor.v1"

  init(defaults: UserDefaults = .standard,
       now: @escaping () -> Double = { Date().timeIntervalSince1970 },
       timeoutNanoseconds: UInt64 = 20_000_000_000) {
    self.defaults = defaults
    self.now = now
    self.timeoutNanoseconds = timeoutNanoseconds
  }

  func start(emit: @escaping (String, [String: Any]) -> Bool) {
    self.emit = emit
    active = true
    // First installation starts a new boundary. Do not query pre-upgrade or
    // paused periods merely because Apple still retains those activities.
    if defaults.object(forKey: Self.sinceKey) == nil {
      defaults.set(now(), forKey: Self.sinceKey)
    }
    drain()
  }

  func stop(resetBoundary: Bool = false) {
    active = false
    emit = nil
    requestID = nil
    deadline?.cancel()
    deadline = nil
    if resetBoundary {
      defaults.removeObject(forKey: Self.sinceKey)
      defaults.removeObject(forKey: Self.cursorKey)
    }
  }

  func drain() {
    let end = now() - 180 // Apple's recent history can arrive several minutes late.
    guard active, requestID == nil, let emit, end - lastAttempt >= 900,
          CMMotionActivityManager.isActivityAvailable(),
          CMMotionActivityManager.authorizationStatus() == .authorized,
          let since = defaults.object(forKey: Self.sinceKey) as? Double else { return }
    let cursor = defaults.object(forKey: Self.cursorKey) as? Double ?? since
    let start = max(since, cursor, now() - 7 * 86400)
    guard end - start >= 60 else { return }
    lastAttempt = end
    let ticket = UUID()
    requestID = ticket
    let base: [String: Any] = ["source": "apple_motion_history", "timingHistoryVersion": 1,
                              "queryStartAt": start, "queryEndAt": end,
                              "expiredHistorySeconds": max(0, start - max(cursor, since))]
    deadline = Task { [weak self] in
      guard let self else { return }
      do { try await Task.sleep(nanoseconds: self.timeoutNanoseconds) } catch { return }
      guard self.active, self.requestID == ticket else { return }
      self.requestID = nil
      var fields = base
      fields["status"] = "query_failed"
      fields["timedOut"] = true
      _ = self.emit?("diagnostic", fields)
    }
    activity.queryActivityStarting(from: Date(timeIntervalSince1970: start),
                                   to: Date(timeIntervalSince1970: end), to: .main) { [weak self] values, error in
      Task { @MainActor in
        guard let self, self.active, self.requestID == ticket else { return }
        self.deadline?.cancel()
        self.deadline = nil
        self.requestID = nil
        var fields = base
        guard error == nil, let values else {
          fields["status"] = "query_failed"
          // Unknown data is not a successful empty interval. Retry on a later wake.
          _ = emit("diagnostic", fields)
          return
        }
        let samples = values.filter { $0.startDate.timeIntervalSince1970 >= start && $0.startDate.timeIntervalSince1970 <= end }
          .sorted { $0.startDate < $1.startDate }
        let chunks = max(1, (samples.count + 99) / 100)
        for index in 0..<chunks {
          guard self.active else { return }
          let lower = index * 100, upper = min(samples.count, lower + 100)
          fields["status"] = "available"
          fields["chunkIndex"] = index
          fields["chunkCount"] = chunks
          fields["activities"] = samples[lower..<upper].map { value -> [String: Any] in
            ["timestamp": value.startDate.timeIntervalSince1970,
             "automotive": value.automotive, "stationary": value.stationary,
             "walking": value.walking, "running": value.running, "cycling": value.cycling,
             "unknown": value.unknown, "confidence": value.confidence.rawValue]
          }
          // An incomplete window may repeat after interruption; analysts dedupe
          // by sensor timestamp/flags. Advance only after every chunk is durable.
          guard emit("diagnostic", fields) else { return }
        }
        self.defaults.set(end, forKey: Self.cursorKey)
      }
    }
  }
}
