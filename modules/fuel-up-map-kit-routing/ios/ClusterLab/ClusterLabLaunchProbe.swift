#if DEBUG
import MapKit

/// Opt-in cold-launch evidence from the real map. Never runs in release builds.
final class ClusterLabLaunchProbe {
  private let token = ProcessInfo.processInfo.environment["FUELUP_MAP_LAUNCH_PROBE"]
  private let started = CACurrentMediaTime()
  private var samples: [[String: Any]] = []
  private var fits: [[String: Any]] = []
  private var finished = false
  private var cameraProbeStarted = false

  init() {
    guard token != nil else { return }
    DispatchQueue.main.asyncAfter(deadline: .now() + 15) { [weak self] in self?.finish() }
  }

  func fit(animated: Bool, visible: Bool, contentReady: Bool, inset: CGFloat) {
    guard token != nil, !finished else { return }
    fits.append(["time": CACurrentMediaTime() - started, "animated": animated,
                 "alreadyVisible": visible, "contentReady": contentReady, "inset": inset])
  }

  func sample(map: MKMapView, visible: Bool, ready: Bool, count: Int, inset: CGFloat) {
    guard token != nil, !finished, samples.count < 2400 else { return }
    samples.append(["time": CACurrentMediaTime() - started, "visible": visible,
                    "ready": ready, "count": count, "inset": inset,
                    "distance": map.camera.centerCoordinateDistance])
  }

  // Separate opt-in regression on the real MKMapView. Location and station
  // setters run with the animation probe disabled, exactly as in production.
  func verifyCameraIfRequested(view: ClusterLabMapView, ready: Bool, inset: CGFloat) {
    guard !cameraProbeStarted, ready, view.renderer.stations.count > 1,
          let token = ProcessInfo.processInfo.environment["FUELUP_MAP_CAMERA_PROBE"] else { return }
    cameraProbeStarted = true
    let stations: [[String: Any]] = view.renderer.stations.map {
      ["id": $0.id, "latitude": $0.latitude, "longitude": $0.longitude,
       "price": $0.price.isFinite ? $0.price : 3.50, "name": $0.name,
       "isRecommended": $0.isRecommended]
    }
    var samples: [[String: Any]] = []
    func capture(_ phase: String) {
      let c = view.map.camera
      samples.append(["phase": phase, "latitude": c.centerCoordinate.latitude,
        "longitude": c.centerCoordinate.longitude, "distance": c.centerCoordinateDistance,
        "heading": c.heading, "pitch": c.pitch])
    }
    func update(_ offset: Double) {
      let c = view.map.camera.centerCoordinate
      view.setOrigin(["latitude": c.latitude + offset, "longitude": c.longitude + offset])
      view.mapView(view.map, didUpdate: view.map.userLocation)
      view.setStations(stations.reversed().map { station in
        var value = station
        value["price"] = (station["price"] as! Double) + offset
        return value
      })
      view.setOverlayBottomInset(inset + 20)
      view.setNeedsLayout()
      view.layoutIfNeeded()
    }
    func after(_ work: @escaping () -> Void) {
      DispatchQueue.main.asyncAfter(deadline: .now() + 3, execute: work)
    }
    after {
      capture("overview_before")
      update(0.04)
      after {
        capture("overview_after")
        let c = view.map.camera.copy() as! MKMapCamera
        c.centerCoordinate.latitude += 0.02
        c.centerCoordinate.longitude -= 0.02
        c.centerCoordinateDistance *= 0.6
        c.heading = 25
        view.map.setCamera(c, animated: false)
        after {
          capture("panned_before")
          update(0.06)
          after {
            capture("panned_after")
            let selected = view.focusStation(stations[0]["id"] as! String)
            after {
              capture("selected_before")
              update(0.08)
              after {
                capture("selected_after")
                let overview = view.showAll()
                after {
                  capture("show_all")
                  let report: [String: Any] = ["token": token, "samples": samples,
                    "selected": selected, "showAll": overview]
                  if let data = try? JSONSerialization.data(withJSONObject: report, options: [.sortedKeys]),
                     let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first {
                    try? data.write(to: documents.appendingPathComponent("map-camera-probe.json"), options: .atomic)
                  }
                  view.setStations(stations)
                  view.setOverlayBottomInset(inset)
                }
              }
            }
          }
        }
      }
    }
  }

  private func finish() {
    guard let token, !finished else { return }
    finished = true
    let report: [String: Any] = ["token": token, "samples": samples, "fits": fits]
    guard let data = try? JSONSerialization.data(withJSONObject: report, options: [.sortedKeys]),
          let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return }
    try? data.write(to: documents.appendingPathComponent("map-launch-probe.json"), options: .atomic)
  }
}

