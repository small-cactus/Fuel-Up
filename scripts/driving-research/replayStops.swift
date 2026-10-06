import Foundation

// Offline evaluation using the real native detector. Inputs contain private
// routes and must stay outside the repository; output contains aggregate counts.
@main struct ReplayStops {
  static func main() throws {
    guard CommandLine.arguments.count == 3 else {
      fatalError("Usage: replay-stops PRIVATE_EVENTS_JSON PRIVATE_STATIONS_JSON")
    }
    let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
    let records = (try JSONSerialization.jsonObject(with: data) as! [[String: Any]])
      .sorted { ($0["recordedAt"] as! Double) < ($1["recordedAt"] as! Double) }
    let stations = try JSONDecoder().decode([ResearchStation].self,
      from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[2])))
    var visits: [String: [[String: Any]]] = [:]
    var fixes: [ResearchFix] = []
    for record in records {
      guard let payload = record["payload"] as? [String: Any] else { continue }
      if let id = payload["visitId"] as? String { visits[id, default: []].append(record) }
      if record["kind"] as? String == "location" {
        fixes.append(try JSONDecoder().decode(ResearchFix.self,
          from: JSONSerialization.data(withJSONObject: payload)))
      }
    }
    fixes.sort { $0.timestamp < $1.timestamp }
    var summary: [String: [String: Int]] = [:]
    var motionSummary: [String: [String: Int]] = [:]
    var unmatched = 0
    for events in visits.values {
      guard let labelEvent = events.last(where: { $0["kind"] as? String == "visit_label" }),
            let label = (labelEvent["payload"] as? [String: Any])?["label"] as? String,
            ["fueled", "not_fueling", "not_a_stop"].contains(label) else { continue }
      guard let evidence = events.compactMap({ $0["payload"] as? [String: Any] })
              .last(where: { $0["startedAt"] != nil }),
            let start = evidence["startedAt"] as? Double,
            let stationID = evidence["stationId"] as? String,
            let station = stations.first(where: { $0.id == stationID }),
            let lastInside = evidence["lastInsideAt"] as? Double,
            let departure = events.last(where: { $0["kind"] as? String == "visit_departure" }),
            let end = departure["recordedAt"] as? Double else { unmatched += 1; continue }
      var detector = ResearchVisitDetector()
      var prompted = false
      // Replays only saved fixes, not unrecorded 1 Hz callbacks. Uses the original
      // station association; this does not validate catalog selection/recall.
      // The departure callback itself is not always persisted. Include at most
      // 30 seconds of subsequent saved fixes to observe the actual exit.
      replay: for fix in fixes where fix.timestamp >= start && fix.timestamp <= end + 30 {
        for (kind, visit) in detector.process(fix, stations: [station]) {
          if ResearchConfirmation.shouldPrompt(event: kind, visit: visit) { prompted = true }
          if kind == "visit_departure" || kind == "visit_gap" { break replay }
        }
      }
      var bucket = summary[label, default: ["total": 0, "prompted": 0, "silent": 0]]
      bucket["total", default: 0] += 1
      bucket[prompted ? "prompted" : "silent", default: 0] += 1
      summary[label] = bucket
      // Presence only: repeated uploads of a motion event are not independent
      // samples, and absence of a walking event does not prove no walking.
      let motion = records.compactMap { record -> [String: Any]? in
        guard record["kind"] as? String == "motion",
              let payload = record["payload"] as? [String: Any],
              let time = payload["timestamp"] as? Double,
              time >= start - 30, time <= lastInside + 30 else { return nil }
        return payload
      }
      var motionBucket = motionSummary[label, default: ["total": 0, "withMotion": 0, "withWalking": 0]]
      motionBucket["total", default: 0] += 1
      if !motion.isEmpty { motionBucket["withMotion", default: 0] += 1 }
      if motion.contains(where: { $0["walking"] as? Bool == true }) {
        motionBucket["withWalking", default: 0] += 1
      }
      motionSummary[label] = motionBucket
    }
    let output: [String: Any] = ["labels": summary, "unmatchedLabels": unmatched,
      "motionWithinVisitPlus30Seconds": motionSummary,
      "limitations": "Development replay of saved, downsampled fixes at labeled stations. Unanswered and synthetic tests excluded. Not held-out accuracy or fuel-purchase inference."]
    print(String(decoding: try JSONSerialization.data(withJSONObject: output, options: [.prettyPrinted, .sortedKeys]), as: UTF8.self))
  }
}
