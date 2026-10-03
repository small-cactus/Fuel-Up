import SwiftUI
import MapKit

// Decorative sample map and illustrative prices, separate from live station data.
@available(iOS 16.0, *)
struct OnboardingLocationIllustration: View {
  let isActive: Bool
  let heroHeight: CGFloat
  @ObservedObject var preview: OnboardingMapPreview
  @Environment(\.colorScheme) private var scheme
  @State private var liveMapReady = false

  var body: some View {
    GeometryReader { geometry in
      let heroFraction = min(1, heroHeight / max(1, geometry.size.height))
      LocationInvitationMap { liveMapReady = true }
        .overlay {
          if !liveMapReady, let image = preview.image {
            Image(uiImage: image).resizable().scaledToFill()
              .frame(width: geometry.size.width, height: geometry.size.height).clipped()
              .allowsHitTesting(false).accessibilityHidden(true)
          }
        }
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
              .init(color: .black.opacity(0.72), location: 0.08 * heroFraction),
              .init(color: .black.opacity(0.35), location: 0.18 * heroFraction),
              .init(color: .black.opacity(0.08), location: 0.28 * heroFraction),
              .init(color: .clear, location: 0.36 * heroFraction),
              .init(color: .black.opacity(0.04), location: 0.46 * heroFraction),
              .init(color: .black.opacity(0.12), location: 0.58 * heroFraction),
              .init(color: .black.opacity(0.28), location: 0.72 * heroFraction),
              .init(color: .black.opacity(0.48), location: 0.88 * heroFraction),
              .init(color: .black.opacity(0.70), location: min(1, 1.06 * heroFraction)),
              .init(color: .black.opacity(0.88), location: min(1, 1.24 * heroFraction)),
              .init(color: .black, location: min(1, 1.42 * heroFraction)),
              .init(color: .black, location: 1)
            ], startPoint: .top, endPoint: .bottom))
            .allowsHitTesting(false)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Map illustration of Mission Creek in San Francisco with sample gas prices")
        .onChange(of: scheme) { _ in liveMapReady = false }
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
  var onRendered: (() -> Void)? = nil
  func makeCoordinator() -> Coordinator { Coordinator(onRendered: onRendered) }

  func makeUIView(context: Context) -> MKMapView {
    let map = MKMapView()
    map.delegate = context.coordinator
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
  func updateUIView(_ view: MKMapView, context: Context) {
    context.coordinator.onRendered = onRendered
  }

  final class Coordinator: NSObject, MKMapViewDelegate {
    var onRendered: (() -> Void)?
    init(onRendered: (() -> Void)?) { self.onRendered = onRendered }
    func mapViewDidFinishRenderingMap(_ mapView: MKMapView, fullyRendered: Bool) {
      guard fullyRendered else { return }
      DispatchQueue.main.async { [weak self] in self?.onRendered?() }
    }
  }
}
