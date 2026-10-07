import SwiftUI

struct OnboardingPinchHint: View {
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver
  @State private var spread = false

  var body: some View {
    ZStack {
      Color.black.opacity(0.48).ignoresSafeArea()
      VStack(spacing: 24) {
        HStack(spacing: spread ? 72 : 24) {
          Circle().fill(.white).frame(width: 22, height: 22)
          Image(systemName: "arrow.left.and.right").font(.title2)
          Circle().fill(.white).frame(width: 22, height: 22)
        }.frame(height: 48).accessibilityHidden(true)
        Text(LocalizedStringKey(voiceOver ? "Swipe up or down on the map to resize radius" : "Pinch to resize radius"))
          .font(.title2.weight(.semibold)).multilineTextAlignment(.center)
          .fixedSize(horizontal: false, vertical: true)
      }.foregroundStyle(.white).padding(.horizontal, 36)
    }
    .onAppear {
      guard !reduceMotion else { return }
      withAnimation(.easeInOut(duration: 1.1).repeatForever(autoreverses: true)) { spread = true }
    }
  }
}
