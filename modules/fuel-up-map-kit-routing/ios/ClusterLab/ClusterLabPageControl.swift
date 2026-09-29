import ExpoModulesCore
import UIKit

// UIKit owns pagination layout, large page counts, scrubbing and VoiceOver.
final class ClusterLabPageControl: ExpoView {
  let control = UIPageControl()
  private let glass = ClusterLabGlass.pill()
  private var needsMaterialRefresh = true
  let onPageChange = EventDispatcher()
  var pageCount = 0
  var currentPage = 0

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    control.hidesForSinglePage = true
    control.backgroundStyle = .minimal
    control.currentPageIndicatorTintColor = .label
    control.pageIndicatorTintColor = UIColor.label.withAlphaComponent(0.45)
    control.addTarget(self, action: #selector(changed), for: .valueChanged)
    glass.isUserInteractionEnabled = false
    addSubview(glass)
    addSubview(control)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    // UIKit condenses long page lists itself. Size for the visible row rather
    // than reserving a dot for every station, and keep its full touch height.
    let controlWidth = max(0, min(bounds.width - 16,
      control.size(forNumberOfPages: min(control.numberOfPages, 7)).width))
    let width = min(bounds.width, controlWidth + 16)
    let height = min(bounds.height, 28)
    glass.frame = CGRect(x: (bounds.width - width) / 2, y: (bounds.height - height) / 2,
                         width: width, height: height)
    control.frame = CGRect(x: (bounds.width - controlWidth) / 2, y: 0,
                           width: controlWidth, height: bounds.height)
    if needsMaterialRefresh, window != nil, width > 0, height > 0,
       #available(iOS 26.0, *), let material = glass as? UIVisualEffectView {
      // Match expo-glass-effect's mount lifecycle: tear down the stale effect
      // during layout before rebuilding regular glass on the attached view.
      UIView.performWithoutAnimation {
        material.effect = UIVisualEffect()
        material.effect = UIGlassEffect(style: .regular)
      }
      needsMaterialRefresh = false
    }
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    needsMaterialRefresh = true
    if window != nil { setNeedsLayout() }
  }

  func setDark(_ dark: Bool) {
    let style: UIUserInterfaceStyle = dark ? .dark : .light
    guard overrideUserInterfaceStyle != style else { return }
    overrideUserInterfaceStyle = style
    needsMaterialRefresh = true
    setNeedsLayout()
  }

  func applyPages() {
    control.numberOfPages = max(0, pageCount)
    control.currentPage = min(max(0, currentPage), max(0, pageCount - 1))
    glass.isHidden = pageCount <= 1
    setNeedsLayout()
  }

  @objc private func changed() { onPageChange(["page": control.currentPage]) }
}
