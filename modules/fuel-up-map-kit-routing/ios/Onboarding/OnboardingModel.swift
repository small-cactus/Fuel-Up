import SwiftUI
import CoreLocation
import UserNotifications

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
  static let pageCount = 5
  @Published var requestingAlerts = false
  @Published var alertsDenied = false
  private var skipBrands = false
  private var priceAlertsEnabled = false
  let mapPresentation = OnboardingMapPresentation()
  @Published var step = 0 {
    didSet {
      guard tracksLocation, step != oldValue else { return }
      OnboardingTelemetry.emit("onboarding_step", ["step": step, "previousStep": oldValue])
    }
  }
  @Published var settledStep = 0
  @Published var searchFocused = false
  @Published var footerHeight: CGFloat = 134
  @Published var radius = 6.0
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
  @Published var saveError: String?
  @Published var completingWithoutPreferences = false
  var emit: (([String: Any]) -> Void)?
  private let location = CLLocationManager()
  private let tracksLocation: Bool
  private var initialized = false
  private var initialMemberships = Set<String>()
  private var initialFavorites = Set<String>()
  @Published var locationRequested = false
  @Published var showLocationSettingsAlert = false
  var locationReady: Bool { locationRequested && hasLocationAccess && coordinate != nil }

  init(tracksLocation: Bool = true) {
    self.tracksLocation = tracksLocation
    super.init()
    location.delegate = self
    location.desiredAccuracy = kCLLocationAccuracyHundredMeters
    location.distanceFilter = 250
  }
  deinit { location.stopUpdatingLocation() }

  func configure(_ value: [String: Any]) {
    guard !initialized else { return }
    initialized = true
    if tracksLocation { OnboardingTelemetry.emit("onboarding_step", ["step": step]) }
    priceAlertsEnabled = value["priceAlertsEnabled"] as? Bool ?? false
    radius = 6
    let grade = value["preferredOctane"] as? String ?? "regular"
    fuel = ["regular", "midgrade", "premium", "diesel", "e85"].contains(grade) ? grade : "regular"
    requiresE85 = value["requiresE85"] as? Bool ?? false
    memberships = Set(value["fuelMemberships"] as? [String] ?? [])
    favorites = Set(value["preferredBrands"] as? [String] ?? [])
    initialMemberships = memberships
    initialFavorites = favorites
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
  func changed() {
    OnboardingTelemetry.emit("preferences_changed", ["step": step, "fuelGrade": fuel, "requiresE85": requiresE85,
      "radiusMiles": radius.rounded(), "selectedBrandCount": favorites.count, "membershipCount": memberships.count])
    emit?(["type": "choices", "choices": choices])
  }
  func requestLocation() {
    OnboardingTelemetry.emit("permission_request", ["permission": "location_when_in_use", "step": step, "status": permission.rawValue])
    locationRequested = true
    locationError = nil
    if hasLocationAccess { location.startUpdatingLocation(); location.requestLocation() }
    else if locationBlocked {
      showLocationSettingsAlert = true
    } else { location.requestWhenInUseAuthorization() }
  }
  func selectStep(_ target: Int) {
    guard !completing else { return }
    if tracksLocation { OnboardingTelemetry.emit("onboarding_action", ["action":"select_step", "step":min(Self.pageCount - 1,max(0,target)), "previousStep":step]) }
    let bounded = min(Self.pageCount - 1, max(0, target))
    if bounded == 3 { skipBrands = false }
    step = locationReady ? bounded : min(bounded, 1)
  }
  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    let previous = permission
    permission = manager.authorizationStatus
    if tracksLocation { OnboardingTelemetry.emit("permission_snapshot", ["permission": "location", "status": permission.rawValue, "previousStatus": previous.rawValue, "precise": manager.accuracyAuthorization == .fullAccuracy, "step": step]) }
    guard tracksLocation else { return }
    if hasLocationAccess {
      location.startUpdatingLocation()
    } else {
      location.stopUpdatingLocation(); coordinate = nil
      if step > 1 { selectStep(1) }
      if locationRequested && locationBlocked && step == 1 { showLocationSettingsAlert = true }
    }
  }
  func openLocationSettings() {
    OnboardingTelemetry.emit("onboarding_action", ["action": "open_location_settings", "step": step])
    if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
  }
  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let fix = locations.last, fix.horizontalAccuracy >= 0,
          abs(fix.timestamp.timeIntervalSinceNow) < 300 else { return }
    coordinate = fix.coordinate; locationError = nil
    emit?(["type": "location", "latitude": fix.coordinate.latitude, "longitude": fix.coordinate.longitude])
  }
  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    guard locationRequested, !locationReady else { return }
    locationError = "Your location isn’t available yet. Tap Continue to try again."
  }
  func leaveBrands(skipping: Bool) {
    skipBrands = skipping
    selectStep(Self.pageCount - 1)
  }

  @MainActor func refreshAlertPermission() async {
    alertsDenied = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus == .denied
  }

  @MainActor func enablePriceAlerts() async {
    guard step == Self.pageCount - 1, !requestingAlerts, !completing else { return }
    requestingAlerts = true
    defer { requestingAlerts = false }
    let center = UNUserNotificationCenter.current()
    let status = await center.notificationSettings().authorizationStatus
    if status == .denied {
      if let url = URL(string: UIApplication.openNotificationSettingsURLString) { await UIApplication.shared.open(url) }
      return
    }
    if status != .authorized {
      OnboardingTelemetry.emit("permission_request", ["permission": "notifications", "step": step])
      do { _ = try await center.requestAuthorization(options: [.alert, .sound]) }
      catch { saveError = "Couldn’t request notifications. Try again or choose Not now."; return }
    }
    let result = await center.notificationSettings().authorizationStatus
    OnboardingTelemetry.emit("permission_snapshot", ["notifications": result.rawValue, "reason": "price_alerts_result", "step": step])
    priceAlertsEnabled = result == .authorized
    if priceAlertsEnabled { emit?(["type": "priceAlertsAuthorized"]) }
    finish(skippingPreferences: skipBrands)
  }

  func skipPriceAlerts() {
    OnboardingTelemetry.emit("onboarding_action", ["action": "skip_price_alerts", "step": step])
    finish(skippingPreferences: skipBrands)
  }

  func finish(skippingPreferences: Bool = false) {
    guard !completing, locationReady else { return }
    OnboardingTelemetry.emit("onboarding_action", ["action": "finish", "step": step, "skippedPreferences": skippingPreferences])
    completing = true
    completingWithoutPreferences = skippingPreferences
    saveError = nil
    var savedChoices = choices
    savedChoices["priceAlertsEnabled"] = priceAlertsEnabled
    if skippingPreferences {
      // Skip discards only this optional page's edits. Preserve any preferences
      // already saved before onboarding, plus the current fuel/location choices.
      savedChoices["fuelMemberships"] = initialMemberships.sorted()
      savedChoices["preferredBrands"] = initialFavorites.sorted()
    }
    emit?(["type": "complete", "choices": savedChoices])
  }
}
