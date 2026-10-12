import MapKit

// Observe existing recognizers; do not install gestures, replace delegates, or
// alter MapKit/cluster animation. Programmatic camera changes produce no events.
@MainActor final class ClusterLabResearchInteraction: NSObject {
  private weak var map: MKMapView?
  private let emit: ([String: Any]) -> Void
  private let attached = NSHashTable<UIGestureRecognizer>.weakObjects()
  init(map: MKMapView, emit: @escaping ([String: Any]) -> Void) {
    self.map = map; self.emit = emit
    super.init()
    attach()
  }
  deinit {
    for gesture in attached.allObjects { gesture.removeTarget(self, action: #selector(changed(_:))) }
  }
  func attach() {
    guard let map else { return }
    func walk(_ view: UIView) {
      for gesture in view.gestureRecognizers ?? [] where kind(gesture) != nil && !attached.contains(gesture) {
        attached.add(gesture); gesture.addTarget(self, action: #selector(changed(_:)))
      }
      for child in view.subviews { walk(child) }
    }
    walk(map)
  }
  private func kind(_ gesture: UIGestureRecognizer) -> String? {
    if gesture is UIPinchGestureRecognizer { return "pinch" }
    if gesture is UIPanGestureRecognizer { return "pan" }
    if gesture is UIRotationGestureRecognizer { return "rotate" }
    if let tap = gesture as? UITapGestureRecognizer, tap.numberOfTapsRequired > 1 { return "double_tap" }
    return nil
  }
  @objc private func changed(_ gesture: UIGestureRecognizer) {
    guard let map, let kind = kind(gesture),
          gesture.state == .began || gesture.state == .ended || gesture.state == .cancelled else { return }
    let region = map.region
    emit(["surface": "home_map", "gesture": kind,
          "phase": gesture.state == .began ? "began" : gesture.state == .cancelled ? "cancelled" : "ended",
          "viewport": ["latitude": region.center.latitude, "longitude": region.center.longitude,
                       "latitudeDelta": region.span.latitudeDelta, "longitudeDelta": region.span.longitudeDelta,
                       "heading": map.camera.heading, "distanceMeters": map.camera.centerCoordinateDistance]])
  }
}
