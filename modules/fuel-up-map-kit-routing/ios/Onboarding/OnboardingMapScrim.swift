import SwiftUI

// The same native blur in both appearances, without an opaque color wash.
struct OnboardingMapScrim: View {
  var topHeight: CGFloat = 330
  var bottomHeight: CGFloat = 220

  var body: some View {
    VStack(spacing: 0) {
      band(top: true).frame(height: topHeight)
      Spacer(minLength: 0)
      band(top: false).frame(height: bottomHeight)
    }.ignoresSafeArea().allowsHitTesting(false).accessibilityHidden(true)
  }

  private func band(top: Bool) -> some View {
    Rectangle().fill(.ultraThinMaterial)
      .mask(LinearGradient(stops: top
        ? [.init(color: .black, location: 0), .init(color: .black, location: 0.6), .init(color: .clear, location: 1)]
        : [.init(color: .clear, location: 0), .init(color: .black, location: 0.65), .init(color: .black, location: 1)],
        startPoint: .top, endPoint: .bottom))
  }
}