/// Opt-in repeatable cold/warm camera workload on the real station snapshot.
/// Durations measure app overlay CPU work, not GPU time or physical-phone FPS.
final class ClusterLabPerformanceProbe {
  private let token = ProcessInfo.processInfo.environment["FUELUP_MAP_PERFORMANCE_PROBE"]
  private var started = false
  private var phase = -1
  private var frames: [[String: Any]] = []
  private var stages: [[String: Any]] = []
  private var lastTime: Double?
  private(set) var ownsStations = false

  func record(time: Double, reconcile: Double, render: Double, projectionRequests: Int, projectionConversions: Int) {
    guard token != nil, phase >= 0, phase < 12, frames.count < 5000 else { return }
    frames.append(["phase": phase, "reconcileMs": reconcile * 1000,
      "renderMs": render * 1000, "projectionRequests": projectionRequests, "projectionConversions": projectionConversions, "intervalMs": lastTime.map { (time - $0) * 1000 } ?? 0])
    lastTime = time
  }

  func startIfRequested(view: ClusterLabMapView, ready: Bool) {
    guard token != nil, !started, ready, !view.renderer.stations.isEmpty else { return }
    started = true
    // Freeze the first snapshot/camera locally so later builds measure identical
    // input even when the hourly service refreshes. Only this opt-in probe uses it.
    let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
    let fixtureURL = documents.appendingPathComponent("map-performance-fixture.json")
    let c = view.map.camera
    var fixture: [String: Any] = ["stations": view.renderer.stations.map {
      ["id": $0.id, "latitude": $0.latitude, "longitude": $0.longitude,
       "price": $0.price.isFinite ? $0.price : 0, "name": $0.name,
       "comparisonPrice": $0.comparisonPrice.isFinite ? $0.comparisonPrice : 0,
       "highlightE85": $0.highlightE85, "isRecommended": $0.isRecommended,
       "fuelType": "e85", "offersE85": true] as [String: Any]
    }, "latitude": c.centerCoordinate.latitude, "longitude": c.centerCoordinate.longitude,
       "distance": c.centerCoordinateDistance, "heading": c.heading, "pitch": Double(c.pitch)]
    if let data = try? Data(contentsOf: fixtureURL),
       let saved = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { fixture = saved }
    else if let data = try? JSONSerialization.data(withJSONObject: fixture, options: [.sortedKeys]) {
      try? data.write(to: fixtureURL, options: .atomic)
    }
    guard let values = fixture["stations"] as? [[String: Any]],
          let latitude = fixture["latitude"] as? Double, let longitude = fixture["longitude"] as? Double,
          let distance = fixture["distance"] as? Double, let heading = fixture["heading"] as? Double,
          let pitch = fixture["pitch"] as? Double else { return }
    ownsStations = true
    view.renderer.setStations(values.compactMap(ClusterLabStation.init))
    view.map.setCamera(MKMapCamera(lookingAtCenter: .init(latitude: latitude, longitude: longitude),
      fromDistance: distance, pitch: pitch, heading: heading), animated: false)
    let original = view.map.camera.copy() as! MKMapCamera
    // Three identical cycles, including the first zoom that creates split pills.
    func step(_ index: Int) {
      guard index < 12 else {
        phase = 12
        stages.append(["phase": 12, "containers": ClusterLabGlass.containersCreated, "pills": ClusterLabGlass.pillsCreated])
        let report: [String: Any] = ["token": token!, "stationCount": view.renderer.stations.count,
          "fixture": fixture, "frames": frames, "stages": stages,
          "reuseChecksPassed": ClusterLabGlassGroups.verifyReuse() && ClusterLabRenderer.verifyPillReuse(),
          "presentationChecksPassed": ClusterLabPill.verifyPresentationUpdates(),
          "liveCacheValid": view.renderer.validIdlePills]
        if let data = try? JSONSerialization.data(withJSONObject: report, options: [.sortedKeys]),
           let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first {
          try? data.write(to: documents.appendingPathComponent("map-performance-probe.json"), options: .atomic)
        }
        ownsStations = false
        view.restoreStationsAfterProbe()
        return
      }
      phase = index; lastTime = nil
      stages.append(["phase": index, "containers": ClusterLabGlass.containersCreated,
                     "pills": ClusterLabGlass.pillsCreated])
      let camera = original.copy() as! MKMapCamera
      switch index % 4 {
      case 0: camera.centerCoordinateDistance *= 0.3
      case 2: camera.centerCoordinate.longitude += 0.04
      default: break
      }
      view.map.setCamera(camera, animated: true)
      DispatchQueue.main.asyncAfter(deadline: .now() + 2) { step(index + 1) }
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) { step(0) }
  }
}
#endif
