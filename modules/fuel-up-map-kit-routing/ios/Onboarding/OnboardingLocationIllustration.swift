import SwiftUI

// Decorative sample map and illustrative prices, separate from live station data.
@available(iOS 16.0, *)
struct OnboardingLocationIllustration: View {
  let isActive: Bool
  let heroHeight: CGFloat

  var body: some View {
    GeometryReader { geometry in
      // Shorter bands leave more of the creek clear. A lower radius and the
      // library's smooth gradient soften the top without a sharp blur boundary.
      let topBlurHeight = min(geometry.size.height, heroHeight * 0.27)
      let bottomBlurHeight = max(0, geometry.size.height - heroHeight * 0.52)
      Color.clear
        .overlay(alignment: .top) {
          ZStack(alignment: .top) {
            OnboardingPricePills(isActive: isActive)
              // A 40% band shifted up ten percentage points: 20% through 60%.
              .frame(height: heroHeight * 0.40)
              .clipped()
              .offset(y: heroHeight * 0.20)
            Text("Sample prices")
              .font(.caption2).foregroundStyle(.secondary)
              .position(x: geometry.size.width * 0.50, y: heroHeight * 0.70 - 8)
          }
          .frame(height: heroHeight)
        }
        .overlay {
          ZStack {
            PureProgressiveBlur(radius: 12, direction: .top)
              .frame(height: topBlurHeight)
              .offset(y: -40)
              .frame(maxHeight: .infinity, alignment: .top)
            // Preserve the clear hero and ease into blur beneath the text.
            PureProgressiveBlur(radius: 12, direction: .bottom, linearTransition: true)
              .frame(height: bottomBlurHeight)
              .offset(y: 40)
              .frame(maxHeight: .infinity, alignment: .bottom)
          }.allowsHitTesting(false)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Map illustration of Mission Creek in San Francisco with sample gas prices")
    }
  }
}
