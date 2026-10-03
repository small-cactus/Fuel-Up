import SwiftUI

struct OnboardingMapScrim: View {
  var topHeight: CGFloat = 330
  var bottomHeight: CGFloat = 220

  var body: some View {
    // Independent edge layers preserve the top ramp on compact screens too.
    ZStack {
      PureProgressiveBlur(direction: .top).frame(height: topHeight)
        .frame(maxHeight: .infinity, alignment: .top)
      PureProgressiveBlur(radius: 12, direction: .bottom)
        .frame(height: bottomHeight)
        .frame(maxHeight: .infinity, alignment: .bottom)
    }.ignoresSafeArea().allowsHitTesting(false).accessibilityHidden(true)
  }
}
