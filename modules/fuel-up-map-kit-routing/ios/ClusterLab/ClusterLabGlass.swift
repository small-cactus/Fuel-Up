import UIKit
import LiquidGlass

// Use the installed library's native implementations, including its runtime
// availability checks. No masks, custom blur, borders, or replicated glass.
enum ClusterLabGlass {
  static func container() -> UIView {
    if #available(iOS 26.0, *), NSClassFromString("UIGlassContainerEffect") != nil {
      let view = LiquidGlassConatinerViewImpl() // Spelling is the library's public API.
      // Let Apple's native neck stretch farther before moving pills detach.
      view.spacing = ClusterLabGeometry.glassSpacing
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
      view.style = .regular
      view.interactive = false
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

  private func applyMarket(_ market: LabMarketAssessment) {
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
    let animate = hasTint && !UIAccessibility.isReduceMotionEnabled
    hasTint = true; tintScore = nextScore; tintUpdateCount += 1
    let color = ClusterLabGlass.marketTint(score: nextScore)
    if #available(iOS 26.0, *), let glass = view as? LiquidGlassViewImpl {
      glass.effectTintColor = color
      let effect = UIGlassEffect(style: .regular)
      effect.isInteractive = false
      effect.tintColor = color
      if animate {
        // One native material animation per target change, not one effect per
        // frame. Its 80 ms finish precedes the shortest split/merge handoff.
        UIView.animate(withDuration: 0.08, delay: 0,
                       options: [.beginFromCurrentState, .allowUserInteraction]) { glass.effect = effect }
      } else { UIView.performWithoutAnimation { glass.effect = effect } }
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
