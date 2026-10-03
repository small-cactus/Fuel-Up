import SwiftUI

// Reserve a native scroll-edge bar on each moving page. Its visible controls
// live once in OnboardingFlow; scrolling content still gets a soft edge.
@available(iOS 16.0, *)
struct OnboardingBottomBar: ViewModifier {
  @ObservedObject var model: OnboardingModel
  var overlaysMap = false

  func body(content: Content) -> some View {
    if overlaysMap {
      content.overlay(alignment: .bottom) { footer }
    } else if #available(iOS 26.0, *) {
      content
        .safeAreaInset(edge: .bottom, spacing: 0) { footer }
        .scrollEdgeEffectHidden(true, for: .all)
    } else {
      content.safeAreaInset(edge: .bottom, spacing: 0) { footer }
    }
  }

  // Preserve each page's native scroll-edge treatment and bottom content inset.
  // Only the footer in OnboardingFlow is visible, so it never rides the pager.
  private var footer: some View {
    Color.clear.frame(height: model.searchFocused ? 0 : model.footerHeight)
      .allowsHitTesting(false).accessibilityHidden(true)
  }
}

@available(iOS 16.0, *)
struct OnboardingFooter: View {
  @ObservedObject var model: OnboardingModel

  private var buttonTitle: String {
    if model.step == 1 && model.locationBlocked { return "Open Settings" }
    if model.step == 1 && model.locationRequested && model.hasLocationAccess && !model.locationReady && model.locationError == nil { return "Finding your location…" }
    return model.step == 3 ? "Find gas" : "Continue"
  }

  @ViewBuilder var body: some View {
    if !model.searchFocused {
      VStack(spacing: 12) {
        OnboardingPageControl(selection: Binding(get: { model.step }, set: { model.selectStep($0) }), count: 4)
          .frame(width: 130, height: 28)
        OnboardingPrimaryButton(title: buttonTitle) {
          if model.step == 1 && !model.locationReady { model.requestLocation() }
          else
          if model.step == 3 { model.finish() }
          else { model.selectStep(model.step + 1) }
        }.disabled(model.completing || (model.step == 1 && model.locationRequested && model.hasLocationAccess && !model.locationReady && model.locationError == nil))
      }.padding(.horizontal, 24).padding(.top, 12).padding(.bottom, 16)
    }
  }
}

struct OnboardingFooterHeightKey: PreferenceKey {
  static var defaultValue: CGFloat = 0
  static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}
