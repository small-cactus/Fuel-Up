import MapKit

// Debug-only entry point, exercised against the same MapKit projection and
// native glass views as manual gestures. The report contains actual view frames.
final class ClusterLabProbe {
  private weak var view: ClusterLabMapView?
  private let token: String
  private let savedRegion: MKCoordinateRegion
  private var startTime: Double = 0
  private var stage = -1
  private var finished = false
  private var baseline: [[String: Any]] = []
  private var anchorSamples: [[String: Any]] = []
  private let center = CLLocationCoordinate2D(latitude: 27.9506, longitude: -82.4572)
  private let spans: [Double] = [0.003, 0.006, 0.010, 0.018, 0.030, 0.018, 0.010, 0.006, 0.003, 0.030, 0.003]

  init(view: ClusterLabMapView, token: String) {
    self.view = view; self.token = token
    savedRegion = view.map.region
  }

  func start() {
    guard let view else { return }
    let fixture: [(Double, Double)] = [(0, 0), (0.00055, 0.00075), (-0.0005, -0.0008),
                                     (0.0011, -0.0006), (-0.001, 0.0007), (0.0001, 0.0015)]
    // The pair run isolates +1 travel; the normal six-station gate is unchanged.
    let offsets = token.hasPrefix("vertical-") ? [(0.0, 0.0), (0.00055, 0.0)] :
      (token.hasPrefix("pair-") ? Array(fixture.prefix(2)) : fixture)
    view.renderer.setStations(offsets.enumerated().compactMap { index, offset in
      ClusterLabStation(["id": "lab-\(index)", "latitude": center.latitude + offset.0,
                         "longitude": center.longitude + offset.1, "price": 3.10 + Double(index) * 0.10,
                         "name": "Probe station \(index)"])
    })
    if token.hasPrefix("fit-") { view.fitCamera(to: view.renderer.stations) }
    else { view.setRegion(.init(center: center, span: .init(latitudeDelta: spans[0], longitudeDelta: spans[0])), animated: false) }
    view.renderer.resetRecording()
    view.renderer.recording = true
    view.refresh()
  }

  func tick(time: Double) {
    guard let view, !finished else { return }
    if startTime == 0 { startTime = time }
    if token.hasPrefix("fit-") {
      stage = 0
      if baseline.isEmpty { baseline = view.renderer.frameSamples.last?["views"] as? [[String: Any]] ?? [] }
      if time - startTime >= 2 { finish(status: "completed") }
      return
    }
    let nextStage = Int((time - startTime) / 2.5)
    guard nextStage != stage else { return }
    if nextStage >= spans.count { finish(status: "completed"); return }
    if nextStage == 1 { baseline = view.renderer.frameSamples.last?["views"] as? [[String: Any]] ?? [] }
    stage = nextStage
    var target = center
    var span = spans[stage]
    if token.hasPrefix("anchor-") {
      // Repeated pans across both viewport edges, followed by an immediate
      // camera jump and return. Exercise MapKit annotation rebasing/culling.
      let offsets: [Double] = [0, 0.002, 0.004, -0.004, -0.002, 0, 0.003, -0.003, 0, 0.02, 0]
      target.longitude += offsets[stage]
      span = 0.003
    }
    view.setRegion(.init(center: target, span: .init(latitudeDelta: span, longitudeDelta: span)),
                       animated: stage > 0 && !(token.hasPrefix("anchor-") && stage >= 9))
    view.refresh()
  }

  func recordAnchor(_ sample: [String: Any]) { anchorSamples.append(sample) }

  func cancel() { finish(status: "cancelled") }

  private func finish(status: String) {
    guard let view, !finished else { return }
    finished = true
    let report: [String: Any] = [
      "token": token, "status": status, "stagesCompleted": stage + 1,
      "modes": ["stepped", "one-shot"], "baseline": baseline,
      "final": view.renderer.frameSamples.last?["views"] ?? [],
      "samples": view.renderer.frameSamples, "events": view.renderer.events,
      "anchorSamples": anchorSamples,
      "usesNativeGlass": NSClassFromString("UIGlassContainerEffect") != nil,
      "fitBounds": ["x": view.fitBounds.minX, "y": view.fitBounds.minY,
                    "width": view.fitBounds.width, "height": view.fitBounds.height],
    ]
    view.renderer.recording = false
    do {
      let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
      let data = try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys])
      try data.write(to: directory.appendingPathComponent("cluster-lab-probe.json"), options: .atomic)
    } catch { NSLog("[Glass Lab] Probe export failed: %@", error.localizedDescription) }
    view.renderer.resetRecording()
    view.probe = nil
    view.restoreStationsAfterProbe()
    view.setRegion(savedRegion, animated: false)
    view.restoreOriginAfterProbe()
    view.refresh()
  }
}
