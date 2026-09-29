import UIKit

// Use Apple's effect views directly so UIKit owns their material and layout.
// No masks, custom blur, borders, or replicated glass.
enum ClusterLabGlass {
  static func container() -> UIView {
    if #available(iOS 26.0, *), NSClassFromString("UIGlassContainerEffect") != nil {
      // The library's container rebuilds its effect on every layout, causing
      // material/tint settling flashes when membership changes. UIKit's native
      // view preserves one effect through layouts and chip reparenting.
      let effect = UIGlassContainerEffect()
      effect.spacing = ClusterLabGeometry.glassSpacing
      let view = ClusterLabGlassContainer(effect: effect)
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
      // The library subclass returns from layoutSubviews without calling
      // super once an effect exists. That skips UIKit's native material layout
      // during resizing/reparenting even when effect.tintColor is unchanged.
      let view = UIVisualEffectView(effect: nil)
      view.cornerConfiguration = .capsule()
      return view
    }
    let view = UIView()
    view.backgroundColor = .secondarySystemBackground
    view.layer.cornerRadius = 16
    return view
  }

  static func marketTint(score: Double) -> UIColor? {
    guard abs(score) > 0.001 else { return nil }
    let strength = CGFloat(min(1, abs(score)))
    // Match WelcomeStep.OnboardingChip and PredictiveFuelingStep: #00FF2F
    // green / #FF1900 red, at 30% tint opacity. Desaturate toward pastel at
    // typical prices without darkening the native material or changing alpha.
    let hue: CGFloat = score > 0 ? (2 + 47.0 / 255) / 6 : (25.0 / 255) / 6
    return UIColor(hue: hue, saturation: 0.18 + 0.82 * strength,
                   brightness: 1, alpha: 0.3)
  }
}

final class ClusterLabPill {
  let view = ClusterLabGlass.pill()
  private let priceLabel = UILabel()
  private let countLabel = UILabel()
  private let icon = UIImageView(image: UIImage(systemName: "fuelpump.fill"))
  private var lastScale: CGFloat = 1
  private var lastCount = 0
  private var marketDescription = "Price comparison unavailable"
  private var lastCheapestPrice: Double?
  private var wasCheapest = false
  private let price: Double
  private(set) var tintScore: Double = 0
  private(set) var tintUpdateCount = 0
  private var hasTint = false
  var materialTint: [CGFloat] {
    var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
    if #available(iOS 26.0, *), let glass = view as? UIVisualEffectView,
       let effect = glass.effect as? UIGlassEffect,
       effect.tintColor?.getRed(&red, green: &green, blue: &blue, alpha: &alpha) == true {
      return [red, green, blue, alpha]
    }
    return []
  }

  init(price: Double, name: String) {
    self.price = price
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

  func applyMarket(_ market: LabMarketAssessment) {
    if lastCheapestPrice != market.cheapestPrice || wasCheapest != (market.score > 0) {
      lastCheapestPrice = market.cheapestPrice
      wasCheapest = market.score > 0
      if let cheapest = market.cheapestPrice {
        let cents = Int((max(0, price - cheapest) * 100).rounded())
        marketDescription = wasCheapest ? "Cheapest confirmed station in this search" :
          (cents == 0 ? "Same price as the cheapest confirmed station" :
            "\(cents) cents above the cheapest confirmed station in this search")
      } else { marketDescription = "Price comparison unavailable" }
    }
    let nextScore = (market.score * 20).rounded() / 20
    guard !hasTint || nextScore != tintScore else { return }
    hasTint = true; tintScore = nextScore; tintUpdateCount += 1
    let color = ClusterLabGlass.marketTint(score: nextScore)
    if #available(iOS 26.0, *), let glass = view as? UIVisualEffectView {
      let effect = UIGlassEffect(style: .regular)
      effect.isInteractive = false
      effect.tintColor = color
      // Commit a content-role tint change once without a separate color tween.
      // Unchanged station prices never recreate their native material.
      UIView.performWithoutAnimation { glass.effect = effect }
    } else { view.backgroundColor = color ?? .secondarySystemBackground }
  }

  func render(center: CGPoint, width: CGFloat, priceMix: CGFloat, count: Int, market: LabMarketAssessment?, dark: Bool, scale: CGFloat = 1) {
    if let market { applyMarket(market) }
    view.bounds = CGRect(x: 0, y: 0, width: width * scale, height: 32 * scale)
    view.center = center
    if lastCount != count {
      countLabel.text = "+\(max(1, count))"
      lastCount = count
    }
    // Onboarding's adaptive foreground stays readable over these lighter tints.
    let color: UIColor = .label
    priceLabel.textColor = color
    icon.tintColor = color
    countLabel.textColor = color
    // Only text fades. The effect and every glass ancestor stay at alpha 1.
    priceLabel.alpha = priceMix
    icon.alpha = priceMix
    countLabel.alpha = 1 - priceMix
    if scale != lastScale {
      lastScale = scale
      priceLabel.font = .systemFont(ofSize: 15 * scale, weight: .bold)
      countLabel.font = .systemFont(ofSize: 15 * scale, weight: .bold)
      if !(view is UIVisualEffectView) { view.layer.cornerRadius = 16 * scale }
    }
    icon.frame = CGRect(x: (width - 66) / 2 * scale, y: 9 * scale, width: 14 * scale, height: 14 * scale)
    priceLabel.frame = CGRect(x: ((width - 66) / 2 + 16) * scale, y: 0, width: 50 * scale, height: 32 * scale)
    countLabel.frame = view.bounds
    view.accessibilityValue = priceMix > 0.5 ? "\(priceLabel.text ?? ""), \(marketDescription)" : countLabel.text
  }
}

// Track public material assignments, rather than UIKit's copied effect getter.
// Native UIKit continues to own all layout, merging, and material rendering.
final class ClusterLabGlassContainer: UIVisualEffectView {
  private(set) var materialResetCount = 0
  override var effect: UIVisualEffect? {
    didSet { materialResetCount += 1 }
  }
}
