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
    control.addTarget(self, action: #selector(changed), for: .valueChanged)
    addSubview(glass)
    ClusterLabGlass.content(of: glass).addSubview(control)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    let width = min(bounds.width, control.size(forNumberOfPages: control.numberOfPages).width + 16)
    glass.frame = CGRect(x: (bounds.width - width) / 2, y: 0, width: width, height: bounds.height)
    control.frame = glass.bounds
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
