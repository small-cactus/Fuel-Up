import ExpoModulesCore
import MapKit

// CADisplayLink retains its target. The weak proxy allows tab/view teardown to
// release the map even when an animation was interrupted mid-frame.
private final class LabDisplayLinkTarget: NSObject {
  weak var owner: ClusterLabMapView?
  @objc func tick(_ link: CADisplayLink) { owner?.tick(link) }
}

final class ClusterLabMapView: ExpoView, MKMapViewDelegate {
  let map = MKMapView()
  let renderer = ClusterLabRenderer()
  private let linkTarget = LabDisplayLinkTarget()
  private var displayLink: CADisplayLink?
  private var lastTimestamp: CFTimeInterval = 0
  private var active = false
  private var origin: CLLocationCoordinate2D?
  private var latestOriginValue: [String: Double]?
  private var observers: [NSObjectProtocol] = []
  private var pendingProbe: String?
  private var lastProbe: String?
  private var latestStations: [ClusterLabStation] = []
  var probe: ClusterLabProbe?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = false
    map.delegate = self
    map.showsCompass = false
    map.showsScale = false
    map.showsUserLocation = false
    map.isPitchEnabled = false
    map.pointOfInterestFilter = .excludingAll
    map.setRegion(MKCoordinateRegion(center: .init(latitude: 37.3346, longitude: -122.009),
                                    span: .init(latitudeDelta: 0.06, longitudeDelta: 0.06)), animated: false)
    addSubview(map)
    addSubview(renderer.container)
    linkTarget.owner = self
    observers.append(NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification,
                                                            object: nil, queue: .main) { [weak self] _ in
      self?.probe?.cancel()
      self?.stopFrames()
    })
    observers.append(NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification,
                                                            object: nil, queue: .main) { [weak self] _ in self?.refresh() })
    for name in [UIAccessibility.reduceMotionStatusDidChangeNotification, UIAccessibility.reduceTransparencyStatusDidChangeNotification] {
      observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in self?.refresh() })
    }
  }

  deinit {
    displayLink?.invalidate()
    observers.forEach(NotificationCenter.default.removeObserver)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    // Parent covers every visible pill and its offscreen approach. Extra space
    // includes the whole 84-point shell, refraction, and the +n displacement.
    renderer.container.frame = bounds.insetBy(dx: -ClusterLabGeometry.containerPadding, dy: -ClusterLabGeometry.containerPadding)
    map.frame = bounds
    refresh()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil { probe?.cancel(); stopFrames() } else { refresh() }
  }

  func setStations(_ values: [[String: Any]]) {
    var seen = Set<String>()
    latestStations = values.compactMap(ClusterLabStation.init).filter { seen.insert($0.id).inserted }
    guard probe == nil else { return }
    renderer.setStations(latestStations)
    refresh()
  }

  func restoreStationsAfterProbe() { renderer.setStations(latestStations) }

  func restoreOriginAfterProbe() {
    if let latestOriginValue { setOrigin(latestOriginValue) }
  }

  func setOrigin(_ value: [String: Double]) {
    guard let latitude = value["latitude"], let longitude = value["longitude"],
          CLLocationCoordinate2DIsValid(.init(latitude: latitude, longitude: longitude)) else { return }
    latestOriginValue = value
    guard probe == nil else { return }
    if let origin, abs(origin.latitude - latitude) < 0.00001 && abs(origin.longitude - longitude) < 0.00001 { return }
    origin = .init(latitude: latitude, longitude: longitude)
    map.setRegion(.init(center: origin!, span: .init(latitudeDelta: 0.06, longitudeDelta: 0.06)), animated: false)
    refresh()
  }

  func setDark(_ value: Bool) {
    overrideUserInterfaceStyle = value ? .dark : .light
    renderer.dark = value
    refresh()
  }

  func setActive(_ value: Bool) {
    active = value
    if active { refresh() } else {
      probe?.cancel()
      stopFrames()
    }
  }

  func mapView(_ mapView: MKMapView, regionWillChangeAnimated animated: Bool) { renderer.cameraBegan() }

  func mapViewDidChangeVisibleRegion(_ mapView: MKMapView) { refresh() }
  func mapView(_ mapView: MKMapView, regionDidChangeAnimated animated: Bool) { renderer.cameraEnded(); refresh() }

  private var hasValidLayout: Bool {
    bounds.width > 0 && bounds.height > 0 && map.bounds.size == bounds.size &&
      renderer.container.frame == bounds.insetBy(dx: -ClusterLabGeometry.containerPadding, dy: -ClusterLabGeometry.containerPadding)
  }

  func refresh() {
    guard active, window != nil, hasValidLayout, UIApplication.shared.applicationState != .background else { return }
    renderer.reconcile(map: map)
    let moving = renderer.render(map: map, deltaTime: 0)
    if moving || probe != nil { startFrames() }
    startPendingProbe()
  }

  private func startFrames() {
    guard displayLink == nil else { return }
    lastTimestamp = 0
    let link = CADisplayLink(target: linkTarget, selector: #selector(LabDisplayLinkTarget.tick(_:)))
    link.preferredFrameRateRange = CAFrameRateRange(minimum: 60, maximum: 120, preferred: 120)
    link.add(to: .main, forMode: .common)
    displayLink = link
  }

  private func stopFrames() {
    displayLink?.invalidate(); displayLink = nil; lastTimestamp = 0
  }

  fileprivate func tick(_ link: CADisplayLink) {
    let elapsed = lastTimestamp == 0 ? link.duration : link.timestamp - lastTimestamp
    lastTimestamp = link.timestamp
    probe?.tick(time: link.timestamp)
    let moving = renderer.render(map: map, deltaTime: elapsed)
    if !moving && probe == nil { stopFrames() }
  }

  func requestProbe(_ token: String?) {
    #if DEBUG
    guard let token, !token.isEmpty, token != lastProbe else { return }
    pendingProbe = token
    startPendingProbe()
    #endif
  }

  private func startPendingProbe() {
    guard active, window != nil, hasValidLayout, let token = pendingProbe, probe == nil else { return }
    pendingProbe = nil; lastProbe = token
    probe = ClusterLabProbe(view: self, token: token)
    probe?.start()
    startFrames()
  }
}
