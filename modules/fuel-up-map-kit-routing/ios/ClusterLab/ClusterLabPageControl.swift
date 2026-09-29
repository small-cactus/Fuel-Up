import ExpoModulesCore
import UIKit

// UIKit owns pagination layout, large page counts, scrubbing and VoiceOver.
final class ClusterLabPageControl: ExpoView {
  let control = UIPageControl()
  private let glass = ClusterLabGlass.pill()
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
    let width = min(bounds.width, control.size(forNumberOfPages: min(control.numberOfPages, 7)).width)
    let height = min(bounds.height, 28)
    glass.frame = CGRect(x: (bounds.width - width) / 2, y: (bounds.height - height) / 2,
                         width: width, height: height)
    control.frame = CGRect(x: glass.frame.minX, y: 0, width: width, height: bounds.height)
  }

  func setDark(_ dark: Bool) {
    overrideUserInterfaceStyle = dark ? .dark : .light
  }

  func applyPages() {
    control.numberOfPages = max(0, pageCount)
    control.currentPage = min(max(0, currentPage), max(0, pageCount - 1))
    glass.isHidden = pageCount <= 1
    setNeedsLayout()
  }

  @objc private func changed() { onPageChange(["page": control.currentPage]) }
}
