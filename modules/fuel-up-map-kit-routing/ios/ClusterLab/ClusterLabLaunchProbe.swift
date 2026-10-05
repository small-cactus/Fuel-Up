#if DEBUG
import MapKit

/// Opt-in cold-launch evidence from the real map. Never runs in release builds.
final class ClusterLabLaunchProbe {
  private let token = ProcessInfo.processInfo.environment["FUELUP_MAP_LAUNCH_PROBE"]
  private let started = CACurrentMediaTime()
  private var samples: [[String: Any]] = []
  private var fits: [[String: Any]] = []
  private var finished = false

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

  private func finish() {
    guard let token, !finished else { return }
    finished = true
    let report: [String: Any] = ["token": token, "samples": samples, "fits": fits]
    guard let data = try? JSONSerialization.data(withJSONObject: report, options: [.sortedKeys]),
          let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return }
    try? data.write(to: documents.appendingPathComponent("map-launch-probe.json"), options: .atomic)
  }
}
#endif
