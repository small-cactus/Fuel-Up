import SwiftUI

struct OnboardingMapScrim: View {
  var topHeight: CGFloat = 330
  var bottomHeight: CGFloat = 220

  var body: some View {
    VStack(spacing: 0) {
      PureProgressiveBlur(direction: .top).frame(height: topHeight)
      Spacer(minLength: 0)
      PureProgressiveBlur(direction: .bottom).frame(height: bottomHeight)
    }.ignoresSafeArea().allowsHitTesting(false).accessibilityHidden(true)
  }
}
