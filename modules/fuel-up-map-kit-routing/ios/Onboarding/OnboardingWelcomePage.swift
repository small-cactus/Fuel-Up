import SwiftUI
import MapKit

// Native port of the existing welcome artwork, in the same pager as setup.
// The map creates its annotations with the view, not a one-shot loading event.
struct OnboardingWelcomePage: View {
  @Environment(\.colorScheme) private var scheme
  var body: some View {
    GeometryReader { geometry in
      ZStack(alignment: .top) {
        OnboardingWelcomeMap().ignoresSafeArea()
        VStack {
          Rectangle().fill(.ultraThinMaterial).frame(height: geometry.safeAreaInsets.top + 300)
            .mask(LinearGradient(colors: [.black, .black, .clear], startPoint: .top, endPoint: .bottom))
          Spacer()
          Rectangle().fill(.ultraThinMaterial).frame(height: 270)
            .mask(LinearGradient(colors: [.clear, .black], startPoint: .top, endPoint: .bottom))
        }.ignoresSafeArea().allowsHitTesting(false)
        VStack {
          LinearGradient(stops: [.init(color: background, location: 0), .init(color: background.opacity(0.96), location: 0.65), .init(color: .clear, location: 1)], startPoint: .top, endPoint: .bottom).frame(height: 330)
          Spacer()
          LinearGradient(colors: [.clear, background.opacity(0.85), background], startPoint: .top, endPoint: .bottom).frame(height: 220)
        }.ignoresSafeArea().allowsHitTesting(false)
        VStack(spacing: 12) {
          if let icon = OnboardingAssets.image("fuelup-icon.png") {
            Image(uiImage: icon).resizable().frame(width: 64, height: 64).clipShape(RoundedRectangle(cornerRadius: 14))
          }
          if let logo = OnboardingAssets.image(scheme == .dark ? "FuelUp-text-logo-dark.png" : "FuelUp-text-logo-light.png") {
            Image(uiImage: logo).resizable().scaledToFit().frame(width: 132, height: 38).accessibilityLabel("Fuel Up")
          }
          Text("Find the cheapest gas near you, instantly.")
            .font(.body).foregroundStyle(.primary).multilineTextAlignment(.center).frame(maxWidth: 280)
        }.padding(.top, 40).padding(.horizontal, 24)
      }
    }
  }
  private var background: Color { scheme == .dark ? .black : Color(red: 242/255, green: 241/255, blue: 246/255) }
}

struct OnboardingWelcomeMap: UIViewRepresentable {
  func makeCoordinator() -> Coordinator { Coordinator() }
  func makeUIView(context: Context) -> MKMapView {
    let map = MKMapView()
    map.delegate = context.coordinator
    map.isScrollEnabled = false; map.isZoomEnabled = false; map.isRotateEnabled = false; map.isPitchEnabled = false
    map.showsCompass = false
    let region = MKCoordinateRegion(center: .init(latitude: 37.7749, longitude: -122.4194), span: .init(latitudeDelta: 0.06, longitudeDelta: 0.06))
    map.setRegion(region, animated: false)
    let points: [(Double, Double, Double)] = [(37.776,-122.430,3.89),(37.783,-122.412,4.59),(37.768,-122.425,4.79),(37.780,-122.405,4.65),(37.771,-122.438,4.49),(37.760,-122.418,4.72)]
    map.addAnnotations(points.enumerated().map { index, point in
      let item = MKPointAnnotation(); item.coordinate = .init(latitude: point.0, longitude: point.1)
      item.title = String(format: "$%.2f", point.2); item.subtitle = index == 0 ? "best" : "standard"; return item
    })
    return map
  }
  func updateUIView(_ view: MKMapView, context: Context) {}
  final class Coordinator: NSObject, MKMapViewDelegate {
    func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
      guard annotation is MKPointAnnotation else { return nil }
      let view = mapView.dequeueReusableAnnotationView(withIdentifier: "welcome") as? WelcomePillView
        ?? WelcomePillView(annotation: annotation, reuseIdentifier: "welcome")
      view.annotation = annotation; view.configure(); return view
    }
  }
}

private final class WelcomePillView: MKAnnotationView {
  private let glass = ClusterLabGlass.pill()
  private let label = UILabel()
  private let icon = UIImageView(image: UIImage(systemName: "fuelpump.fill"))
  override init(annotation: MKAnnotation?, reuseIdentifier: String?) {
    super.init(annotation: annotation, reuseIdentifier: reuseIdentifier)
    bounds = CGRect(x: 0, y: 0, width: 96, height: 36)
    displayPriority = .required
    addSubview(glass); glass.frame = bounds
    let content = ClusterLabGlass.content(of: glass)
    content.addSubview(label); content.addSubview(icon)
    icon.tintColor = .label; icon.contentMode = .scaleAspectFit; icon.frame = .init(x: 10, y: 10, width: 14, height: 16)
    label.font = .systemFont(ofSize: 16, weight: .bold); label.textColor = .label
    label.frame = .init(x: 29, y: 0, width: 63, height: 36)
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  func configure() {
    label.text = annotation?.title ?? ""
    if #available(iOS 26.0, *), let glass = glass as? UIVisualEffectView {
      let effect = UIGlassEffect(style: .regular)
      effect.tintColor = (annotation?.subtitle == "best" ? UIColor.systemGreen : UIColor.systemRed).withAlphaComponent(0.3)
      glass.effect = effect
    }
    isAccessibilityElement = true; accessibilityLabel = annotation?.title ?? "Gas price"
  }
}
