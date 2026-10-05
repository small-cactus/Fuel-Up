import SwiftUI
import UIKit

/// Resolve the window's corners with public UIKit geometry, without a device table.
struct DrivingResearchSheetCorners: UIViewRepresentable {
  var onChange: (CGFloat?) -> Void

  func makeUIView(context: Context) -> CornerReader {
    let view = CornerReader()
    view.isUserInteractionEnabled = false
    view.isAccessibilityElement = false
    view.onChange = onChange
    return view
  }
  func updateUIView(_ view: CornerReader, context: Context) { view.onChange = onChange }

  final class CornerReader: UIView {
    var onChange: ((CGFloat?) -> Void)?
    private weak var measuredWindow: UIWindow?
    private var measuredBounds: CGRect?

    override func didMoveToWindow() {
      super.didMoveToWindow()
      measuredBounds = nil
      setNeedsLayout()
    }
    override func layoutSubviews() {
      super.layoutSubviews()
      guard let window, measuredWindow !== window || measuredBounds != window.bounds else { return }
      measuredWindow = window
      measuredBounds = window.bounds
      let guide = UIView(frame: window.bounds)
      guide.isUserInteractionEnabled = false
      guide.isAccessibilityElement = false
      guide.backgroundColor = .clear
      guide.cornerConfiguration = .uniformCorners(radius: .containerConcentric())
      window.addSubview(guide)
      guide.layoutIfNeeded()
      let radius = guide.effectiveRadius(corner: .allCorners)
      guide.removeFromSuperview()
      DispatchQueue.main.async { [weak self] in self?.onChange?(radius > 0 ? radius : nil) }
    }
  }
}
