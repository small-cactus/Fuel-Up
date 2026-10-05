import ExpoModulesCore
import SwiftUI

/// The white artwork clears ahead of a separately masked, live UIKit map blur.
final class NativeLaunchSplashView: ExpoView {
  let onArtworkReady = EventDispatcher()
  let onExitComplete = EventDispatcher()
  private let model = LaunchSplashModel()
  private let backdrop = UIVisualEffectView()
  private let blurMask = CAGradientLayer()
  private var host: UIHostingController<LaunchSplashArtwork>!
  private var reportedReady = false
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
    backdrop.layer.mask = blurMask
    addSubview(backdrop)
    host = UIHostingController(rootView: LaunchSplashArtwork(model: model))
    host.safeAreaRegions = []
    host.view.backgroundColor = .clear
    addSubview(host.view)
  }

  func setDark(_ dark: Bool) {
    model.dark = dark
    overrideUserInterfaceStyle = dark ? .dark : .light
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
    let duration = model.reduceMotion ? 0.18 : 0.90
    model.progress = min(1, (CACurrentMediaTime() - startedAt) / duration)
    updateBlurMask()
    if model.progress >= 1 {
      displayLink?.invalidate()
      displayLink = nil
      finished = true
      backdrop.effect = nil
      onExitComplete([:])
    }
  }

  private func updateBlurMask() {
    // The clear-map front follows the faster white-fade front in the shader.
    // A wide transparent-to-opaque ramp gradually removes the live native blur.
    let t = min(1, max(0, model.progress))
    let front = -0.24 + 1.52 * t * t * (3 - 2 * t)
    let inner = max(0, min(1, front - 0.22))
    let outer = max(inner, min(1, front + 0.10))
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    blurMask.locations = [NSNumber(value: inner), NSNumber(value: outer)]
    blurMask.opacity = front - 0.22 >= 1 ? 0 : 1
    CATransaction.commit()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    backdrop.frame = bounds
    host.view.frame = bounds
    let radius = hypot(bounds.width, bounds.height) / 2
    // A square radial mask keeps the wave circular on every screen aspect ratio.
    blurMask.frame = CGRect(x: bounds.midX - radius, y: bounds.midY - radius,
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
