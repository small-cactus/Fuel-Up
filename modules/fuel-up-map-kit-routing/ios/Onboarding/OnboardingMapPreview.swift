import MapKit
import SwiftUI

// Shared camera/configuration keeps the preloaded image aligned with the live map.
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

// One cancellable, in-memory preview per onboarding flow. This fetches only the
// decorative Mission Creek map; it never requests the user's location or prices.
final class OnboardingMapPreview: ObservableObject {
  @Published private(set) var image: UIImage?
  private var snapshotter: MKMapSnapshotter?
  private var requestedSize = CGSize.zero
  private var requestedStyle: UIUserInterfaceStyle = .unspecified
  private var requestID = UUID()

  func prepare(size: CGSize, style: UIUserInterfaceStyle) {
    guard size.width > 0, size.height > 0,
          size != requestedSize || style != requestedStyle else { return }
    requestedSize = size
    requestedStyle = style
    snapshotter?.cancel()
    image = nil
    let id = UUID()
    requestID = id
    let options = MKMapSnapshotter.Options()
    options.size = size
    options.camera = OnboardingMapScene.camera
    options.preferredConfiguration = OnboardingMapScene.configuration
    options.traitCollection = UITraitCollection(userInterfaceStyle: style)
    let loader = MKMapSnapshotter(options: options)
    snapshotter = loader
    #if DEBUG
    NSLog("[OnboardingMapPreview] started %.0fx%.0f", size.width, size.height)
    #endif
    loader.start(with: .main) { [weak self] snapshot, _ in
      guard let self, self.requestID == id else { return }
      self.image = snapshot?.image
      self.snapshotter = nil
      #if DEBUG
      NSLog("[OnboardingMapPreview] finished ready=%@", snapshot == nil ? "false" : "true")
      #endif
    }
  }

  deinit { snapshotter?.cancel() }
}
