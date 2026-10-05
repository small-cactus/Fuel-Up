import ExpoModulesCore
import SwiftUI

/// The white artwork clears ahead of a separately masked, live UIKit map blur.
final class NativeLaunchSplashView: ExpoView {
  let onArtworkReady = EventDispatcher()
  let onExitComplete = EventDispatcher()
  private let model = LaunchSplashModel()
  private let backdrop = UIVisualEffectView()
  private let blurMaskView = LaunchBlurMaskView()
  private var blurMask: CAGradientLayer { blurMaskView.gradient }
  private var host: UIHostingController<LaunchSplashArtwork>!
  private var reportedReady = false
  private var capturedSystemAppearance = false
  private var displayLink: CADisplayLink?
  private var startedAt: CFTimeInterval?
  private var finished = false

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .clear
    backdrop.isUserInteractionEnabled = false
    blurMask.type = .radial
    blurMask.colors = [UIColor.clear.cgColor, UIColor.black.cgColor]
    blurMask.startPoint = CGPoint(x: 0.5, y: 0.5)
    blurMask.endPoint = CGPoint(x: 1, y: 1)
    backdrop.mask = blurMaskView
    addSubview(backdrop)
    host = UIHostingController(rootView: LaunchSplashArtwork(model: model))
    host.safeAreaRegions = []
    host.view.backgroundColor = .clear
    addSubview(host.view)
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
    guard exiting, startedAt == nil, !finished else { return }
    model.reduceMotion = UIAccessibility.isReduceMotionEnabled
    if !model.reduceMotion { backdrop.effect = UIBlurEffect(style: .regular) }
    startedAt = CACurrentMediaTime()
    let link = CADisplayLink(target: self, selector: #selector(tick))
    displayLink = link
    link.add(to: .main, forMode: .common)
  }

  @objc private func tick() {
    guard let startedAt else { return }
    // Give UIKit and SwiftUI a display interval to render the fully clear state
    // before React removes the native view. Completion must not reveal a new frame.
    if model.progress >= 1 {
      displayLink?.invalidate()
      displayLink = nil
      finished = true
      onExitComplete([:])
      return
    }
    let duration = model.reduceMotion ? 0.18 : 0.90
    model.progress = min(1, (CACurrentMediaTime() - startedAt) / duration)
    updateBlurMask()
  }

  private func updateBlurMask() {
    // The clear-map front follows the faster white-fade front in the shader.
    // A wide transparent-to-opaque ramp gradually removes the live native blur.
    let t = min(1, max(0, model.progress))
    let front = -0.24 + 1.52 * t * t * (3 - 2 * t)
    // The mask extends to 1.5 screen radii, so the entire fade ramp can travel
    // beyond the corners. Clamping it at the screen radius pinned opaque blur
    // to the edge and required a visible, binary cutoff at the end.
    let inner = max(0, (front - 0.22) / 1.5)
    let outer = max(inner, (front + 0.10) / 1.5)
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    blurMask.locations = [NSNumber(value: inner), NSNumber(value: outer)]
    // UIKit copies masks onto its effect subviews. Reassign the public mask
    // after changing it so the live backdrop receives the current ramp too.
    backdrop.mask = blurMaskView
    CATransaction.commit()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    backdrop.frame = bounds
    host.view.frame = bounds
    let radius = hypot(bounds.width, bounds.height) / 2 * 1.5
    // A square radial mask keeps the wave circular on every screen aspect ratio.
    blurMaskView.frame = CGRect(x: bounds.midX - radius, y: bounds.midY - radius,
                            width: radius * 2, height: radius * 2)
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
  @Published var dark = false
  @Published var progress = 0.0
  @Published var reduceMotion = false
}

private struct LaunchSplashArtwork: View {
  @ObservedObject var model: LaunchSplashModel

  var body: some View {
    GeometryReader { geometry in
      Image("SplashScreenLegacy", bundle: .main)
        .resizable()
        .scaledToFit()
        .frame(width: geometry.size.width, height: geometry.size.height)
        .background(model.dark ? Color.black : Color.white)
        .environment(\.colorScheme, model.dark ? .dark : .light)
        .layerEffect(
          ShaderLibrary.default.fuelUpLaunchBubble(.float2(geometry.size), .float(model.progress)),
          maxSampleOffset: CGSize(width: 44, height: 44),
          isEnabled: !model.reduceMotion
        )
        .opacity(model.reduceMotion ? 1 - model.progress : 1)
    }
    .ignoresSafeArea()
    .accessibilityHidden(true)
  }
}

/// A view mask lets UIVisualEffectView propagate the mask to its effect layers.
private final class LaunchBlurMaskView: UIView {
  override class var layerClass: AnyClass { CAGradientLayer.self }
  var gradient: CAGradientLayer { layer as! CAGradientLayer }
}
