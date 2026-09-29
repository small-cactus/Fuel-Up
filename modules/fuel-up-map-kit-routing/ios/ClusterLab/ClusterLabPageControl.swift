import ExpoModulesCore
import UIKit

// UIKit owns pagination layout, large page counts, scrubbing and VoiceOver.
final class ClusterLabPageControl: ExpoView {
  let control = UIPageControl()
  let onPageChange = EventDispatcher()
  var pageCount = 0
  var currentPage = 0

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    control.hidesForSinglePage = true
    control.backgroundStyle = .automatic
    control.addTarget(self, action: #selector(changed), for: .valueChanged)
    addSubview(control)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    control.frame = bounds
  }

  func setDark(_ dark: Bool) {
    overrideUserInterfaceStyle = dark ? .dark : .light
  }

  func applyPages() {
    control.numberOfPages = max(0, pageCount)
    control.currentPage = min(max(0, currentPage), max(0, pageCount - 1))
  }

  @objc private func changed() { onPageChange(["page": control.currentPage]) }
}
