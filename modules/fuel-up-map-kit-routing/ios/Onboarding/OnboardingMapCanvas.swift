import MapKit

struct OnboardingStation: Equatable {
  let id: String
  let name: String
  let latitude: Double
  let longitude: Double
  var coordinate: CLLocationCoordinate2D { .init(latitude: latitude, longitude: longitude) }
  init?(_ value: [String: Any]) {
    guard let id = value["id"] as? String, let lat = value["latitude"] as? Double,
          let lon = value["longitude"] as? Double,
          CLLocationCoordinate2DIsValid(.init(latitude: lat, longitude: lon)) else { return nil }
    self.id = id; name = value["name"] as? String ?? "Gas station"; latitude = lat; longitude = lon
  }
}

private final class RadiusStationAnnotation: MKPointAnnotation {
  let id: String
  var count = 1
  init(_ station: OnboardingStation) {
    id = station.id
    super.init()
    coordinate = station.coordinate; title = station.name
  }
}

// The preview keeps one MapKit view alive. Slider changes are coalesced at the
// display cadence; inventory and distances are cached independently of radius.
final class OnboardingMapCanvas: UIView, MKMapViewDelegate {
  private let map = MKMapView()
  private var clock: ClusterLabFrameClock?
  private var origin: CLLocationCoordinate2D?
  private var radius = 5.0
  private var stations: [OnboardingStation] = []
  private var distances: [String: CLLocationDistance] = [:]
  private var circle: MKCircle?
  private var markers: [String: RadiusStationAnnotation] = [:]
  private var owners: [String: String] = [:]
  private var pendingCamera = true
  private var animateCameraChange = false
  private var hasFitted = false
  private var pendingClusters = true
  private var lastSize = CGSize.zero

  override init(frame: CGRect) {
    super.init(frame: frame)
    map.delegate = self; map.showsUserLocation = true
    map.isScrollEnabled = false; map.isZoomEnabled = false
    map.isRotateEnabled = false; map.isPitchEnabled = false
    map.pointOfInterestFilter = .excludingAll; map.showsCompass = false
    map.isAccessibilityElement = false
    addSubview(map)
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  override func layoutSubviews() {
    super.layoutSubviews(); map.frame = bounds
    if lastSize != bounds.size { lastSize = bounds.size; pendingCamera = true; wake() }
  }
  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil { clock = nil }
    else { clock = ClusterLabFrameClock(view: self) { [weak self] _ in self?.tick() }; wake() }
  }
  func update(coordinate: CLLocationCoordinate2D, radius: Double, stations: [OnboardingStation], adjustingRadius: Bool) {
    let originChanged = origin?.latitude != coordinate.latitude || origin?.longitude != coordinate.longitude
    if originChanged || stations != self.stations {
      let location = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
      distances = Dictionary(stations.map { ($0.id, location.distance(from: CLLocation(latitude: $0.latitude, longitude: $0.longitude))) }, uniquingKeysWith: { first, _ in first })
      self.stations = stations; pendingClusters = true
    }
    if originChanged || radius != self.radius { pendingCamera = true; pendingClusters = true }
    animateCameraChange = !adjustingRadius && hasFitted && !UIAccessibility.isReduceMotionEnabled
    origin = coordinate; self.radius = radius; wake()
  }
  private func wake() { clock?.requestContinuous(pendingCamera || pendingClusters) }
  private func tick() {
    guard let origin, bounds.width > 0, bounds.height > 0 else { return }
    if pendingCamera {
      pendingCamera = false
      if let circle { map.removeOverlay(circle) }
      let next = MKCircle(center: origin, radius: radius * 1609.344)
      circle = next; map.addOverlay(next)
      // Follow the finger directly; no queued animation can lag behind a reversal.
      map.setVisibleMapRect(next.boundingMapRect, edgePadding: .init(top: 24, left: 30, bottom: 24, right: 30), animated: animateCameraChange)
      hasFitted = true
      pendingClusters = true
    }
    if pendingClusters { pendingClusters = false; updateClusters() }
    wake()
  }
  private func updateClusters() {
    let visible = stations.filter { (distances[$0.id] ?? .infinity) <= radius * 1609.344 }
    let projected = visible.map { LabProjectedStation(id: $0.id, price: 0, point: map.convert($0.coordinate, toPointTo: map)) }
    // Shared Home contact/ownership algorithm, adapted to icon-width markers.
    owners = ClusterLabGeometry.owners(projected, previous: owners, pillWidth: 44)
    let counts = Dictionary(owners.values.map { ($0, 1) }, uniquingKeysWith: +)
    let represented = visible.filter { owners[$0.id] == $0.id }
    let ids = Set(represented.map(\.id))
    for id in Array(markers.keys) where !ids.contains(id) {
      if let marker = markers.removeValue(forKey: id) { map.removeAnnotation(marker) }
    }
    for station in represented {
      let marker = markers[station.id] ?? RadiusStationAnnotation(station)
      marker.count = counts[station.id] ?? 1
      if markers[station.id] == nil { markers[station.id] = marker; map.addAnnotation(marker) }
      (map.view(for: marker) as? RadiusStationView)?.update(marker)
    }
  }
  func mapViewDidChangeVisibleRegion(_ mapView: MKMapView) { pendingClusters = true; wake() }
  func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
    guard let station = annotation as? RadiusStationAnnotation else { return nil }
    let view = mapView.dequeueReusableAnnotationView(withIdentifier: "radius-station") as? RadiusStationView ?? RadiusStationView(annotation: station, reuseIdentifier: "radius-station")
    view.annotation = station; view.update(station); return view
  }
  func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
    let renderer = MKCircleRenderer(overlay: overlay)
    renderer.strokeColor = UIColor.systemBlue.withAlphaComponent(0.65)
    renderer.fillColor = UIColor.systemBlue.withAlphaComponent(0.06)
    renderer.lineWidth = 1.5
    return renderer
  }
}

private final class RadiusStationView: MKAnnotationView {
  private let glass = ClusterLabGlass.pill()
  private let icon = UIImageView(image: UIImage(systemName: "fuelpump.fill"))
  private let label = UILabel()
  override init(annotation: MKAnnotation?, reuseIdentifier: String?) {
    super.init(annotation: annotation, reuseIdentifier: reuseIdentifier)
    displayPriority = .required; collisionMode = .rectangle; isUserInteractionEnabled = false
    addSubview(glass)
    if #available(iOS 26.0, *), let effect = glass as? UIVisualEffectView { effect.effect = UIGlassEffect(style: .regular) }
    let content = ClusterLabGlass.content(of: glass)
    content.addSubview(icon); content.addSubview(label)
    icon.contentMode = .scaleAspectFit; icon.tintColor = .label
    label.font = .systemFont(ofSize: 13, weight: .semibold); label.textColor = .label
    isAccessibilityElement = true
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  func update(_ station: RadiusStationAnnotation) {
    let clustered = station.count > 1
    bounds = CGRect(x: 0, y: 0, width: clustered ? 72 : 44, height: 32)
    glass.frame = bounds
    icon.frame = CGRect(x: clustered ? 12 : 14, y: 8, width: 16, height: 16)
    label.frame = CGRect(x: 32, y: 0, width: 38, height: 32)
    label.text = clustered ? "+\(station.count - 1)" : nil
    accessibilityLabel = clustered ? "\(station.count) gas stations" : station.title
  }
}
