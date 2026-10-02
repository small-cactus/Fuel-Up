import SwiftUI

// Native material provides blur in both appearances; only light mode adds a wash.
struct OnboardingMapScrim: View {
  var topHeight: CGFloat = 330
  var bottomHeight: CGFloat = 220
  @Environment(\.colorScheme) private var scheme

  var body: some View {
    VStack(spacing: 0) {
      band(top: true).frame(height: topHeight)
      Spacer(minLength: 0)
      band(top: false).frame(height: bottomHeight)
    }.ignoresSafeArea().allowsHitTesting(false).accessibilityHidden(true)
  }

  private func band(top: Bool) -> some View {
    Rectangle().fill(.ultraThinMaterial)
      .overlay {
        if scheme == .light {
          Color(red: 242/255, green: 241/255, blue: 246/255).opacity(0.95)
        }
      }
      .mask(LinearGradient(stops: top
        ? [.init(color: .black, location: 0), .init(color: .black, location: 0.6), .init(color: .clear, location: 1)]
        : [.init(color: .clear, location: 0), .init(color: .black, location: 0.65), .init(color: .black, location: 1)],
        startPoint: .top, endPoint: .bottom))
  }
}
