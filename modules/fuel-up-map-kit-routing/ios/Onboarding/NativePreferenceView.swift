import ExpoModulesCore
import SwiftUI

// Settings hosts the same selection pages, without constructing the onboarding
// pager, maps, or location-permission flow. The native stack supplies Back.
final class NativePreferenceView: ExpoView {
  let onAction = EventDispatcher()
  let model = OnboardingModel(tracksLocation: false)
  private var host: UIViewController?
  private var dark = false

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    model.emit = { [weak self] payload in self?.onAction(payload) }
  }

  func configure(page: String) {
    guard #available(iOS 16.0, *) else { return }
    if let host = host as? UIHostingController<PreferencePage> { host.rootView = PreferencePage(model: model, page: page) }
    else {
      let controller = UIHostingController(rootView: PreferencePage(model: model, page: page))
      // React Native already positions this host inside the screen's safe area.
      // UIKit updates the navigation-bar safe area after a push completes; letting
      // SwiftUI apply it again moves both pages down at the end of the animation.
      // Keep only keyboard avoidance so station search still scrolls above it.
      if #available(iOS 16.4, *) { controller.safeAreaRegions = .keyboard }
      controller.view.backgroundColor = .clear
      controller.overrideUserInterfaceStyle = dark ? .dark : .light
      host = controller
      addSubview(controller.view)
      attachHost()
    }
  }

  func setDark(_ dark: Bool) {
    self.dark = dark
    overrideUserInterfaceStyle = dark ? .dark : .light
    host?.overrideUserInterfaceStyle = dark ? .dark : .light
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
    } else { attachHost() }
  }

  private func attachHost() {
    guard window != nil, let host, host.parent == nil else { return }
    var responder: UIResponder? = self
    while let next = responder?.next {
      if let parent = next as? UIViewController {
        parent.addChild(host); addSubview(host.view); host.didMove(toParent: parent); break
      }
      responder = next
    }
  }
}

@available(iOS 16.0, *)
private struct PreferencePage: View {
  @ObservedObject var model: OnboardingModel
  let page: String
  @Environment(\.colorScheme) private var scheme

  var body: some View {
    Group {
      if page == "brands" { OnboardingBrandsPage(model: model, isSettings: true) }
      else { OnboardingFuelPage(model: model, isSettings: true) }
    }
    .padding(.top, 12)
    .background(background.ignoresSafeArea())
    .tint(.blue)
  }

  private var background: Color {
    scheme == .dark ? .black : Color(red: 242 / 255, green: 241 / 255, blue: 246 / 255)
  }
}
