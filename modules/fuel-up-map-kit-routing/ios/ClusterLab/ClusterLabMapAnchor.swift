import MapKit

// One native annotation carries the shared glass surface. MapKit owns its
// camera movement; the renderer owns only positions inside that surface.
final class ClusterLabMapAnchor {
  let annotation = MKPointAnnotation()
  let view: MKAnnotationView
  private let container: UIView
  private(set) var rebaseCount = 0
  private var placementDeadline: CFTimeInterval = 0
  private var cameraJumpDeadline: CFTimeInterval = 0
  var needsPlacementUpdate: Bool { CACurrentMediaTime() < placementDeadline }

  init(container: UIView) {
    self.container = container
    view = MKAnnotationView(annotation: annotation, reuseIdentifier: nil)
    view.displayPriority = .required
    view.canShowCallout = false
    view.isUserInteractionEnabled = false
    view.clipsToBounds = false
    view.bounds = CGRect(x: 0, y: 0, width: 1024, height: 1024)
    view.addSubview(container)
  }

  func attach(to map: MKMapView) {
    annotation.coordinate = map.centerCoordinate
    map.addAnnotation(annotation)
  }

  func prepareForCameraJump(to coordinate: CLLocationCoordinate2D) {
    // Move the coordinate in the same transaction, before MapKit culls the
    // previous viewport. A later isHidden assignment cannot clear its internal
    // offscreen visibility reason until the following frame.
    rebaseCount += 1
    placementDeadline = CACurrentMediaTime() + 0.1
    cameraJumpDeadline = placementDeadline
    annotation.coordinate = coordinate
  }

  func sample(map: MKMapView) -> [String: Any] {
    let origin = container.convert(CGPoint.zero, to: map)
    let padding = ClusterLabGeometry.containerPadding
    return ["attached": view.window != nil && view.isDescendant(of: map),
            "visible": !view.isHidden && view.alpha == 1,
            "originError": hypot(origin.x + padding, origin.y + padding),
            "rebaseCount": rebaseCount]
  }

  func layout(map: MKMapView) {
    guard map.bounds.width > 0, map.bounds.height > 0 else { return }
    UIView.performWithoutAnimation {
      var point = map.convert(annotation.coordinate, toPointTo: map)
      // Keep the sole annotation eligible for MapKit's visible-view lifecycle.
      // Rebasing moves no pills: its viewport-sized glass surface compensates
      // for the new anchor in this same transaction.
      if !map.bounds.insetBy(dx: 32, dy: 32).contains(point) {
        rebaseCount += 1
        // MapKit may finish its visibility/placement update on a subsequent
        // frame, including after a nonanimated jump has already ended.
        placementDeadline = CACurrentMediaTime() + 0.1
        annotation.coordinate = map.centerCoordinate
        map.layoutIfNeeded()
        point = map.convert(annotation.coordinate, toPointTo: map)
      }
      // A nonanimated camera jump can cull the old coordinate before MapKit
      // applies the annotation's new one. Repair only that stale placement;
      // ordinary subpixel positioning remains entirely owned by MapKit.
      if CACurrentMediaTime() < cameraJumpDeadline, let parent = view.superview {
        let expected = map.convert(point, to: parent)
        if hypot(view.center.x - expected.x, view.center.y - expected.y) > 2 {
          view.center = expected
        }
        view.isHidden = false
        view.alpha = 1
      }
      let padding = ClusterLabGeometry.containerPadding
      let size = CGSize(width: map.bounds.width + padding * 2,
                        height: map.bounds.height + padding * 2)
      view.bounds = CGRect(origin: .zero, size: size)
      container.frame = CGRect(x: size.width / 2 - point.x - padding,
                               y: size.height / 2 - point.y - padding,
                               width: size.width, height: size.height)
    }
  }
}
