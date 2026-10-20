import Foundation

// Matches evaluateStopEvidence.py's bounded, associated-station replay against
// the production detector. Input is private; output contains aggregate counts.
@main struct ReplayStopEvidenceBaseline {
  struct Sample: Decodable {
    let available: Double
    let fix: ResearchFix
  }
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
    var mismatches = 0
    var prompted = 0
    for window in windows {
      var detector = ResearchVisitDetector()
      var delay: Double?
      replay: for sample in window.samples where sample.fix.timestamp >= window.start {
        for (kind, _) in detector.process(sample.fix, stations: [window.station]) {
          if kind == "visit_gap" || kind == "visit_departure" { break replay }
          if kind == "visit_candidate", sample.available >= window.observationKnown,
             sample.available <= window.end {
            delay = sample.available - window.start
            break replay
          }
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
