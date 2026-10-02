import SwiftUI

// Register the actual controls as a native scroll-edge bar. The scroll view
// extends underneath it instead of being clipped above an opaque footer.
@available(iOS 16.0, *)
struct OnboardingBottomBar: ViewModifier {
  @ObservedObject var model: OnboardingModel

  func body(content: Content) -> some View {
    if #available(iOS 26.0, *) {
      content
        .safeAreaBar(edge: .bottom, spacing: 0) { footer }
        .scrollEdgeEffectStyle(.soft, for: .all)
    } else {
      content.safeAreaInset(edge: .bottom, spacing: 0) { footer.background(.ultraThinMaterial) }
    }
  }

  @ViewBuilder private var footer: some View {
    if !model.searchFocused {
      VStack(spacing: 12) {
        OnboardingPageControl(selection: Binding(get: { model.step }, set: { model.selectStep($0) }), count: 4)
          .frame(width: 130, height: 28)
        OnboardingPrimaryButton(title: model.step == 3 ? "Find gas" : "Continue") {
          if model.step == 3 { model.finish() }
          else { model.selectStep(model.step + 1) }
        }.disabled(model.completing || (model.step == 1 && !model.locationReady))
      }.padding(.horizontal, 24).padding(.top, 12).padding(.bottom, 16)
    }
  }
}
