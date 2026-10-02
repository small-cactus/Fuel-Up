import SwiftUI
import MapKit

// Decorative sample map: no live position or fabricated price observations.
struct OnboardingLocationIllustration: View {
  var body: some View {
    GeometryReader { geometry in
      ZStack {
        LocationInvitationMap()
          .mask(LinearGradient(stops: [.init(color: .black, location: 0),
                                      .init(color: .black, location: 0.7),
                                      .init(color: .clear, location: 1)],
                               startPoint: .top, endPoint: .bottom))
        symbol("location.fill", color: .blue, prominent: true)
          .position(x: geometry.size.width * 0.5, y: geometry.size.height * 0.48)
        symbol("fuelpump.fill", color: .green)
          .position(x: geometry.size.width * 0.22, y: geometry.size.height * 0.30)
        symbol("dollarsign", color: .blue)
          .position(x: geometry.size.width * 0.79, y: geometry.size.height * 0.27)
        symbol("star.fill", color: .purple)
          .position(x: geometry.size.width * 0.76, y: geometry.size.height * 0.68)
      }
    }.accessibilityElement(children: .ignore)
      .accessibilityLabel("Illustration of nearby gas and savings on a map")
  }

  private func symbol(_ name: String, color: Color, prominent: Bool = false) -> some View {
    Image(systemName: name)
      .font(.system(size: prominent ? 36 : 24, weight: .semibold))
      .foregroundStyle(prominent ? .white : color)
      .frame(width: prominent ? 76 : 56, height: prominent ? 76 : 56)
      .modifier(InvitationSymbolSurface(prominent: prominent))
  }
}

private struct InvitationSymbolSurface: ViewModifier {
  let prominent: Bool
  func body(content: Content) -> some View {
    if prominent { content.background(.blue, in: Circle()) }
    else if #available(iOS 26.0, *) { content.glassEffect(.regular, in: .circle) }
    else { content.background(.regularMaterial, in: Circle()) }
  }
}

private struct LocationInvitationMap: UIViewRepresentable {
  func makeCoordinator() -> Coordinator { Coordinator() }
  func makeUIView(context: Context) -> MKMapView {
    let map = MKMapView()
    map.delegate = context.coordinator
    map.isScrollEnabled = false; map.isZoomEnabled = false
    map.isRotateEnabled = false; map.isPitchEnabled = false
    map.showsCompass = false
    map.pointOfInterestFilter = .excludingAll
    map.layoutMargins = UIEdgeInsets(top: 0, left: 12, bottom: 80, right: 12)
    let center = CLLocationCoordinate2D(latitude: 37.7749, longitude: -122.4194)
    map.setCamera(MKMapCamera(lookingAtCenter: center, fromDistance: 2200, pitch: 45, heading: 25), animated: false)
    map.addOverlay(MKCircle(center: center, radius: 330))
    return map
  }
  func updateUIView(_ view: MKMapView, context: Context) {}
  final class Coordinator: NSObject, MKMapViewDelegate {
    func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
      guard let circle = overlay as? MKCircle else { return MKOverlayRenderer(overlay: overlay) }
      let renderer = MKCircleRenderer(circle: circle)
      renderer.fillColor = UIColor.systemBlue.withAlphaComponent(0.16)
      return renderer
    }
  }
}
