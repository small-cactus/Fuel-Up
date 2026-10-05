import ExpoModulesCore
import SwiftUI
import ReactNativeBlur

/// Artwork clears ahead of a radial, progressively stronger live backdrop blur.
final class NativeLaunchSplashView: ExpoView {
  let onArtworkReady = EventDispatcher()
  let onExitComplete = EventDispatcher()
  var onFinished: (() -> Void)?
  private let model = LaunchSplashModel()
  private let backdrop = VariableBlurView(maxBlurRadius: 28, blurStyle: .regular)
  private var host: UIHostingController<LaunchSplashArtwork>!
  private var reportedReady = false
  private var capturedSystemAppearance = false
  private var displayLink: CADisplayLink?
  private var startedAt: CFTimeInterval?
  private var finished = false
  private var mapBubble: MapBubbleRevealView?
  private var warmupFrames = 2

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .clear
    backdrop.isUserInteractionEnabled = false
    backdrop.isHidden = true
    addSubview(backdrop)
    host = UIHostingController(rootView: LaunchSplashArtwork(model: model))
    host.safeAreaRegions = []
    host.view.backgroundColor = .clear
    addSubview(host.view)
  }

  // Onboarding supplies a native snapshot of its current screen; the same
  // Metal reveal and live backdrop then expose the already-rendered Home below.
  func setArtwork(_ image: UIImage, dark: Bool) {
    capturedSystemAppearance = true
    model.artwork = image
    model.dark = dark
    overrideUserInterfaceStyle = dark ? .dark : .light
    host.overrideUserInterfaceStyle = dark ? .dark : .light
  }

  private func captureSystemAppearance() {
    guard !capturedSystemAppearance, let scene = window?.windowScene else { return }
    // React Native overrides the window for the in-app theme. The scene still
    // carries the system appearance used by iOS's launch screen. Capture it once
    // so restoring a saved app theme cannot recolor the splash mid-transition.
    let dark = scene.traitCollection.userInterfaceStyle == .dark
    capturedSystemAppearance = true
    model.dark = dark
    overrideUserInterfaceStyle = dark ? .dark : .light
    host.overrideUserInterfaceStyle = dark ? .dark : .light
  }

  func setExiting(_ exiting: Bool) {
    guard exiting, displayLink == nil, startedAt == nil, !finished else { return }
    model.reduceMotion = UIAccessibility.isReduceMotionEnabled
    if !model.reduceMotion, let window,
       let map = MapBubbleRevealView.findHomeMap(in: window) {
      mapBubble = MapBubbleRevealView(map: map)
      mapBubble?.layoutIfNeeded()
    }
    backdrop.isHidden = model.reduceMotion
    let link = CADisplayLink(target: self, selector: #selector(tick))
    displayLink = link
    link.add(to: .main, forMode: .common)
  }

  @objc private func tick() {
    guard let startedAt else {
      // Render the new Metal surface under the opaque artwork before starting
      // the clock, so initial shader setup cannot skip the opening frames.
      warmupFrames -= 1
      if warmupFrames <= 0 { self.startedAt = CACurrentMediaTime() }
      return
    }
    // Give UIKit and SwiftUI a display interval to render the fully clear state
    // before React removes the native view. Completion must not reveal a new frame.
    if model.progress >= 1 {
      displayLink?.invalidate()
      displayLink = nil
      finished = true
      mapBubble?.removeFromSuperview()
      mapBubble = nil
      onFinished?()
      onExitComplete([:])
      return
    }
    let duration = model.reduceMotion ? 0.18 : 1.55
    model.progress = min(1, (CACurrentMediaTime() - startedAt) / duration)
    mapBubble?.update(progress: model.progress)
    updateBlurMask()
  }

  private func updateBlurMask() {
    guard !model.reduceMotion, bounds.width > 0, bounds.height > 0 else { return }
    let t = min(1, max(0, model.progress))
    // Scale the whole blur profile, not just its clear center. Its inner 54%
    // stays clear and its outer 46% ramps to full blur at every frame, so the
    // progressive band widens with the bubble instead of sliding as a fixed rim.
    // Ease the shared scale for a quick opening and a soft landing at the edges.
    let eased = 1 - pow(1 - t, 2.4)
    let cornerRadius = hypot(bounds.width, bounds.height) / 2
    let clearFraction = 0.54
    let bubbleRadius = (cornerRadius + 2) * eased / clearFraction
    // Preserve those boundaries while increasingly favoring low blur within
    // the band near the edges: alpha = distanceFraction ^ exponent.
    let edgeProgress = min(1, max(0, (eased - 0.35) / 0.65))
    let softening = edgeProgress * edgeProgress * (3 - 2 * edgeProgress)
    backdrop.updateBlur(
      maxBlurRadius: 28,
      direction: .blurredBottomClearTop,
      startOffset: 0,
      radial: true,
      radialCenterX: 0.5, radialCenterY: 0.5,
      radialClearRadius: bubbleRadius * clearFraction,
      radialFeather: bubbleRadius * (1 - clearFraction),
      blurStyle: .regular,
      radialGradientExponent: 1 + 1.2 * softening
    )
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    backdrop.frame = bounds
    host.view.frame = bounds
    updateBlurMask()
    guard window != nil, bounds.width > 0, bounds.height > 0, !reportedReady else { return }
    reportedReady = true
    DispatchQueue.main.async { [weak self] in
      self?.host.view.layoutIfNeeded()
      self?.onArtworkReady([:])
    }
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil {
      mapBubble?.removeFromSuperview()
      mapBubble = nil
      displayLink?.invalidate()
      displayLink = nil
      host.willMove(toParent: nil)
      host.removeFromParent()
      return
    }
    captureSystemAppearance()
    var responder: UIResponder? = self
    while let next = responder?.next {
      if let parent = next as? UIViewController {
        if host.parent == nil { parent.addChild(host); host.didMove(toParent: parent) }
        break
      }
      responder = next
    }
    setNeedsLayout()
  }
}

private final class LaunchSplashModel: ObservableObject {
  @Published var artwork: UIImage?
  @Published var dark = false
  @Published var progress = 0.0
  @Published var reduceMotion = false
}

private struct LaunchSplashArtwork: View {
  @ObservedObject var model: LaunchSplashModel

  private var artwork: Image {
    if let image = model.artwork { return Image(uiImage: image) }
    return Image("SplashScreenLegacy", bundle: .main)
  }

  var body: some View {
    GeometryReader { geometry in
      artwork
        .resizable()
        .scaledToFit()
        .frame(width: geometry.size.width, height: geometry.size.height)
        .background(model.dark ? Color.black : Color.white)
        .environment(\.colorScheme, model.dark ? .dark : .light)
        .layerEffect(
          ShaderLibrary.default.fuelUpLaunchBubble(.float2(geometry.size), .float(min(1, model.progress * (1.55 / 0.90)))),
          maxSampleOffset: CGSize(width: 44, height: 44),
          isEnabled: !model.reduceMotion
        )
        .opacity(model.reduceMotion ? 1 - model.progress : 1)
    }
    .ignoresSafeArea()
    .accessibilityHidden(true)
  }
}
