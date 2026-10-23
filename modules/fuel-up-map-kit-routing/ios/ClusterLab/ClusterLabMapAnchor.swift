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
  private var translation = CGPoint.zero
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
            "originError": hypot(origin.x + padding - translation.x, origin.y + padding - translation.y),
            "rebaseCount": rebaseCount]
  }

  func layout(map: MKMapView, translation: CGPoint? = nil) {
    if let translation { self.translation = translation }
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
      let bounds = CGRect(origin: .zero, size: size)
      if view.bounds != bounds { view.bounds = bounds }
      let frame = CGRect(x: size.width / 2 - point.x - padding + self.translation.x,
                         y: size.height / 2 - point.y - padding + self.translation.y,
                         width: size.width, height: size.height)
      // A settled pan is carried by MapKit's annotation. Do not invalidate the
      // glass hierarchy for subpixel cancellation noise in coordinate conversion.
      if container.frame.size != frame.size ||
          hypot(container.frame.minX - frame.minX, container.frame.minY - frame.minY) > 0.01 {
        container.frame = frame
      }
    }
  }
}

// Immutable geometry from the last fully rendered frame. Reconciliation still
// checks exact live ownership on every camera frame; only UIKit rendering is
// reused. The reference never advances during reuse, so error cannot accumulate.
struct ClusterLabPanLayout {
  #if DEBUG
  static var lastFailure = "not-attempted"
  #endif
  let points: [String: CGPoint]
  let owners: [String: String]
  let contacts: [String: CGFloat]
  let groupFrames: [String: CGRect]
  let clearanceTargets: [String: CGFloat]
  let dot: CGPoint?
  let bounds: CGRect
  let safeBounds: CGRect
  let mapSize: MKMapSize
  let heading: Double
  let selected: String?
  let dark: Bool
  let reducedMotion: Bool

  func translation(points next: [String: CGPoint], owners: [String: String], contacts: [String: CGFloat],
                   dot: CGPoint?, map: MKMapView, selected: String?, dark: Bool) -> CGPoint? {
    #if DEBUG
    Self.lastFailure = "camera-or-state"
    #endif
    guard map.camera.pitch == 0, map.camera.heading == heading,
          abs(map.visibleMapRect.size.width / mapSize.width - 1) * bounds.width < 0.000001,
          abs(map.visibleMapRect.size.height / mapSize.height - 1) * bounds.height < 0.000001,
          map.bounds == bounds, map.bounds.inset(by: map.safeAreaInsets).insetBy(dx: 15, dy: 15) == safeBounds,
          self.selected == selected, self.dark == dark, reducedMotion == UIAccessibility.isReduceMotionEnabled,
          self.owners == owners,
          self.contacts.count == contacts.count, self.contacts.allSatisfy({ abs($0.value - (contacts[$0.key] ?? .infinity)) < 0.00001 }),
          points.count == next.count,
          let first = points.first, let current = next[first.key] else { return nil }
    #if DEBUG
    Self.lastFailure = "projection"
    #endif
    let delta = CGPoint(x: current.x - first.value.x, y: current.y - first.value.y)
    // Bound residual against the original render, including every member, not
    // just cluster owners. Zoom/rotation/perspective always take the full path.
    for (id, point) in points {
      guard let p = next[id],
            hypot(p.x - point.x - delta.x, p.y - point.y - delta.y) < 0.00001 else { return nil }
    }
    #if DEBUG
    Self.lastFailure = "dot"
    #endif
    if let old = self.dot, let dot {
      guard hypot(dot.x - old.x - delta.x, dot.y - old.y - delta.y) < 0.00001 else { return nil }
    } else if (self.dot == nil) != (dot == nil) { return nil }
    #if DEBUG
    Self.lastFailure = "clearance"
    #endif
    let frames = groupFrames.mapValues { $0.offsetBy(dx: delta.x, dy: delta.y) }
    let targets = ClusterLabLocationClearance.targets(frames: frames, dot: dot, bounds: safeBounds)
    if let failed = targets.first(where: { abs($0.value - (clearanceTargets[$0.key] ?? 0)) >= 0.00001 }) {
      #if DEBUG
      Self.lastFailure = "clearance:\(failed.key):\(failed.value):\(clearanceTargets[failed.key] ?? 0)"
      #endif
      return nil
    }
    #if DEBUG
    Self.lastFailure = "reused"
    #endif
    return delta
  }
}
