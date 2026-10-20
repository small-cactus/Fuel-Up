import Foundation

// Private fixture format matches replayStopEvidenceBaseline.swift, but
// expectedDelay must be the Python core_65 policy's decision time.
@main struct ReplayStopPrompt {
  struct Sample: Decodable { let available: Double; let fix: ResearchFix }
  struct Window: Decodable {
    let station: ResearchStation
    let start: Double
    let end: Double
    let observationKnown: Double
    let samples: [Sample]
    let expectedDelay: Double?
  }
  static func main() throws {
    let windows = try JSONDecoder().decode([Window].self, from:
      Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])))
    var mismatches = 0, prompted = 0
    for window in windows {
      var detector = ResearchVisitDetector(), gate = ResearchStopEvidence()
      var delay: Double?
      for sample in window.samples where sample.fix.timestamp >= window.start {
        let events = detector.process(sample.fix, stations: [window.station])
        if events.contains(where: { $0.0 == "visit_gap" || $0.0 == "visit_departure" }) { break }
        let decision = gate.process(sample.fix, visit: detector.active, now: sample.available)
        if decision?.eligible == true, sample.available >= window.observationKnown,
           sample.available <= window.end {
          delay = sample.available - window.start; break
        }
      }
      if delay != nil { prompted += 1 }
      if let expected = window.expectedDelay, let actual = delay {
        if abs(expected - actual) > 0.001 { mismatches += 1 }
      } else if (delay == nil) != (window.expectedDelay == nil) { mismatches += 1 }
    }
    print("{\"windows\":\(windows.count),\"prompted\":\(prompted),\"mismatches\":\(mismatches)}")
    if mismatches > 0 { exit(1) }
  }
}
