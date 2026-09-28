import ExpoModulesCore
import MapKit

final class ClusterLabMapView: ExpoView, MKMapViewDelegate {
  let map = MKMapView()
  let renderer = ClusterLabRenderer()
  private lazy var mapAnchor = ClusterLabMapAnchor(container: renderer.container)
  private var frameClock: ClusterLabFrameClock?
  private var lastTimestamp: CFTimeInterval = 0
  private var needsReconcile = true
  private var cameraMoving = false
  private var animationMoving = false
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
    mapAnchor.attach(to: map)
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
    observers.forEach(NotificationCenter.default.removeObserver)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    // Parent covers every visible pill and its offscreen approach. Extra space
    // includes the whole 84-point shell, refraction, and the +n displacement.
    map.frame = bounds
    mapAnchor.layout(map: map)
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
    setRegion(.init(center: origin!, span: .init(latitudeDelta: 0.06, longitudeDelta: 0.06)), animated: false)
    refresh()
  }

  func setRegion(_ region: MKCoordinateRegion, animated: Bool) {
    if !animated { mapAnchor.prepareForCameraJump(to: region.center) }
    map.setRegion(region, animated: animated)
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

  func mapView(_ mapView: MKMapView, regionWillChangeAnimated animated: Bool) {
    cameraMoving = true
    renderer.cameraBegan()
    refresh()
  }

  func mapViewDidChangeVisibleRegion(_ mapView: MKMapView) { refresh() }

  func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
    annotation === mapAnchor.annotation ? mapAnchor.view : nil
  }
  func mapView(_ mapView: MKMapView, regionDidChangeAnimated animated: Bool) {
    cameraMoving = false
    renderer.cameraEnded()
    refresh()
  }

  private var hasValidLayout: Bool {
    bounds.width > 0 && bounds.height > 0 && map.bounds.size == bounds.size &&
      renderer.container.bounds.size == bounds.insetBy(dx: -ClusterLabGeometry.containerPadding, dy: -ClusterLabGeometry.containerPadding).size
  }

  func refresh() {
    guard active, window != nil, hasValidLayout, UIApplication.shared.applicationState != .background else { return }
    needsReconcile = true
    startFrames()
    // Older UIKit has no late-commit observer. Keep its immediate delegate
    // update as a fallback; modern iOS coalesces all updates into one frame.
    if frameClock?.synchronizesWithCommit == false {
      mapAnchor.layout(map: map)
      renderer.reconcile(map: map)
      needsReconcile = false
      animationMoving = renderer.render(map: map, deltaTime: 0)
    }
    startPendingProbe()
  }

  private func startFrames() {
    if frameClock == nil {
      lastTimestamp = 0
      frameClock = ClusterLabFrameClock(view: map) { [weak self] time in self?.tick(time) }
    }
    frameClock?.requestContinuous(true)
  }

  private func stopFrames() {
    frameClock = nil; lastTimestamp = 0; cameraMoving = false
  }

  private func tick(_ time: CFTimeInterval) {
    guard active, window != nil, hasValidLayout, UIApplication.shared.applicationState != .background else { return }
    guard needsReconcile || cameraMoving || animationMoving || mapAnchor.needsPlacementUpdate || probe != nil else {
      frameClock?.requestContinuous(false)
      lastTimestamp = 0
      return
    }
    let elapsed = lastTimestamp == 0 ? 1.0 / Double(window?.screen.maximumFramesPerSecond ?? 60) : max(0, time - lastTimestamp)
    lastTimestamp = time
    probe?.tick(time: time)
    mapAnchor.layout(map: map)
    if needsReconcile || cameraMoving {
      needsReconcile = false
      renderer.reconcile(map: map)
    }
    animationMoving = renderer.render(map: map, deltaTime: elapsed)
    probe?.recordAnchor(mapAnchor.sample(map: map))
    let continuous = needsReconcile || cameraMoving || animationMoving || mapAnchor.needsPlacementUpdate || probe != nil
    frameClock?.requestContinuous(continuous)
    if !continuous { lastTimestamp = 0 }
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
