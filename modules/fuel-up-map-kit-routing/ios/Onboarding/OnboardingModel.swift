import SwiftUI
import CoreLocation

struct OnboardingBrand: Identifiable {
  let id: String
  let label: String
  let count: Int
  init?(_ value: [String: Any]) {
    guard let id = value["id"] as? String, let label = value["label"] as? String else { return nil }
    self.id = id; self.label = label; count = value["count"] as? Int ?? 0
  }
}

// Draft choices live in Swift throughout navigation. Only completion persists them.
final class OnboardingModel: NSObject, ObservableObject, CLLocationManagerDelegate {
  @Published var step = 0
  @Published var searchFocused = false
  @Published var radius = 5.0
  @Published var adjustingRadius = false
  @Published var fuel = "regular"
  @Published var requiresE85 = false
  @Published var memberships = Set<String>()
  @Published var favorites = Set<String>()
  @Published var coordinate: CLLocationCoordinate2D?
  @Published var permission: CLAuthorizationStatus = .notDetermined
  @Published var stations: [OnboardingStation] = []
  @Published var brands: [OnboardingBrand] = []
  @Published var membershipOptions: [OnboardingBrand] = []
  @Published var loading = false
  @Published var membershipLoading = false
  @Published var error: String?
  @Published var membershipError: String?
  @Published var locationError: String?
  @Published var completing = false
  var emit: (([String: Any]) -> Void)?
  private let location = CLLocationManager()
  private var initialized = false
  private var wantsAdvance = false

  override init() {
    super.init()
    location.delegate = self
    location.desiredAccuracy = kCLLocationAccuracyHundredMeters
    location.distanceFilter = 250
  }
  deinit { location.stopUpdatingLocation() }

  func configure(_ value: [String: Any]) {
    guard !initialized else { return }
    initialized = true
    radius = min(15, max(2, value["searchRadiusMiles"] as? Double ?? 5))
    let grade = value["preferredOctane"] as? String ?? "regular"
    fuel = ["regular", "midgrade", "premium", "diesel", "e85"].contains(grade) ? grade : "regular"
    requiresE85 = value["requiresE85"] as? Bool ?? false
    memberships = Set(value["fuelMemberships"] as? [String] ?? [])
    favorites = Set(value["preferredBrands"] as? [String] ?? [])
  }
  func applyData(_ value: [String: Any]) {
    stations = (value["stations"] as? [[String: Any]] ?? []).compactMap(OnboardingStation.init)
    brands = (value["brands"] as? [[String: Any]] ?? []).compactMap(OnboardingBrand.init)
    membershipOptions = (value["memberships"] as? [[String: Any]] ?? []).compactMap(OnboardingBrand.init)
    loading = value["loading"] as? Bool ?? false
    membershipLoading = value["membershipLoading"] as? Bool ?? false
    error = value["error"] as? String
    membershipError = value["membershipError"] as? String
  }
  var hasLocationAccess: Bool { permission == .authorizedAlways || permission == .authorizedWhenInUse }
  var locationBlocked: Bool { permission == .denied || permission == .restricted }
  var choices: [String: Any] {
    ["searchRadiusMiles": radius.rounded(), "preferredOctane": fuel, "requiresE85": requiresE85,
     "preferredBrands": favorites.sorted(), "fuelMemberships": memberships.sorted()]
  }
  func changed() { emit?(["type": "choices", "choices": choices]) }
  func advanceLocation() {
    if hasLocationAccess { location.startUpdatingLocation(); goToRadius() }
    else if locationBlocked {
      if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
    } else { wantsAdvance = true; location.requestWhenInUseAuthorization() }
  }
  func skipLocation() { wantsAdvance = false; goToRadius() }
  private func goToRadius() {
    withAnimation(UIAccessibility.isReduceMotionEnabled ? nil : .easeInOut(duration: 0.3)) { step = 2 }
  }
  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    permission = manager.authorizationStatus
    if hasLocationAccess {
      location.startUpdatingLocation()
      if wantsAdvance && step == 1 { goToRadius() }
    } else { location.stopUpdatingLocation() }
    wantsAdvance = false
  }
  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let fix = locations.last, fix.horizontalAccuracy >= 0,
          abs(fix.timestamp.timeIntervalSinceNow) < 300 else { return }
    coordinate = fix.coordinate; locationError = nil
    emit?(["type": "location", "latitude": fix.coordinate.latitude, "longitude": fix.coordinate.longitude])
  }
  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    locationError = "Your location isn’t available yet. You can keep going."
  }
  func finish() {
    guard !completing else { return }
    completing = true
    emit?(["type": "complete", "choices": choices])
  }
}
