import Foundation

@main struct StopPromptEvidenceTests {
  static let station = ResearchStation(id: "fixture", name: "Station", latitude: 0, longitude: 0)
  static func fix(_ t: Double, distance: Double = 10, accuracy: Double = 5,
                  speed: Double = 0, receipt: Double? = nil) -> ResearchFix {
    ResearchFix(timestamp: t, receivedAt: receipt ?? t, latitude: 0,
      longitude: distance / 111195, accuracy: accuracy, speed: speed,
      course: 0, speedAccuracy: 1, simulated: false, accessory: false)
  }
  static func main() throws {
    var detector = ResearchVisitDetector(), gate = ResearchStopEvidence()
    var claimed = Set<String>(), decisions: [ResearchStopEvidence.Decision] = []
    var prompts: [(Double, ResearchVisit)] = []
    for t in stride(from: 100.0, through: 500.0, by: 10) {
      // Three minutes near the station must defer; moving closer can qualify
      // later even though the detector's candidate event already fired once.
      let f = fix(t, distance: t < 310 ? 85 : 20)
      _ = detector.process(f, stations: [station])
      if let d = gate.process(f, visit: detector.active, now: t) {
        decisions.append(d)
        if d.eligible, let v = detector.active, !claimed.contains(v.id) {
          claimed.insert(v.id); prompts.append((t, v))
        }
      }
    }
    assert(decisions.first?.eligible == false)
    assert(prompts.count == 1 && prompts[0].0 > 310)
    assert(gate.fixes.count <= 7)
    let visit = prompts[0].1
    let claim = try ResearchEvent(kind: "visit_prompt", payload: ["visitId": visit.id, "status": "created"])
    assert(ResearchConfirmation.state([claim]).prompted.contains(visit.id), "Persisted claim prevents relaunch duplicates")

    var restored = ResearchStopEvidence()
    let encoded = try JSONEncoder().encode(detector)
    var restoredDetector = try JSONDecoder().decode(ResearchVisitDetector.self, from: encoded)
    let first = fix(510)
    _ = restoredDetector.process(first, stations: [station])
    assert(restored.process(first, visit: restoredDetector.active, now: 510)?.eligible == false,
           "Relaunch needs fresh coverage even for an old candidate")

    var outsideDetector = ResearchVisitDetector(), outsideGate = ResearchStopEvidence()
    for t in stride(from: 100.0, through: 400.0, by: 10) {
      let f = fix(t, distance: 60, accuracy: 10)
      _ = outsideDetector.process(f, stations: [station])
      assert(outsideGate.process(f, visit: outsideDetector.active, now: t)?.eligible != true,
             "Uncertainty must be included")
    }
    let exitFix = fix(410, distance: 250, speed: 5)
    _ = outsideDetector.process(exitFix, stations: [station])
    assert(outsideGate.process(exitFix, visit: outsideDetector.active, now: 410) == nil)
    assert(outsideGate.fixes.isEmpty, "Departure must clear evidence and never prompt")

    var preciseDetector = ResearchVisitDetector(), preciseGate = ResearchStopEvidence()
    var firstPrompt: Double?
    for t in stride(from: 100.0, through: 300.0, by: 10) {
      let f = fix(t)
      _ = preciseDetector.process(f, stations: [station])
      if preciseGate.process(f, visit: preciseDetector.active, now: t)?.eligible == true,
         firstPrompt == nil { firstPrompt = t }
    }
    assert(firstPrompt == 280, "Three-minute boundary must remain intact")
    assert(preciseGate.process(fix(300), visit: preciseDetector.active, now: 300) == nil)
    assert(preciseGate.process(fix(310, accuracy: 100), visit: preciseDetector.active, now: 310) == nil)
    assert(preciseGate.process(fix(400, receipt: 500), visit: preciseDetector.active, now: 500) == nil)
    assert(preciseGate.process(fix(315, receipt: 310), visit: preciseDetector.active, now: 310) == nil)
    assert(preciseGate.process(fix(320), visit: preciseDetector.active, now: .nan) == nil)
    let moving = fix(330, speed: 5)
    _ = preciseDetector.process(moving, stations: [station])
    assert(preciseGate.process(moving, visit: preciseDetector.active, now: 330) == nil)
    let gap = fix(600)
    _ = preciseDetector.process(gap, stations: [station])
    assert(preciseGate.process(gap, visit: preciseDetector.active, now: 600) == nil)
    assert(preciseGate.fixes.count == 1, "New visit must not borrow prior coverage")
    print("PASS: deferred core gate, duration, accuracy, lifecycle, deduplication, departure, gaps and invalid evidence")
  }
}
