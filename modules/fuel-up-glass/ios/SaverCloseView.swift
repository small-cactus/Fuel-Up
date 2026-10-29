import ExpoModulesCore
import UIKit

/// UIKit supplies the standard circular dismiss control and its interaction.
final class SaverCloseView: ExpoView {
  let onClose = EventDispatcher()
  var isDark = false { didSet { overrideUserInterfaceStyle = isDark ? .dark : .light } }
  private let button = UIButton(type: .close)
  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    button.accessibilityLabel = "Close preview"
    button.accessibilityIdentifier = "plus-preview-close"
    button.addTarget(self, action: #selector(close), for: .touchUpInside)
    addSubview(button)
  }
  override func layoutSubviews() { super.layoutSubviews(); button.frame = bounds }
  @objc private func close() { onClose() }
}
