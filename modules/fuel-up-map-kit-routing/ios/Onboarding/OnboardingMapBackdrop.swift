import MapKit
import SwiftUI

// One native scene for the location, fuel and station-preference backgrounds.
enum OnboardingMapScene {
  static var camera: MKMapCamera {
    MKMapCamera(lookingAtCenter: .init(latitude: 37.7720, longitude: -122.3954),
                fromDistance: 1800, pitch: 0, heading: 0)
  }

  static var configuration: MKStandardMapConfiguration {
    let configuration = MKStandardMapConfiguration(elevationStyle: .flat, emphasisStyle: .muted)
    configuration.pointOfInterestFilter = .excludingAll
    return configuration
  }
}

// Separate from the draft model: interactive paging only updates the backdrop,
// not every form and list. Both MapKit views live for the entire flow.
final class OnboardingMapPresentation: ObservableObject {
  @Published var position: CGFloat = 0
}

@available(iOS 16.0, *)
struct OnboardingMapBackdrop: View {
  @ObservedObject var presentation: OnboardingMapPresentation
  let onMapReady: () -> Void

  var body: some View {
    GeometryReader { geometry in
      ZStack {
        // Mounted at full size from the welcome screen, so later slides reuse
        // the already rendered map without snapshots or per-page map loading.
        LocationInvitationMap()
        OnboardingWelcomeMap(onMapReady: onMapReady)
          .offset(x: -min(1, max(0, presentation.position)) * geometry.size.width)
      }
      .clipped()
    }
    .allowsHitTesting(false)
    .accessibilityHidden(true)
  }
}

@available(iOS 16.0, *)
struct LocationInvitationMap: UIViewRepresentable {
  func makeUIView(context: Context) -> MKMapView {
    let map = MKMapView()
    map.isScrollEnabled = false; map.isZoomEnabled = false
    map.isRotateEnabled = false; map.isPitchEnabled = false
    map.showsCompass = false
    map.preferredConfiguration = OnboardingMapScene.configuration
    map.layoutMargins = UIEdgeInsets(top: 0, left: 12, bottom: 180, right: 12)
    // Frame the creek, its park edges, and neighboring blocks together.
    map.setCamera(OnboardingMapScene.camera, animated: false)
    // Muted cartography and excluded points of interest keep the neighborhood graphic
    // quiet. MapKit retains its required attribution.
    return map
  }
  func updateUIView(_ view: MKMapView, context: Context) {}
}
