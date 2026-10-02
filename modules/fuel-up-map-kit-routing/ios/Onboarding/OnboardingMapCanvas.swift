import MapKit

struct OnboardingStation: Equatable {
  let id: String
  let name: String
  let latitude: Double
  let longitude: Double
  init?(_ value: [String: Any]) {
    guard let id = value["id"] as? String, let lat = value["latitude"] as? Double,
          let lon = value["longitude"] as? Double,
          CLLocationCoordinate2DIsValid(.init(latitude: lat, longitude: lon)) else { return nil }
    self.id = id; name = value["name"] as? String ?? "Gas station"; latitude = lat; longitude = lon
  }
}

// The camera fits the maximum radius once. Pinching resizes only the selection.
final class OnboardingMapCanvas: UIView, MKMapViewDelegate {
  private let map = MKMapView()
  private let circle = CAShapeLayer()
  private var coordinate: CLLocationCoordinate2D?
  private var radius = 5.0
  private var pinchStartRadius = 5.0
  private var lastSize = CGSize.zero
  private var isPinching = false
  var radiusChanged: ((Double, Bool) -> Void)?

  override init(frame: CGRect) {
    super.init(frame: frame)
    map.delegate = self; map.showsUserLocation = true
    map.isScrollEnabled = false; map.isZoomEnabled = false
    map.isRotateEnabled = false; map.isPitchEnabled = false
    map.pointOfInterestFilter = .excludingAll; map.showsCompass = false
    addSubview(map)
    circle.fillColor = UIColor.systemBlue.withAlphaComponent(0.12).cgColor
    circle.strokeColor = UIColor.systemBlue.withAlphaComponent(0.85).cgColor
    circle.lineWidth = 2
    layer.addSublayer(circle)
    addGestureRecognizer(UIPinchGestureRecognizer(target: self, action: #selector(pinched(_:))))
    isAccessibilityElement = true; accessibilityTraits = .adjustable
    accessibilityLabel = "Search area"
    accessibilityHint = "Swipe up or down to change the radius by one mile."
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  override func layoutSubviews() {
    super.layoutSubviews(); map.frame = bounds
    if lastSize != bounds.size { lastSize = bounds.size; fitMaximum() }
    drawCircle(animated: false)
  }
  func update(coordinate: CLLocationCoordinate2D, radius: Double, adjustingRadius: Bool) {
    let moved = self.coordinate?.latitude != coordinate.latitude || self.coordinate?.longitude != coordinate.longitude
    self.coordinate = coordinate
    if moved { fitMaximum() }
    let changed = self.radius != radius
    self.radius = RadiusSelection.clamp(radius)
    if changed && !isPinching { drawCircle(animated: !adjustingRadius) }
  }
  private func fitMaximum() {
    guard let coordinate, bounds.width > 0, bounds.height > 0 else { return }
    // Equal insets preserve the user's position at the center. Width sets the
    // full 15-mile diameter on portrait phones; rotation refits only the camera.
    let area = MKCircle(center: coordinate, radius: RadiusSelection.maximum * 1609.344)
    map.setVisibleMapRect(area.boundingMapRect, edgePadding: .init(top: 24, left: 24, bottom: 24, right: 24), animated: false)
  }
  private func drawCircle(animated: Bool) {
    guard let coordinate, map.visibleMapRect.width > 0 else { return }
    let center = map.convert(coordinate, toPointTo: self)
    let pixels = radius * 1609.344 * MKMapPointsPerMeterAtLatitude(coordinate.latitude) / map.visibleMapRect.width * bounds.width
    let path = UIBezierPath(ovalIn: CGRect(x: center.x - pixels, y: center.y - pixels, width: pixels * 2, height: pixels * 2)).cgPath
    let from = circle.presentation()?.path ?? circle.path
    CATransaction.begin(); CATransaction.setDisableActions(true); circle.path = path; CATransaction.commit()
    if animated && !UIAccessibility.isReduceMotionEnabled, let from {
      let snap = CASpringAnimation(keyPath: "path")
      snap.fromValue = from; snap.toValue = path; snap.mass = 1; snap.stiffness = 260; snap.damping = 25
      snap.duration = min(0.45, snap.settlingDuration); circle.add(snap, forKey: "radius-snap")
    }
    accessibilityValue = "\(Int(radius.rounded())) miles"
  }
  @objc private func pinched(_ gesture: UIPinchGestureRecognizer) {
    switch gesture.state {
    case .began:
      isPinching = true; pinchStartRadius = radius; circle.removeAnimation(forKey: "radius-snap")
      radiusChanged?(radius, false)
    case .changed:
      radius = RadiusSelection.scaled(pinchStartRadius, by: Double(gesture.scale))
      drawCircle(animated: false); radiusChanged?(radius, false)
    case .ended, .cancelled:
      isPinching = false; radius = RadiusSelection.snap(radius)
      drawCircle(animated: true); radiusChanged?(radius, true)
      UISelectionFeedbackGenerator().selectionChanged()
    default: break
    }
  }
  override func accessibilityIncrement() { setAccessibleRadius(radius + 1) }
  override func accessibilityDecrement() { setAccessibleRadius(radius - 1) }
  private func setAccessibleRadius(_ value: Double) {
    radius = RadiusSelection.snap(value); drawCircle(animated: true); radiusChanged?(radius, true)
  }
  func mapViewDidChangeVisibleRegion(_ mapView: MKMapView) { drawCircle(animated: false) }
}
