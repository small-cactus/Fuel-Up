import Foundation

// Receipt-time evidence for notifications, separate from the visit log. This
// buffer intentionally starts empty after relaunch or a collection boundary.
struct ResearchStopEvidence {
  struct Decision {
    let eligible: Bool
    let reason: String
    let sampleCount: Int
    let span: Double
    let expandedDistance: Double?
    var payload: [String: Any] {
      var result: [String: Any] = ["policy": ResearchStopPolicy.version,
        "eligible": eligible, "reason": reason, "sampleCount": sampleCount,
        "spanSeconds": span, "coreRadiusMeters": 65]
      if let expandedDistance { result["medianExpandedDistanceMeters"] = expandedDistance }
      return result
    }
  }
  private(set) var fixes: [ResearchFix] = []
  private var visitID: String?
  private var lastTimestamp: Double = 0
  private var lastReportedReason: String?

  mutating func process(_ fix: ResearchFix, visit: ResearchVisit?, now: Double) -> Decision? {
    guard let visit else { self = Self(); return nil }
    if visitID != visit.id { self = Self(); visitID = visit.id }
    guard now.isFinite, fix.timestamp.isFinite, fix.receivedAt.isFinite,
          fix.accuracy.isFinite, fix.speed.isFinite, fix.rejection == nil,
          fix.receivedAt <= now, fix.timestamp <= now,
          fix.timestamp >= visit.startedAt, fix.timestamp > lastTimestamp else { return nil }
    lastTimestamp = fix.timestamp
    fixes.removeAll { now - $0.timestamp > 60 }
    fixes.append(fix)
    // More than 256 samples/minute is unnecessary. Overflow defers rather than
    // inventing coverage; normal Core Location callbacks fit comfortably.
    if fixes.count > 256 { fixes.removeFirst(fixes.count - 256) }
    guard visit.samples >= 3,
          visit.lastInsideAt - visit.startedAt >= ResearchStopPolicy.minimumPromptDwell,
          visit.lastInsideAt == fix.timestamp,
          fix.speed >= 0, fix.speed < 2.5,
          fix.distance(to: visit.station) + fix.accuracy <= 110 else { return nil }
    let span = fixes.last!.timestamp - fixes.first!.timestamp
    guard fixes.count >= 3, span >= 30, now - fix.timestamp <= 30 else {
      return Decision(eligible: false, reason: "insufficient_recent_coverage",
                      sampleCount: fixes.count, span: span, expandedDistance: nil)
    }
    let distances = fixes.map { $0.distance(to: visit.station) + $0.accuracy }.sorted()
    let middle = distances.count / 2
    let median = distances.count.isMultiple(of: 2)
      ? (distances[middle - 1] + distances[middle]) / 2 : distances[middle]
    return Decision(eligible: median <= 65,
      reason: median <= 65 ? "station_core_supported" : "outside_station_core",
      sampleCount: fixes.count, span: span, expandedDistance: median)
  }

  mutating func shouldRecord(_ decision: Decision) -> Bool {
    guard lastReportedReason != decision.reason else { return false }
    lastReportedReason = decision.reason
    return true
  }
}
