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

  private var isPriceAlerts: Bool { model.step == OnboardingModel.pageCount - 1 }
  private var hasSplitActions: Bool { model.step == 3 || isPriceAlerts }
  private var leadingID: String {
    isPriceAlerts ? "onboarding-alerts-later" : (model.step == 3 ? "onboarding-skip" : "onboarding-next")
  }
  private var trailingTitle: String {
    isPriceAlerts ? (model.alertsDenied ? "Open Settings" : "Yes, tell me") : "Save"
  }

  private var buttonTitle: String {
    if isPriceAlerts { return "Not now" }
    if model.step == 1 && model.locationRequested && model.hasLocationAccess && !model.locationReady && model.locationError == nil { return "Finding your location…" }
    return model.step == 3 ? "Skip" : "Continue"
  }

  @ViewBuilder var body: some View {
    if !model.searchFocused {
      VStack(spacing: 12) {
        if let error = model.saveError {
          Text(LocalizedStringKey(error)).font(.footnote).foregroundStyle(.secondary)
            .multilineTextAlignment(.center).accessibilityIdentifier("onboarding-save-error")
        }
        OnboardingPageControl(selection: Binding(get: { model.step }, set: { model.selectStep($0) }), count: OnboardingModel.pageCount)
          .frame(width: 130, height: 28)
        Group {
          if model.step == OnboardingModel.pageCount - 1 { alertActions } else { actions }
        }
          .disabled(model.completing || (model.step == 1 && model.locationRequested && model.hasLocationAccess && !model.locationReady && model.locationError == nil))
      }.disabled(model.completing || model.requestingAlerts).padding(.horizontal, 24).padding(.top, 12).padding(.bottom, 16)
    }
  }

  private var alertActions: some View {
    actions
    .task { await model.refreshAlertPermission() }
    .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
      Task { await model.refreshAlertPermission() }
    }
  }

  @ViewBuilder private var actions: some View {
    if #available(iOS 26.0, *) {
      // Keep the same split capsules for preferences and price-drop permission.
      // They merge back into Continue when returning to earlier pages.
      GlassEffectContainer(spacing: 12) {
        HStack(spacing: 12) {
          actionButton(buttonTitle, id: leadingID, prominent: !hasSplitActions, action: advance)
            .glassEffect(hasSplitActions ? .regular.interactive() : .regular.tint(.blue).interactive(), in: .capsule)
            .glassEffectID("advance", in: buttons)
          if hasSplitActions {
            actionButton(trailingTitle, id: isPriceAlerts ? "onboarding-next" : "onboarding-save",
                         prominent: true, action: confirm)
              .glassEffect(.regular.tint(.blue).interactive(), in: .capsule)
              .glassEffectID("save", in: buttons)
              .glassEffectTransition(.matchedGeometry)
          }
        }
      }.animation(reduceMotion ? nil : .smooth(duration: 0.35), value: hasSplitActions)
    } else {
      HStack(spacing: 12) {
        actionButton(buttonTitle, id: leadingID, prominent: !hasSplitActions, action: advance)
          .background(hasSplitActions ? Color(uiColor: .secondarySystemGroupedBackground) : .blue, in: Capsule())
        if hasSplitActions {
          actionButton(trailingTitle, id: isPriceAlerts ? "onboarding-next" : "onboarding-save",
                       prominent: true, action: confirm)
            .background(.blue, in: Capsule())
        }
      }
    }
  }

  private func actionButton(_ title: String, id: String, prominent: Bool,
                            action: @escaping () -> Void) -> some View {
    Button(action: action) {
      HStack(spacing: 8) {
        if model.completing && ((id == "onboarding-save" && !model.completingWithoutPreferences)
            || (id == "onboarding-skip" && model.completingWithoutPreferences)) {
          ProgressView().tint(prominent ? .white : .primary)
            .accessibilityLabel("Preparing Home")
        }
        Text(LocalizedStringKey(title)).font(.headline)
      }.foregroundStyle(prominent ? Color.white : Color.primary)
        .padding(.horizontal, 16)
        .frame(maxWidth: .infinity, minHeight: 66)
        .contentShape(Capsule())
    }.buttonStyle(.plain).accessibilityIdentifier(id)
  }

  private func advance() {
    if isPriceAlerts { model.skipPriceAlerts(); return }
    OnboardingTelemetry.emit("onboarding_action", ["action":model.step == 3 ? "skip" : "continue", "step":model.step])
    if model.step == 1 && !model.locationReady { model.requestLocation() }
    else if model.step == 3 { model.leaveBrands(skipping: true) }
    else { model.selectStep(model.step + 1) }
  }

  private func confirm() {
    if isPriceAlerts { Task { await model.enablePriceAlerts() } }
    else { model.leaveBrands(skipping: false) }
  }
}

struct OnboardingFooterHeightKey: PreferenceKey {
  static var defaultValue: CGFloat = 0
  static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}
