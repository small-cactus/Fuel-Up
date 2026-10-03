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
      let clearMapEnd = min(geometry.size.height, heroHeight * 0.36)
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
          VStack(spacing: 0) {
            PureProgressiveBlur(direction: .top)
              .frame(height: clearMapEnd)
            // A long radius ramp carries the map continuously under the card.
            PureProgressiveBlur(direction: .bottom)
              .frame(height: max(0, geometry.size.height - clearMapEnd))
          }.allowsHitTesting(false)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Map illustration of Mission Creek in San Francisco with sample gas prices")
        .onChange(of: scheme) { _ in liveMapReady = false }
    }
  }
}

// Preserve the map's colors beneath the other setup pages.
@available(iOS 16.0, *)
struct OnboardingMapBackground: View {
  var body: some View {
    LocationInvitationMap()
      .overlay { PureProgressiveBlur(direction: .uniform) }
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
