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
  private var focusDetails: [String: Any] = [:]
  private var focusCameraSamples: [[String: Any]] = []
  private var overviewReturns: [[String: Any]] = []
  private var overviewInset: CGFloat?
  private var changedOverviewInset = false
  private var restoredOverviewInset = false
  private let center: CLLocationCoordinate2D
  private var isFit: Bool { token.hasPrefix("fit-") || token.hasPrefix("location-") }
  var canRefitForLayoutChange: Bool {
    stage < 0 && (isFit || token.hasPrefix("overview-") || token.hasPrefix("roundtrip-"))
  }
  private let spans: [Double] = [0.003, 0.006, 0.010, 0.018, 0.030, 0.018, 0.010, 0.006, 0.003, 0.030, 0.003]

  init(view: ClusterLabMapView, token: String) {
    self.view = view; self.token = token
    savedRegion = view.map.region
    center = ["location-", "contact-", "fit-", "overview-", "roundtrip-"].contains(where: token.hasPrefix) ?
      (view.map.userLocation.location?.coordinate ?? .init(latitude: 27.9506, longitude: -82.4572)) :
      .init(latitude: 27.9506, longitude: -82.4572)
  }

  func start() {
    guard let view else { return }
    let fixture: [(Double, Double)] = [(0, 0), (0.00055, 0.00075), (-0.0005, -0.0008),
                                     (0.0011, -0.0006), (-0.001, 0.0007), (0.0001, 0.0015)]
    // The pair run isolates +1 travel; the normal six-station gate is unchanged.
    let offsets = token.hasPrefix("browse-") ? [(0.0, 0.0), (0.0001, 0.0002), (-0.0001, -0.0002),
      (0.009, 0.01), (-0.009, -0.01), (0.009, -0.01)] :
      token.hasPrefix("roundtrip-") ? [(0.0, 0.0), (0.0, 0.0015), (0.0015, 0.0),
      (0.0015, 0.0015), (-0.0015, 0.004), (0.0015, 0.004), (0.0, 0.00001), (0.0015, 0.00151)] :
      token.hasPrefix("overview-") ? [(0.0, 0.0), (0.0, 0.0001)] + Array(fixture.dropFirst(2)) :
      token.hasPrefix("location-") ? [(0.0, 0.0), (0.0, 0.00001), (0.0011, 0.0015), (-0.001, -0.0015)] :
      token.hasPrefix("islands-") ? [(0.0, 0.0), (0.0, 0.00001), (0.0003, 0.0010), (0.0003, 0.00101),
                                      (-0.0004, 0.0007), (-0.0004, 0.00071)] :
      token.hasPrefix("rows-") ? [(0.0, 0.0015), (0.0, 0.00151), (0.00055, 0.0015), (0.00055, 0.00151)] :
      token.hasPrefix("vertical-") ? [(0.0, 0.0), (0.00055, 0.0)] :
      (token.hasPrefix("pair-") ? Array(fixture.prefix(2)) : fixture)
    view.renderer.setStations(offsets.enumerated().compactMap { index, offset in
      ClusterLabStation(["id": "lab-\(index)", "latitude": center.latitude + offset.0,
                         "longitude": center.longitude + offset.1 + (token.hasPrefix("fit-user-") ? 0.04 : 0), "price": 3.10 + Double(index) * 0.10,
                         "name": "Probe station \(index)",
                         "offersE85": token.hasPrefix("browse-") && index == 1,
                         "offersDiesel": token.hasPrefix("browse-") && index == 2,
                         "chipPrices": token.hasPrefix("browse-") && index == 1 ? "93 3.20\nE85 2.50" : "",
                         "isRecommended": token.hasPrefix("rapid-recommended-") && index == 1])
    })
    if isFit || token.hasPrefix("overview-") || token.hasPrefix("roundtrip-") { view.fitCamera(to: view.renderer.stations) }
    else {
      let span = token.hasPrefix("focus-") ? 0.03 : spans[0]
      view.setRegion(.init(center: center, span: .init(latitudeDelta: span, longitudeDelta: span)), animated: false)
      if token.hasPrefix("focus-rotated-") {
        let camera = view.map.camera; camera.heading = 35
        view.map.setCamera(camera, animated: false)
      }
    }
    if token.hasPrefix("contact-") {
      // Recreate both screenshot arrangements at known MapKit screen distances.
      let dot = view.map.convert(center, toPointTo: view.map)
      let points: [CGPoint] = [CGPoint(x: 100, y: 180), CGPoint(x: 101, y: 180), CGPoint(x: 210, y: 180),
        CGPoint(x: dot.x, y: dot.y - 23), CGPoint(x: dot.x, y: dot.y - 60),
        CGPoint(x: 70, y: 460), CGPoint(x: 196, y: 460), CGPoint(x: 71, y: 460)]
      view.renderer.setStations(points.enumerated().map { index, point in
        let coordinate = view.map.convert(point, toCoordinateFrom: view.map)
        return ClusterLabStation(["id": "lab-\(index)", "latitude": coordinate.latitude,
          "longitude": coordinate.longitude, "price": 3.10 + Double(index) * 0.10,
          "name": "Contact station \(index)"])!
      })
      view.setRegion(.init(center: center, span: .init(latitudeDelta: 0.002, longitudeDelta: 0.002)), animated: false)
    }
    view.renderer.resetRecording()
    view.renderer.recording = true
    view.refresh()
  }

  func tick(time: Double) {
    guard let view, !finished else { return }
    if startTime == 0 { startTime = time }
    if token.hasPrefix("browse-") {
      let elapsed = time - startTime
      if elapsed >= 1, stage < 0 {
        stage = 0
        baseline = view.renderer.frameSamples.last?["views"] as? [[String: Any]] ?? []
        let owners = view.renderer.clusterOwners
        let all = view.renderer.stations.map(\.id)
        let parent = owners.values.sorted().first { owner in
          let count = owners.values.filter { $0 == owner }.count
          return count > 1 && count < all.count
        }
        focusDetails["allIDs"] = all
        if let parent {
          focusDetails["parent"] = parent
          focusDetails["memberIDs"] = all.filter { (owners[$0] ?? $0) == parent }
          focusDetails["requested"] = view.selectStation(parent)
        }
      }
      if elapsed >= 3, stage == 0 {
        stage = 1
        focusDetails["isolatedIDs"] = view.renderer.stations.map(\.id)
        focusDetails["selectedID"] = view.renderer.emphasis.selectedId ?? ""
        focusDetails["isolatedViews"] = view.renderer.frameSamples.last?["views"] ?? []
        focusDetails["fitBounds"] = [view.fitBounds.minX, view.fitBounds.minY, view.fitBounds.width, view.fitBounds.height]
        focusDetails["restored"] = view.showAll()
      }
      if elapsed >= 5 {
        stage = 2
        focusDetails["restoredIDs"] = view.renderer.stations.map(\.id)
        finish(status: "completed")
      }
      return
    }
    if token.hasPrefix("contact-") {
      let elapsed = time - startTime
      let next = Int(max(0, elapsed - 1) / 1.5)
      if elapsed >= 1, next != stage {
        stage = next
        if var sample = view.renderer.frameSamples.last {
          sample["fitBounds"] = [view.fitBounds.minX, view.fitBounds.minY, view.fitBounds.width, view.fitBounds.height]
          sample["camera"] = [view.map.camera.centerCoordinate.latitude, view.map.camera.centerCoordinate.longitude,
                              view.map.camera.centerCoordinateDistance]
          overviewReturns.append(sample)
        }
        if next >= 4 { finish(status: "completed"); return }
        let span = next.isMultiple(of: 2) ? 0.003 : 0.002
        view.setRegion(.init(center: center, span: .init(latitudeDelta: span, longitudeDelta: span)), animated: true)
        view.refresh()
      }
      return
    }
    if token.hasPrefix("rapid-") {
      let elapsed = time - startTime
      focusCameraSamples.append(["time": elapsed, "distance": view.map.camera.centerCoordinateDistance])
      let next = Int(max(0, elapsed - 1) / 0.34)
      if elapsed >= 1, next != stage, next <= 100 {
        stage = next
        if next == 50 {
          // A refresh changes the winner while glass is actively merging. The
          // former winner must explicitly lose its tint, including its badge.
          view.renderer.setStations(view.renderer.stations.map { station in
            ClusterLabStation(["id": station.id, "latitude": station.latitude,
              "longitude": station.longitude, "price": station.id == "lab-1" ? 2.99 : station.price,
              "name": station.name,
              "isRecommended": token.hasPrefix("rapid-recommended-") && station.id == "lab-2"])!
          })
        }
        let span = next.isMultiple(of: 2) ? 0.003 : 0.03
        view.setRegion(.init(center: center, span: .init(latitudeDelta: span, longitudeDelta: span)), animated: true)
        focusDetails["rapidZoomChanges"] = min(100, next + 1)
        view.refresh()
      }
      if elapsed >= 37 { finish(status: "completed") }
      return
    }
    if token.hasPrefix("roundtrip-") {
      let elapsed = time - startTime
      let next = Int(max(0, elapsed - 1) / 1.25)
      guard elapsed >= 1, next != stage else { return }
      stage = next
      if next.isMultiple(of: 2) {
        if var sample = view.renderer.frameSamples.last {
          sample["fitBounds"] = [view.fitBounds.minX, view.fitBounds.minY, view.fitBounds.width, view.fitBounds.height]
          sample["camera"] = [view.map.camera.centerCoordinate.latitude, view.map.camera.centerCoordinate.longitude,
                              view.map.camera.centerCoordinateDistance]
          overviewReturns.append(sample)
        }
        if next >= 12 { finish(status: "completed"); return }
        switch next / 2 % 3 {
        case 0: view.focusStation("lab-1")
        case 1:
          let camera = view.map.camera.copy() as! MKMapCamera
          camera.centerCoordinateDistance *= 2.5
          view.map.setCamera(camera, animated: true)
        default:
          let camera = view.map.camera.copy() as! MKMapCamera
          camera.heading = 35; camera.centerCoordinateDistance *= 0.7
          view.map.setCamera(camera, animated: true)
        }
      } else { view.showAll() }
      view.refresh()
      return
    }
    if token.hasPrefix("overview-") {
      let elapsed = time - startTime
      focusCameraSamples.append(["time": elapsed, "distance": view.map.camera.centerCoordinateDistance])
      if stage == -1 && elapsed >= 1 {
        stage = 0
        focusDetails["overviewDistance"] = view.map.camera.centerCoordinateDistance
        if token.hasPrefix("overview-rotated-") {
          let camera = view.map.camera.copy() as! MKMapCamera
          camera.heading = 35; view.map.setCamera(camera, animated: false)
        }
        focusDetails["focusRequested"] = view.focusStation("lab-0")
      }
      if stage == 0 && elapsed >= 2.5 {
        stage = 1
        focusDetails["focusedDistance"] = view.map.camera.centerCoordinateDistance
        overviewInset = view.bounds.height - view.fitBounds.maxY
        focusDetails["overviewRequested"] = view.showAll()
      }
      if token.hasPrefix("overview-layout-"), let inset = overviewInset {
        // Reproduce a native card measurement arriving during the camera flight.
        if elapsed >= 2.55 && !changedOverviewInset {
          changedOverviewInset = true
          view.setOverlayBottomInset(inset + 8)
        }
        if elapsed >= 2.75 && !restoredOverviewInset {
          restoredOverviewInset = true
          view.setOverlayBottomInset(inset)
        }
      }
      if stage == 1 && elapsed >= 4 {
        stage = 2
        focusDetails["returnedDistance"] = view.map.camera.centerCoordinateDistance
        focusDetails["returnedHeading"] = view.map.camera.heading
        focusDetails["returnedViews"] = view.renderer.frameSamples.last?["views"]
        // Interrupt a focus flight with overview; stale focus must never win.
        view.focusStation("lab-1")
      }
      if stage == 2 && elapsed >= 4.1 { stage = 3; view.showAll() }
      if elapsed >= 5.8 {
        focusDetails["finalDistance"] = view.map.camera.centerCoordinateDistance
        finish(status: "completed")
      }
      return
    }
    if token.hasPrefix("emphasis-") {
      let elapsed = time - startTime
      let times: [Double] = [1, 1.05, 1.10, 1.8, 2.2]
      let ids: [String?] = ["lab-0", "lab-1", "lab-0", nil, "lab-1"]
      if stage + 1 < times.count && elapsed >= times[stage + 1] {
        stage += 1
        view.renderer.emphasis.select(ids[stage])
        view.refresh()
      }
      if elapsed >= 3 { finish(status: "completed") }
      return
    }
    if token.hasPrefix("focus-") {
      let reference = CLLocationCoordinate2D(latitude: center.latitude, longitude: center.longitude + 0.001)
      let a = view.map.convert(center, toPointTo: view.map)
      let b = view.map.convert(reference, toPointTo: view.map)
      focusCameraSamples.append(["time": time - startTime,
                                 "distance": view.map.camera.centerCoordinateDistance,
                                 "projectedDistance": hypot(a.x - b.x, a.y - b.y)])
      if stage == -1 && time - startTime >= 1 {
        stage = 0
        baseline = view.renderer.frameSamples.last?["views"] as? [[String: Any]] ?? []
        focusDetails = ["beforeDistance": view.map.camera.centerCoordinateDistance,
                        "beforeHeading": view.map.camera.heading]
        let requestStart = CACurrentMediaTime()
        focusDetails["requested"] = view.focusStation("lab-0")
        focusDetails["requestMilliseconds"] = (CACurrentMediaTime() - requestStart) * 1000
      }
      if time - startTime >= 4 {
        focusDetails["afterDistance"] = view.map.camera.centerCoordinateDistance
        focusDetails["afterHeading"] = view.map.camera.heading
        let point = view.map.convert(center, toPointTo: view.map)
        let cameraCenter = CGPoint(x: view.fitBounds.midX, y: view.fitBounds.midY)
        focusDetails["centerError"] = hypot(point.x - cameraCenter.x, point.y - cameraCenter.y)
        finish(status: "completed")
      }
      return
    }
    if isFit {
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
      "focus": focusDetails, "startTime": startTime,
      "stationPrices": Dictionary(uniqueKeysWithValues: view.renderer.stations.map { ($0.id, $0.price) }),
      "focusCameraSamples": focusCameraSamples, "overviewReturns": overviewReturns,
      "cheapestStationID": view.renderer.cheapestStationID ?? "",
      "recommendedStationID": view.renderer.recommendedStationID ?? "",
      "marketScores": ClusterLabMarket.assess(view.renderer.stations.map {
        LabMarketQuote(id: $0.id, latitude: $0.latitude, longitude: $0.longitude, price: $0.price)
      }).mapValues { ($0.score * 20).rounded() / 20 },
      "usesNativeGlass": NSClassFromString("UIGlassContainerEffect") != nil,
      "nativeUserLocationVisible": view.map.showsUserLocation && view.map.isUserLocationVisible &&
        view.map.view(for: view.map.userLocation) != nil,
      "userLocationZPriority": view.map.view(for: view.map.userLocation)?.zPriority.rawValue ?? -1,
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
