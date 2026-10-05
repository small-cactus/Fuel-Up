import ExpoModulesCore
import SwiftUI

final class NativeOnboardingView: ExpoView {
  let onAction = EventDispatcher()
  let model = OnboardingModel()
  private var host: UIViewController?
  private var reveal: NativeLaunchSplashView?
  private var dark = false
  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    model.emit = { [weak self] payload in
      guard let self else { return }
      self.onAction(payload)
    }
    if #available(iOS 16.0, *) {
      let controller = UIHostingController(rootView: OnboardingFlow(model: model))
      controller.view.backgroundColor = .clear
      host = controller
      addSubview(controller.view)
    }
  }
  override func layoutSubviews() {
    super.layoutSubviews()
    host?.view.frame = bounds
    reveal?.frame = bounds
  }
  override func didMoveToWindow() {
    super.didMoveToWindow()
    guard let host else { return }
    if window == nil {
      host.willMove(toParent: nil); host.view.removeFromSuperview(); host.removeFromParent()
    } else if host.parent == nil {
      var responder: UIResponder? = self
      while let next = responder?.next {
        if let parent = next as? UIViewController {
          parent.addChild(host); addSubview(host.view); host.didMove(toParent: parent); break
        }
        responder = next
      }
    }
  }
  func setSaveError(_ message: String?) {
    model.saveError = message
    if message != nil { model.completing = false }
  }

  func setRevealing(_ ready: Bool) {
    guard ready, reveal == nil, let source = host?.view, bounds.width > 0, bounds.height > 0 else { return }
    let format = UIGraphicsImageRendererFormat()
    format.opaque = true
    let image = UIGraphicsImageRenderer(bounds: bounds, format: format).image { _ in
      source.drawHierarchy(in: bounds, afterScreenUpdates: false)
    }
    let effect = NativeLaunchSplashView()
    effect.setArtwork(image, dark: dark)
    effect.frame = bounds
    effect.onFinished = { [weak self] in self?.onAction(["type": "exitComplete"]) }
    reveal = effect
    addSubview(effect)
    source.isHidden = true
    effect.layoutIfNeeded()
    effect.setExiting(true)
  }

  func setDark(_ value: Bool) {
    dark = value
    host?.overrideUserInterfaceStyle = value ? .dark : .light
  }
}
