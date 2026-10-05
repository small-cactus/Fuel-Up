import ExpoModulesCore
import MapKit

final class ClusterLabMapView: ExpoView, MKMapViewDelegate {
  let map = MKMapView()
  let renderer = ClusterLabRenderer()
  let onMapReady = EventDispatcher()
  private var reportedMapReady = false
  private var contentReady = false
  private var hasRenderedMap = false
  private var hasPresentedStations = false
  private var revealed = false
  let onStationSelect = EventDispatcher()
  let onOverviewChange = EventDispatcher()
  private var overview = true
  private var overviewDestination: MKMapCamera?
  private var fittedOverview: (stations: [ClusterLabStation], bounds: CGRect, location: CGPoint?, camera: MKMapCamera)?
  private var overlayBottomInset: CGFloat = 0
  private var focusedStationId: String?
  private lazy var mapAnchor = ClusterLabMapAnchor(container: renderer.container)
  private var focusInteraction: ClusterLabFocusInteraction?
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
  private var needsCameraFit = true
  private var animateDeferredFit = false
  private var fittedSize = CGSize.zero
  private var fittedInsets = UIEdgeInsets.zero
  private var isFittingCamera = false
  var probe: ClusterLabProbe?
  #if DEBUG
  private let launchProbe = ClusterLabLaunchProbe()
  #endif

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
    focusInteraction = ClusterLabFocusInteraction(view: self)
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
    if bounds.size != fittedSize || safeAreaInsets != fittedInsets { needsCameraFit = true }
    mapAnchor.layout(map: map)
    refresh()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil { probe?.cancel(); stopFrames() } else { refresh() }
  }

  override func safeAreaInsetsDidChange() {
    super.safeAreaInsetsDidChange()
    needsCameraFit = true
    refresh()
  }

  func setStations(_ values: [[String: Any]]) {
    var seen = Set<String>()
    let next = values.compactMap(ClusterLabStation.init).filter { seen.insert($0.id).inserted }
    if next != latestStations { needsCameraFit = true }
    latestStations = next
    guard probe == nil else { return }
    renderer.setStations(latestStations)
    refresh()
  }

  func restoreStationsAfterProbe() { renderer.setStations(latestStations); needsCameraFit = true }

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
    needsCameraFit = true
    if latestStations.isEmpty {
      setRegion(.init(center: origin!, span: .init(latitudeDelta: 0.06, longitudeDelta: 0.06)),
                animated: revealed && !UIAccessibility.isReduceMotionEnabled)
    }
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
    if value && !active { needsCameraFit = true; focusedStationId = nil; renderer.emphasis.reset() }
    if !value || needsCameraFit { renderer.container.isHidden = true }
    active = value
    map.showsUserLocation = value
    if active { refresh() } else {
      probe?.cancel()
      stopFrames()
    }
  }

  func mapView(_ mapView: MKMapView, regionWillChangeAnimated animated: Bool) {
    if !isFittingCamera && !needsCameraFit && overviewDestination == nil {
      renderer.endOverview()
      setOverview(false)
    }
    cameraMoving = true
    renderer.cameraBegan()
    refresh()
  }

  func mapViewDidFinishRenderingMap(_ mapView: MKMapView, fullyRendered: Bool) {
    if fullyRendered { hasRenderedMap = true }
    refresh()
  }

  func setContentReady(_ ready: Bool) {
    contentReady = ready
    refresh()
  }

  func setRevealed(_ value: Bool) { revealed = value }

  private func reportReadyIfNeeded() {
    guard !reportedMapReady, contentReady, origin != nil, hasRenderedMap,
          !cameraMoving, latestStations.isEmpty || (hasPresentedStations && !needsCameraFit) else { return }
    reportedMapReady = true
    onMapReady([:])
  }

  func mapViewDidChangeVisibleRegion(_ mapView: MKMapView) { refresh() }

  func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
    annotation === mapAnchor.annotation ? mapAnchor.view : nil
  }

  func mapView(_ mapView: MKMapView, didAdd views: [MKAnnotationView]) {
    for view in views where view.annotation is MKUserLocation {
      view.zPriority = .max
      view.selectedZPriority = .max
    }
    refresh()
  }

  func mapView(_ mapView: MKMapView, didUpdate userLocation: MKUserLocation) {
    // A delayed first GPS fix can arrive after stations. Keep it visible in
    // overview, but never interrupt a user's pan, station focus, or camera flight.
    if overview && !cameraMoving && probe == nil, let coordinate = framingLocation {
      let point = map.convert(coordinate, toPointTo: map)
      if !fitBounds.insetBy(dx: 16, dy: 16).contains(point) { needsCameraFit = true }
    }
    refresh()
  }

  private var framingLocation: CLLocationCoordinate2D? {
    if let location = map.userLocation.location, location.horizontalAccuracy >= 0,
       CLLocationCoordinate2DIsValid(location.coordinate) { return location.coordinate }
    return origin
  }
  func mapView(_ mapView: MKMapView, regionDidChangeAnimated animated: Bool) {
    if !isFittingCamera, let destination = overviewDestination {
      overviewDestination = nil
      let camera = map.camera
      let target = CLLocation(latitude: destination.centerCoordinate.latitude, longitude: destination.centerCoordinate.longitude)
      let actual = CLLocation(latitude: camera.centerCoordinate.latitude, longitude: camera.centerCoordinate.longitude)
      // A gesture may interrupt the overview flight. Only the completed target
      // counts as overview; otherwise keep the return action available.
      if actual.distance(from: target) > 1 ||
          abs(camera.centerCoordinateDistance / destination.centerCoordinateDistance - 1) > 0.005 ||
          abs(camera.heading - destination.heading) > 0.1 {
        renderer.endOverview()
        setOverview(false)
      }
    }
    cameraMoving = false
    renderer.cameraEnded()
    refresh()
  }

  private var hasValidLayout: Bool {
    bounds.width > 0 && bounds.height > 0 && map.bounds.size == bounds.size &&
      renderer.container.bounds.size == bounds.insetBy(dx: -ClusterLabGeometry.containerPadding, dy: -ClusterLabGeometry.containerPadding).size
  }

  var fitBounds: CGRect {
    // Points are the native iOS layout unit. The 2pt allowance also protects the
    // requested 15pt empty margin from projection rounding and glass refraction.
    bounds.inset(by: UIEdgeInsets(top: safeAreaInsets.top + 17, left: safeAreaInsets.left + 17,
                                 bottom: max(safeAreaInsets.bottom + 17, min(overlayBottomInset, bounds.height - safeAreaInsets.top - 64)),
                                 right: safeAreaInsets.right + 17))
  }

  func setOverlayBottomInset(_ value: CGFloat) {
    guard value.isFinite, abs(value - overlayBottomInset) > 1 else { return }
    overlayBottomInset = max(0, value)
    needsCameraFit = true
    refresh()
  }

  func didFocusStation(_ id: String) {
    renderer.endOverview()
    overviewDestination = nil
    setOverview(false)
    focusedStationId = id; needsCameraFit = false
    renderer.emphasis.select(id)
  }

  func selectStation(_ id: String) -> Bool {
    guard focusStation(id) else { return false }
    onStationSelect(["id": id])
    return true
  }

  @discardableResult
  func showAll() -> Bool {
    renderer.beginOverview()
    focusedStationId = nil
    renderer.emphasis.select(nil)
    let fitted = fitCamera(to: renderer.stations, animated: !UIAccessibility.isReduceMotionEnabled)
    if !fitted { needsCameraFit = true }
    refresh()
    return fitted
  }

  private func setOverview(_ value: Bool) {
    guard overview != value else { return }
    overview = value
    if probe == nil { onOverviewChange(["overview": value]) }
  }

  @discardableResult
  func fitCamera(to stations: [ClusterLabStation], animated: Bool = false) -> Bool {
    guard !isFittingCamera, let first = stations.first else { return false }
    let world = MKMapRect.world.width
    let location = framingLocation.map(MKMapPoint.init)
    let locationKey = location.map { CGPoint(x: $0.x, y: $0.y) }
    let xs = (stations.map { $0.mapPoint.x } + (location.map { [$0.x] } ?? [])).sorted()
    // Unwrap the shortest longitude interval, including searches at ±180°.
    let gapIndex = xs.indices.max { a, b in
      let gapA = (a + 1 < xs.count ? xs[a + 1] : xs[0] + world) - xs[a]
      let gapB = (b + 1 < xs.count ? xs[b + 1] : xs[0] + world) - xs[b]
      return gapA < gapB
    }!
    let start = xs[(gapIndex + 1) % xs.count]
    let points = stations.map { station -> LabProjectedStation in
      let p = station.mapPoint
      return LabProjectedStation(id: station.id, price: station.price,
        point: CGPoint(x: p.x < start ? p.x + world : p.x, y: p.y), isRecommended: station.isRecommended)
    }
    let projectedLocation = location.map { CGPoint(x: $0.x < start ? $0.x + world : $0.x, y: $0.y) }
    let maximumScale = bounds.width / (250 * MKMapPointsPerMeterAtLatitude(first.latitude))
    guard let fit = ClusterLabCameraFit.rect(for: points, viewport: bounds.size,
                                             usable: fitBounds, maximumScale: maximumScale,
                                             userLocation: projectedLocation) else { return false }
    // MapKit fits into its layout margins. Convert that inner viewport from the
    // solved full-screen projection, so native safe areas aren't counted twice.
    let nativeViewport = map.bounds.inset(by: map.layoutMargins)
    let unitsPerPoint = fit.width / bounds.width
    let rect = MKMapRect(x: fit.minX + nativeViewport.minX * unitsPerPoint,
                         y: fit.minY + nativeViewport.minY * unitsPerPoint,
                         width: nativeViewport.width * unitsPerPoint,
                         height: nativeViewport.height * unitsPerPoint)
    isFittingCamera = true
    defer { isFittingCamera = false }
    #if DEBUG
    launchProbe.fit(animated: animated, visible: hasPresentedStations, contentReady: contentReady, inset: overlayBottomInset)
    #endif
    if animated, let saved = fittedOverview, saved.stations == stations, saved.bounds == fitBounds, saved.location == locationKey,
       let camera = saved.camera.copy() as? MKMapCamera {
      overviewDestination = camera.copy() as? MKMapCamera
      setOverview(true)
      map.setCamera(camera, animated: true)
      fittedSize = bounds.size; fittedInsets = safeAreaInsets
      needsCameraFit = false; needsReconcile = true
      return true
    }
    if animated, let camera = map.camera.copy() as? MKMapCamera {
      // Measure MapKit's current scale, independent of heading. Solve the same
      // overview as initial layout, then let one native camera flight do the work.
      let center = map.convert(camera.centerCoordinate, toPointTo: map)
      let a = MKMapPoint(map.convert(center, toCoordinateFrom: map))
      let b = MKMapPoint(map.convert(CGPoint(x: center.x + 100, y: center.y), toCoordinateFrom: map))
      let dx = min(abs(b.x - a.x), world - abs(b.x - a.x))
      let currentUnitsPerPoint = hypot(dx, b.y - a.y) / 100
      guard currentUnitsPerPoint.isFinite, currentUnitsPerPoint > 0 else { return false }
      let target = MKMapPoint(x: fit.minX + center.x * unitsPerPoint,
                              y: fit.minY + center.y * unitsPerPoint).coordinate
      let latitudeScale = MKMetersPerMapPointAtLatitude(target.latitude) /
        MKMetersPerMapPointAtLatitude(camera.centerCoordinate.latitude)
      camera.centerCoordinateDistance *= unitsPerPoint / currentUnitsPerPoint * latitudeScale
      camera.centerCoordinate = target; camera.heading = 0; camera.pitch = 0
      overviewDestination = camera.copy() as? MKMapCamera
      fittedOverview = (stations, fitBounds, locationKey, camera.copy() as! MKMapCamera)
      setOverview(true)
      map.setCamera(camera, animated: true)
      fittedSize = bounds.size; fittedInsets = safeAreaInsets
      needsCameraFit = false; needsReconcile = true
      return true
    }
    // Finish any prior focus flight before applying this initial/layout fit.
    let camera = map.camera.copy() as! MKMapCamera
    camera.heading = 0; camera.pitch = 0
    map.setCamera(camera, animated: false)
    mapAnchor.prepareForCameraJump(to: MKMapPoint(x: rect.midX, y: rect.midY).coordinate)
    map.setVisibleMapRect(rect, animated: false)
    fittedOverview = (stations, fitBounds, locationKey, map.camera.copy() as! MKMapCamera)
    renderer.prepareForCameraFit()
    overviewDestination = nil
    setOverview(true)
    fittedSize = bounds.size; fittedInsets = safeAreaInsets
    needsCameraFit = false; needsReconcile = true; animationMoving = false
    return true
  }

  private func fitIfNeeded() {
    guard needsCameraFit, pendingProbe == nil else { return }
    guard probe != nil || contentReady else { return }
    // MapKit may expose the destination camera while its presentation is still
    // flying. Replacing that flight with another fit can jump to the destination.
    // Coalesce layout changes until the native flight ends, then animate any
    // remaining adjustment from the settled camera.
    if overviewDestination != nil { animateDeferredFit = true; return }
    let animateFit = (animateDeferredFit || (probe == nil && (hasPresentedStations || revealed))) &&
      !UIAccessibility.isReduceMotionEnabled
    animateDeferredFit = false
    if let probe {
      // Probe fixtures still receive real card/safe-area layout updates before
      // their camera sequence starts, just like the production station set.
      if probe.canRefitForLayoutChange { fitCamera(to: renderer.stations) }
      else if animateFit {
        fitCamera(to: renderer.stations, animated: true)
      }
    } else if let id = focusedStationId, latestStations.contains(where: { $0.id == id }) {
      focusStation(id)
    } else {
      fitCamera(to: latestStations, animated: animateFit)
    }
  }

  func refresh() {
    guard !isFittingCamera, active, window != nil, hasValidLayout, UIApplication.shared.applicationState != .background else { return }
    needsReconcile = true
    startFrames()
    // Older UIKit has no late-commit observer. Keep its immediate delegate
    // update as a fallback; modern iOS coalesces all updates into one frame.
    if frameClock?.synchronizesWithCommit == false {
      fitIfNeeded()
      mapAnchor.layout(map: map)
      renderer.reconcile(map: map)
      needsReconcile = false
      animationMoving = renderer.render(map: map, deltaTime: 0)
      updatePresentation()
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
    fitIfNeeded()
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
    updatePresentation()
    probe?.recordAnchor(mapAnchor.sample(map: map))
    let continuous = needsReconcile || cameraMoving || animationMoving || mapAnchor.needsPlacementUpdate || probe != nil
    frameClock?.requestContinuous(continuous)
    if !continuous { lastTimestamp = 0 }
  }

  private func updatePresentation() {
    // Once visible, keep chips attached throughout any deferred layout/refit.
    let ready = probe != nil || hasPresentedStations || (contentReady && !needsCameraFit && !cameraMoving)
    renderer.container.isHidden = !ready
    if ready && !latestStations.isEmpty { hasPresentedStations = true }
    reportReadyIfNeeded()
    #if DEBUG
    launchProbe.sample(map: map, visible: ready, ready: reportedMapReady, count: latestStations.count, inset: overlayBottomInset)
    #endif
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
