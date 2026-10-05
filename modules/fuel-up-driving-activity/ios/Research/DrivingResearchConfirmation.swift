import Foundation

// Stop evidence and participant answers are deliberately separate.
enum ResearchConfirmation {
  static let category = "fuelup.research.stop.v1"
  static let prefix = "research-stop:"
  static let actions = [("fueled", "Got fuel", "fuelpump.fill"),
                        ("not_fueling", "Stopped, no fuel", "bag.fill"),
                        ("not_a_stop", "Not a stop", "car.side")]
  static let notificationSubtitle = "help Fuel Up get better. Tap and hold to answer"
  static func notificationTitle(for visit: ResearchVisit) -> String {
    if visit.candidate { return "got fuel? 👀" }
    let station = visit.station.name.trimmingCharacters(in: .whitespacesAndNewlines)
    return station.isEmpty || station == "Gas station" ? "got something at the gas station? 👀" : "got something at \(station)? 👀"
  }
  static func shouldPrompt(event: String, visit: ResearchVisit) -> Bool {
    // A brief observed stop gets a neutral question only after departure. Do not
    // prompt for drive-bys, interrupted observations, or repeat a longer stop.
    event == "visit_candidate" || (event == "visit_departure" && !visit.candidate &&
      visit.samples >= 3 && visit.lastInsideAt - visit.startedAt >= 30)
  }
  static func state(_ records: [ResearchEvent]) -> (prompted: Set<String>, labels: [String: String]) {
    var prompted = Set<String>(), labels: [String: String] = [:]
    for event in records {
      guard let payload = try? JSONSerialization.jsonObject(with: Data(event.payload.utf8)) as? [String: Any],
            let id = payload["visitId"] as? String else { continue }
      if event.kind == "visit_prompt" { prompted.insert(id) }
      if event.kind == "visit_label", let label = payload["label"] as? String { labels[id] = label }
    }
    return (prompted, labels)
  }
  static func label(for action: String) -> String? {
    actions.contains(where: { $0.0 == action }) ? action : nil
  }
  static func title(for label: String?) -> String {
    switch label {
    case "fueled": return "Got fuel"
    case "not_fueling": return "Stopped, no fuel"
    case "not_a_stop": return "Not a stop"
    case "wrong_station": return "Wrong station"
    case "unsure": return "Not sure"
    default: return "Unconfirmed"
    }
  }
  static func payload(visit: ResearchVisit, label: String, source: String) -> [String: Any]? {
    guard actions.contains(where: { $0.0 == label }) || ["wrong_station", "unsure"].contains(label) else { return nil }
    return ["visitId": visit.id, "stationId": visit.station.id, "label": label,
            "source": "participant", "responseSource": source,
            "confirmationState": label == "unsure" ? "unconfirmed" : "answered",
            "labeledAt": Date().timeIntervalSince1970, "schemaVersion": 1]
  }
}
