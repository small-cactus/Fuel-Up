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

// Keep MapKit renderers alive independently of UIKit's adjacent-page cache.
// The pager supplies the actual page origins, including bounce/cancelled swipes.
// Apply transforms synchronously in UIKit so maps and content move in one frame.
final class OnboardingMapPresentation {
  var pageOffsets: [CGFloat?] = [0, nil, nil, nil] {
    didSet { applyOffsets?(pageOffsets) }
  }
  var applyOffsets: (([CGFloat?]) -> Void)?
}

@available(iOS 16.0, *)
struct OnboardingMapBackdrop: UIViewControllerRepresentable {
  let presentation: OnboardingMapPresentation
  let onMapReady: () -> Void

  func makeUIViewController(context: Context) -> OnboardingMapBackdropController {
    OnboardingMapBackdropController(presentation: presentation, onMapReady: onMapReady)
  }
  func updateUIViewController(_ controller: OnboardingMapBackdropController, context: Context) {}
}

@available(iOS 16.0, *)
final class OnboardingMapBackdropController: UIViewController {
  private let presentation: OnboardingMapPresentation
  private let maps: [UIHostingController<AnyView>]

  init(presentation: OnboardingMapPresentation, onMapReady: @escaping () -> Void) {
    self.presentation = presentation
    // One full-size, retained map per slide. All start loading with the flow;
    // entering or revisiting a slide never constructs another MKMapView.
    maps = (0..<4).map { index in
      let map = index == 0
        ? AnyView(OnboardingWelcomeMap(onMapReady: onMapReady).ignoresSafeArea())
        : AnyView(LocationInvitationMap().ignoresSafeArea())
      return UIHostingController(rootView: map)
    }
    super.init(nibName: nil, bundle: nil)
    presentation.applyOffsets = { [weak self] _ in self?.updateOffsets() }
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.isUserInteractionEnabled = false
    view.accessibilityElementsHidden = true
    view.clipsToBounds = true
    for host in maps {
      addChild(host)
      view.addSubview(host.view)
      host.view.backgroundColor = .clear
      host.didMove(toParent: self)
    }
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    updateOffsets()
  }

  private func updateOffsets() {
    guard isViewLoaded else { return }
    UIView.performWithoutAnimation {
      for (index, host) in maps.enumerated() {
        host.view.bounds = CGRect(origin: .zero, size: view.bounds.size)
        // Detached pages stay mounted just outside the viewport to preload.
        let offset = presentation.pageOffsets[index] ?? 2
        host.view.center = CGPoint(x: view.bounds.midX + offset * view.bounds.width,
                                   y: view.bounds.midY)
      }
    }
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
