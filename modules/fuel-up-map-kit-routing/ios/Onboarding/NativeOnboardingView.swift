import ExpoModulesCore
import SwiftUI

final class NativeOnboardingView: ExpoView {
  let onAction = EventDispatcher()
  let model = OnboardingModel()
  private var host: UIViewController?
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
  func setDark(_ value: Bool) {
    host?.overrideUserInterfaceStyle = value ? .dark : .light
  }
}
