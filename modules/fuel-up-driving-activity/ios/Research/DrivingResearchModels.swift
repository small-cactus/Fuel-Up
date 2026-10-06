import Foundation

// Sensors write locally. A motion change never creates its own network request.
enum ResearchTransferPolicy {
  static func canUpload(online:Bool,wifi:Bool,pending:Int,draining:Bool=false,manual:Bool=false)->Bool {
    online && (manual || (wifi && (pending>=500 || draining)))
  }
  static func countReportDue(now:Double,lastReport:Double?)->Bool {
    lastReport == nil || now-lastReport! >= 6*3600
  }
  static func needsCatalog(moved:Double,age:Double,constrained:Bool)->Bool {
    moved >= (constrained ? 10_000 : 5_000) || age >= (constrained ? 3_600 : 1_800)
  }
}

struct ResearchStation: Codable, Identifiable {
  let id: String
  let name: String
  let latitude: Double
  let longitude: Double
}

struct ResearchFix: Codable {
  let timestamp: Double
  let receivedAt: Double
  let latitude: Double
  let longitude: Double
  let accuracy: Double
  let speed: Double
  let course: Double
  let speedAccuracy: Double
  let simulated: Bool
  let accessory: Bool

  var rejection: String? {
    if !latitude.isFinite || !longitude.isFinite || abs(latitude) > 90 || abs(longitude) > 180 { return "invalid_coordinate" }
    if accuracy < 0 || accuracy > 40 { return "low_accuracy" }
    if receivedAt - timestamp > 30 || timestamp > receivedAt + 5 { return "stale_or_future" }
    if simulated { return "simulated" }
    return nil
  }
  func distance(to station: ResearchStation) -> Double {
    Self.distance(latitude, longitude, station.latitude, station.longitude)
  }
  static func distance(_ a: Double, _ b: Double, _ c: Double, _ d: Double) -> Double {
    let r = Double.pi / 180
    let h = pow(sin((c-a)*r/2),2) + cos(a*r)*cos(c*r)*pow(sin((d-b)*r/2),2)
    return 6_371_000 * 2 * asin(sqrt(min(1,max(0,h))))
  }
}

struct ResearchEvent: Codable, Identifiable {
  let id: String
  let kind: String
  let recordedAt: Double
  let payload: String // JSON, immutable; preserves sensor time separately from receipt.
  init(kind: String, payload: [String: Any], now: Double = Date().timeIntervalSince1970) throws {
    id = UUID().uuidString.lowercased(); self.kind = kind; recordedAt = now
    self.payload = String(decoding: try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]), as: UTF8.self)
  }
}

struct ResearchVisit: Codable, Identifiable {
  let id: String
  let station: ResearchStation
  let startedAt: Double
  var lastInsideAt: Double
  var samples: Int
  var candidate: Bool
  var ambiguousIDs: [String]
}

// A detector of possible stops, never a fuel-purchase label. All thresholds are
// versioned with the uploaded events so offline training can re-evaluate them.
enum ResearchStopPolicy {
  static let version = "station-stop-v2"
  // Confirmed development stops lasted over three minutes. Short stationary
  // traffic near a station produced false prompts, including a two-minute stop.
  static let minimumPromptDwell: Double = 180
}

struct ResearchVisitDetector: Codable {
  var active: ResearchVisit?
  var lastTimestamp: Double = 0

  mutating func process(_ fix: ResearchFix, stations: [ResearchStation]) -> [(String, ResearchVisit)] {
    guard fix.rejection == nil, fix.timestamp > lastTimestamp else { return [] }
    lastTimestamp = fix.timestamp
    var events: [(String, ResearchVisit)] = []
    if let visit = active, fix.timestamp - visit.lastInsideAt > 180 {
      events.append(("visit_gap", visit)); active = nil
    }
    if var visit = active {
      if fix.distance(to: visit.station) + fix.accuracy <= 110, fix.speed >= 0, fix.speed < 2.5 {
        let previousDwell = visit.lastInsideAt - visit.startedAt
        visit.lastInsideAt = fix.timestamp; visit.samples += 1
        // An active v1 visit may already have candidate=true at two minutes.
        // Crossing the new threshold still emits once; the persisted prompt
        // claim prevents re-notifying visits that were already prompted by v1.
        if (!visit.candidate || previousDwell < ResearchStopPolicy.minimumPromptDwell),
           fix.timestamp - visit.startedAt >= ResearchStopPolicy.minimumPromptDwell, visit.samples >= 3 {
          visit.candidate = true; events.append(("visit_candidate", visit))
        }
        active = visit
      } else if fix.distance(to: visit.station) - fix.accuracy > 180 {
        events.append(("visit_departure", visit)); active = nil
      }
    }
    if active == nil, fix.speed >= 0, fix.speed < 2.5 {
      let nearby = stations.filter { fix.distance(to: $0) + fix.accuracy <= 110 }
        .sorted { fix.distance(to: $0) < fix.distance(to: $1) }
      if let station = nearby.first {
        let visit = ResearchVisit(id: UUID().uuidString.lowercased(), station: station, startedAt: fix.timestamp,
          lastInsideAt: fix.timestamp, samples: 1, candidate: false, ambiguousIDs: nearby.map(\.id))
        active = visit; events.append(("visit_observation", visit))
      }
    }
    return events
  }
}
