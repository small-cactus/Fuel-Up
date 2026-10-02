import SwiftUI
import MapKit

// A native, noninteractive backdrop. Before permission, show national geography
// without pretending to know the user's position. Never fabricate station pins.
@available(iOS 16.0, *)
struct OnboardingLocationMap: UIViewRepresentable {
  let coordinate: CLLocationCoordinate2D?
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  func makeCoordinator() -> Coordinator { Coordinator() }

  func makeUIView(context: Context) -> MKMapView {
    let map = MKMapView()
    let configuration = MKStandardMapConfiguration(elevationStyle: .flat, emphasisStyle: .muted)
    configuration.pointOfInterestFilter = .excludingAll
    map.preferredConfiguration = configuration
    map.isScrollEnabled = false
    map.isZoomEnabled = false
    map.isRotateEnabled = false
    map.isPitchEnabled = false
    map.showsCompass = false
    map.showsScale = false
    map.isAccessibilityElement = false
    map.accessibilityElementsHidden = true
    return map
  }

  func updateUIView(_ map: MKMapView, context: Context) {
    map.showsUserLocation = coordinate != nil
    let previous = context.coordinator.coordinate
    let changed = previous?.latitude != coordinate?.latitude || previous?.longitude != coordinate?.longitude
    guard !context.coordinator.initialized || changed else { return }
    let region: MKCoordinateRegion
    if let coordinate {
      region = MKCoordinateRegion(center: coordinate, latitudinalMeters: 12_000, longitudinalMeters: 12_000)
    } else {
      region = MKCoordinateRegion(center: .init(latitude: 38.5, longitude: -98),
                                  span: .init(latitudeDelta: 48, longitudeDelta: 64))
    }
    map.setRegion(region, animated: context.coordinator.initialized && !reduceMotion)
    context.coordinator.coordinate = coordinate
    context.coordinator.initialized = true
  }

  final class Coordinator {
    var coordinate: CLLocationCoordinate2D?
    var initialized = false
  }
}
