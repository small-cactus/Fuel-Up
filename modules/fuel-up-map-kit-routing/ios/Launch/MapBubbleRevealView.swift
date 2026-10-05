import SwiftUI

/// A short-lived Metal surface over the rendered Home or Welcome map.
/// The map camera and cluster geometry stay in place throughout the reveal.
final class MapBubbleRevealView: UIView {
  private let model: MapBubbleRevealModel
  private let host: UIHostingController<MapBubbleArtwork>

  init?(map: UIView) {
    guard map.bounds.width > 0, map.bounds.height > 0 else { return nil }
    let format = UIGraphicsImageRendererFormat()
    format.opaque = true
    let image = UIGraphicsImageRenderer(bounds: map.bounds, format: format).image { _ in
      map.drawHierarchy(in: map.bounds, afterScreenUpdates: false)
    }
    let state = MapBubbleRevealModel()
    model = state
    host = UIHostingController(rootView: MapBubbleArtwork(image: image, model: state))
    super.init(frame: map.bounds)
    isUserInteractionEnabled = false
    accessibilityElementsHidden = true
    clipsToBounds = true
    autoresizingMask = [.flexibleWidth, .flexibleHeight]
    host.safeAreaRegions = []
    host.view.backgroundColor = .clear
    addSubview(host.view)
    map.addSubview(self)
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  func update(progress: Double) { model.progress = progress }

  override func layoutSubviews() {
    super.layoutSubviews()
    host.view.frame = bounds
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil {
      host.willMove(toParent: nil)
      host.removeFromParent()
      return
    }
    var responder: UIResponder? = self
    while let next = responder?.next {
      if let parent = next as? UIViewController {
        if host.parent == nil { parent.addChild(host); host.didMove(toParent: parent) }
        break
      }
      responder = next
    }
  }

  static func findRevealMap(in view: UIView) -> UIView? {
    guard !view.isHidden, view.alpha > 0 else { return nil }
    if view is ClusterLabMapView || view is OnboardingWelcomeMapView { return view }
    for child in view.subviews {
      if let map = findRevealMap(in: child) { return map }
    }
    return nil
  }
}

private final class MapBubbleRevealModel: ObservableObject {
  @Published var progress = 0.0
}

private struct MapBubbleArtwork: View {
  let image: UIImage
  @ObservedObject var model: MapBubbleRevealModel

  var body: some View {
    GeometryReader { geometry in
      Image(uiImage: image).resizable()
        .frame(width: geometry.size.width, height: geometry.size.height)
        .layerEffect(
          ShaderLibrary.default.fuelUpMapBubble(.float2(geometry.size), .float(model.progress)),
          maxSampleOffset: CGSize(width: 26, height: 26)
        )
        // Blend back to the live map after the wave settles, before removal.
        .opacity(1 - smoothFinish)
    }.ignoresSafeArea().accessibilityHidden(true)
  }

  private var smoothFinish: Double {
    let t = min(1, max(0, (model.progress - 0.82) / 0.18))
    return t * t * (3 - 2 * t)
  }
}
