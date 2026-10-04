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
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Namespace private var buttons

  private var buttonTitle: String {
    if model.step == 1 && model.locationBlocked { return "Open Settings" }
    if model.step == 1 && model.locationRequested && model.hasLocationAccess && !model.locationReady && model.locationError == nil { return "Finding your location…" }
    return model.step == 3 ? "Skip" : "Continue"
  }

  @ViewBuilder var body: some View {
    if !model.searchFocused {
      VStack(spacing: 12) {
        OnboardingPageControl(selection: Binding(get: { model.step }, set: { model.selectStep($0) }), count: 4)
          .frame(width: 130, height: 28)
        actions
          .disabled(model.completing || (model.step == 1 && model.locationRequested && model.hasLocationAccess && !model.locationReady && model.locationError == nil))
      }.padding(.horizontal, 24).padding(.top, 12).padding(.bottom, 16)
    }
  }

  @ViewBuilder private var actions: some View {
    if #available(iOS 26.0, *) {
      // Keep Continue's glass identity as it becomes Skip. The new Save effect
      // splits out within Apple's container and merges back on reverse paging.
      GlassEffectContainer(spacing: 12) {
        HStack(spacing: 12) {
          actionButton(buttonTitle, id: model.step == 3 ? "onboarding-skip" : "onboarding-next",
                       prominent: model.step != 3, action: advance)
            .glassEffect(model.step == 3 ? .regular.interactive() : .regular.tint(.blue).interactive(), in: .capsule)
            .glassEffectID("advance", in: buttons)
          if model.step == 3 {
            actionButton("Save", id: "onboarding-save", prominent: true) { model.finish() }
              .glassEffect(.regular.tint(.blue).interactive(), in: .capsule)
              .glassEffectID("save", in: buttons)
              .glassEffectTransition(.matchedGeometry)
          }
        }
      }.animation(reduceMotion ? nil : .smooth(duration: 0.35), value: model.step == 3)
    } else {
      HStack(spacing: 12) {
        actionButton(buttonTitle, id: model.step == 3 ? "onboarding-skip" : "onboarding-next",
                     prominent: model.step != 3, action: advance)
          .background(model.step == 3 ? Color(uiColor: .secondarySystemGroupedBackground) : .blue, in: Capsule())
        if model.step == 3 {
          actionButton("Save", id: "onboarding-save", prominent: true) { model.finish() }
            .background(.blue, in: Capsule())
        }
      }
    }
  }

  private func actionButton(_ title: String, id: String, prominent: Bool,
                            action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Text(title).font(.headline)
        .foregroundStyle(prominent ? Color.white : Color.primary)
        .padding(.horizontal, 16)
        .frame(maxWidth: .infinity, minHeight: 66)
        .contentShape(Capsule())
    }.buttonStyle(.plain).accessibilityIdentifier(id)
  }

  private func advance() {
    if model.step == 1 && !model.locationReady { model.requestLocation() }
    else if model.step == 3 { model.finish(skippingPreferences: true) }
    else { model.selectStep(model.step + 1) }
  }
}

struct OnboardingFooterHeightKey: PreferenceKey {
  static var defaultValue: CGFloat = 0
  static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}
