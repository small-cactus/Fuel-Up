import SwiftUI
import MapKit

// Decorative sample map and illustrative prices, separate from live station data.
@available(iOS 16.0, *)
struct OnboardingLocationIllustration: View {
  let isActive: Bool
  let heroHeight: CGFloat

  var body: some View {
    GeometryReader { geometry in
      let heroFraction = min(1, heroHeight / max(1, geometry.size.height))
      LocationInvitationMap()
        .overlay(alignment: .top) {
          ZStack(alignment: .top) {
            OnboardingPricePills(isActive: isActive)
              .frame(height: heroHeight * 0.50)
              .clipped()
              .offset(y: heroHeight * 0.25)
            Text("Sample prices")
              .font(.caption2).foregroundStyle(.secondary)
              .position(x: geometry.size.width * 0.50, y: heroHeight * 0.70 - 8)
          }
          .frame(height: heroHeight)
        }
        .overlay {
          // Native backdrop blur is strongest at the edges, fading gently
          // into the sharp map rather than ending at a material boundary.
          Rectangle().fill(.ultraThinMaterial)
            .mask(LinearGradient(stops: [
              .init(color: .black, location: 0),
              .init(color: .black.opacity(0.55), location: 0.12 * heroFraction),
              .init(color: .clear, location: 0.34 * heroFraction),
              .init(color: .clear, location: 0.50 * heroFraction),
              .init(color: .black.opacity(0.35), location: 0.72 * heroFraction),
              .init(color: .black, location: heroFraction),
              .init(color: .black, location: 1)
            ], startPoint: .top, endPoint: .bottom))
            .allowsHitTesting(false)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Map illustration of Mission Creek in San Francisco with sample gas prices")
    }
  }
}

// Reuse the welcome page's native material for the other setup backgrounds.
@available(iOS 16.0, *)
struct OnboardingMapBackground: View {
  var body: some View {
    LocationInvitationMap()
      .overlay { Rectangle().fill(.ultraThinMaterial) }
      .ignoresSafeArea()
      .allowsHitTesting(false)
      .accessibilityHidden(true)
  }
}

@available(iOS 16.0, *)
private struct LocationInvitationMap: UIViewRepresentable {
  func makeUIView(context: Context) -> MKMapView {
    let map = MKMapView()
    map.isScrollEnabled = false; map.isZoomEnabled = false
    map.isRotateEnabled = false; map.isPitchEnabled = false
    map.showsCompass = false
    let configuration = MKStandardMapConfiguration(elevationStyle: .flat, emphasisStyle: .muted)
    configuration.pointOfInterestFilter = .excludingAll
    map.preferredConfiguration = configuration
    map.layoutMargins = UIEdgeInsets(top: 0, left: 12, bottom: 180, right: 12)
    // Frame the creek, its park edges, and neighboring blocks together.
    let center = CLLocationCoordinate2D(latitude: 37.7720, longitude: -122.3954)
    map.setCamera(MKMapCamera(lookingAtCenter: center, fromDistance: 1500, pitch: 0, heading: 0), animated: false)
    // Muted cartography and excluded points of interest keep the neighborhood graphic
    // quiet. MapKit retains its required attribution.
    return map
  }
  func updateUIView(_ view: MKMapView, context: Context) {}
}
