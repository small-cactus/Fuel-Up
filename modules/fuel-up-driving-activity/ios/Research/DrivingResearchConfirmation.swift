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
    notificationTitle(candidate:visit.candidate,stationName:visit.station.name)
  }
  static func notificationTitle(candidate:Bool,stationName:String) -> String {
    if candidate { return "got fuel? 👀" }
    let station = stationName.trimmingCharacters(in: .whitespacesAndNewlines)
    return station.isEmpty || station == "Gas station" ? "got something at the gas station? 👀" : "got something at \(station)? 👀"
  }
  static func shouldPrompt(event: String, visit: ResearchVisit) -> Bool {
    // Keep short observations for research, but do not turn a traffic-light
    // stop into a notification. Duration applies to every real-stop prompt,
    // including a restored visit created by an older detector version.
    guard visit.samples >= 3,
          visit.lastInsideAt - visit.startedAt >= ResearchStopPolicy.minimumPromptDwell else { return false }
    return event == "visit_candidate" || (event == "visit_departure" && !visit.candidate)
  }
  static func state(_ records: [ResearchEvent]) -> (prompted: Set<String>, labels: [String: String], notified: Set<String>, departures: [String: Double]) {
    var prompted = Set<String>(), labels: [String: String] = [:], notified = Set<String>(), departures: [String:Double] = [:]
    for event in records {
      guard let payload = try? JSONSerialization.jsonObject(with: Data(event.payload.utf8)) as? [String: Any],
            let id = payload["visitId"] as? String else { continue }
      if event.kind == "visit_prompt" {
        prompted.insert(id)
        if ["scheduled","dismissed"].contains(payload["status"] as? String ?? "") {notified.insert(id)}
      }
      if event.kind == "visit_departure" {departures[id]=(payload["departedAt"] as? Double) ?? event.recordedAt}
      if event.kind == "visit_label", let label = payload["label"] as? String {
        labels[id] = label
        if payload["responseSource"] as? String == "notification" {notified.insert(id)}
      }
    }
    return (prompted, labels, notified, departures)
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
