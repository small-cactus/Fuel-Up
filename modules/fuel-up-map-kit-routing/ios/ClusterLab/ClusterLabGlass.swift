import UIKit
import LiquidGlass

// Use the installed library's native implementations, including its runtime
// availability checks. No masks, custom blur, borders, or replicated glass.
enum ClusterLabGlass {
  static func container() -> UIView {
    if #available(iOS 26.0, *), NSClassFromString("UIGlassContainerEffect") != nil {
      let view = LiquidGlassConatinerViewImpl() // Spelling is the library's public API.
      // A little more native neck/stretch before two moving pills detach.
      view.spacing = 12
      view.clipsToBounds = false
      view.contentView.clipsToBounds = false
      return view
    }
    return UIView()
  }

  static func content(of view: UIView) -> UIView {
    (view as? UIVisualEffectView)?.contentView ?? view
  }

  static func pill() -> UIView {
    if #available(iOS 26.0, *), NSClassFromString("UIGlassEffect") != nil {
      let view = LiquidGlassViewImpl()
      view.style = .clear
      view.interactive = false
      view.cornerConfiguration = .capsule()
      return view
    }
    let view = UIView()
    view.backgroundColor = .secondarySystemBackground
    view.layer.cornerRadius = 16
    return view
  }
}

final class ClusterLabPill {
  let view = ClusterLabGlass.pill()
  private let priceLabel = UILabel()
  private let countLabel = UILabel()
  private let icon = UIImageView(image: UIImage(systemName: "fuelpump.fill"))
  private var lastCount = 0

  init(price: Double, name: String) {
    view.isUserInteractionEnabled = false
    view.clipsToBounds = false
    let content = ClusterLabGlass.content(of: view)
    priceLabel.text = String(format: "$%.2f", price)
    for label in [priceLabel, countLabel] {
      label.font = .systemFont(ofSize: 15, weight: .bold)
      label.textAlignment = .center
      content.addSubview(label)
    }
    content.addSubview(icon)
    icon.contentMode = .scaleAspectFit
    view.isAccessibilityElement = true
    view.accessibilityLabel = name
  }

  func render(center: CGPoint, width: CGFloat, priceMix: CGFloat, count: Int, best: Bool, dark: Bool) {
    view.bounds = CGRect(x: 0, y: 0, width: width, height: 32)
    view.center = center
    if lastCount != count {
      countLabel.text = "+\(max(1, count))"
      lastCount = count
    }
    let color: UIColor = best ? (dark ? UIColor(red: 0.067, green: 0.94, blue: 0.314, alpha: 1) : .systemBlue) :
      (dark ? .label : .secondaryLabel)
    priceLabel.textColor = color
    icon.tintColor = color
    countLabel.textColor = dark ? .label : .secondaryLabel
    // Only text fades. The effect and every glass ancestor stay at alpha 1.
    priceLabel.alpha = priceMix
    icon.alpha = priceMix
    countLabel.alpha = 1 - priceMix
    icon.frame = CGRect(x: (width - 66) / 2, y: 9, width: 14, height: 14)
    priceLabel.frame = CGRect(x: (width - 66) / 2 + 16, y: 0, width: 50, height: 32)
    countLabel.frame = view.bounds
    view.accessibilityValue = priceMix > 0.5 ? priceLabel.text : countLabel.text
  }
}
