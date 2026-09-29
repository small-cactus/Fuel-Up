import MapKit

// A single map-level recognizer keeps the glass carrier noninteractive and
// leaves native pan/pinch/rotate gestures in control. No button overlays.
final class ClusterLabFocusInteraction: NSObject, UIGestureRecognizerDelegate {
  private weak var view: ClusterLabMapView?

  init(view: ClusterLabMapView) {
    self.view = view
    super.init()
    let tap = UITapGestureRecognizer(target: self, action: #selector(tapped(_:)))
    tap.delegate = self
    tap.cancelsTouchesInView = false
    // Focus on finger-up; waiting for a possible second tap adds the system's
    // double-tap timeout before any calculation or camera movement can begin.
    view.map.addGestureRecognizer(tap)
    view.renderer.onFocus = { [weak view] id in view?.selectStation(id) ?? false }
  }

  func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
    guard let view else { return false }
    return view.renderer.station(at: touch.location(in: view.map), in: view.map) != nil
  }

  func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                         shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool { true }

  @objc private func tapped(_ tap: UITapGestureRecognizer) {
    guard tap.state == .ended, let view,
          let id = view.renderer.station(at: tap.location(in: view.map), in: view.map) else { return }
    view.selectStation(id)
  }
}

extension ClusterLabMapView {
  @discardableResult
  func focusStation(_ id: String) -> Bool {
    guard bounds.width > 0, bounds.height > 0,
          let station = renderer.stations.first(where: { $0.id == id }) else { return false }
    let points = renderer.stations.map { LabProjectedStation(id: $0.id, price: $0.price,
      point: map.convert($0.coordinate, toPointTo: map)) }
    // MapKit observes its current camera: mutating it applies the destination
    // immediately. Configure an independent copy so setCamera can animate
    // from the existing viewport to the calculated destination.
    guard let camera = map.camera.copy() as? MKMapCamera else { return false }
    let latitudeScale = MKMetersPerMapPointAtLatitude(station.latitude) /
      MKMetersPerMapPointAtLatitude(camera.centerCoordinate.latitude)
    let distance = camera.centerCoordinateDistance * latitudeScale
    guard distance.isFinite, distance > 0 else { return false }
    let minimumDistance = max(20, map.cameraZoomRange?.minCenterCoordinateDistance ?? 0)
    let dot = map.userLocation.location.map { map.convert($0.coordinate, toPointTo: map) }
    guard let plan = ClusterLabFocus.plan(id: id, stations: points, previous: renderer.clusterOwners,
      dot: dot, bounds: fitBounds, maximumScale: max(1, distance / minimumDistance)) else { return false }
    // Center the station in the unobscured map, above the React card. Project
    // that offset back through the existing heading before the native zoom.
    let point = map.convert(station.coordinate, toPointTo: map)
    let cameraCenter = map.convert(camera.centerCoordinate, toPointTo: map)
    camera.centerCoordinate = map.convert(CGPoint(
      x: point.x + (cameraCenter.x - fitBounds.midX) / plan.scale,
      y: point.y + (cameraCenter.y - fitBounds.midY) / plan.scale), toCoordinateFrom: map)
    camera.centerCoordinateDistance = min(camera.centerCoordinateDistance, distance / plan.scale)
    // Existing physical split/merge animation follows MapKit's actual movement.
    // No custom camera tween, intermediate camera probes, or gesture blocking.
    didFocusStation(id)
    map.setCamera(camera, animated: !UIAccessibility.isReduceMotionEnabled)
    refresh()
    return true
  }
}
