import SwiftUI

@available(iOS 16.0, *)
struct OnboardingFlow: View {
  @ObservedObject var model: OnboardingModel
  let backToWelcome: () -> Void
  var body: some View {
    NavigationStack(path: $model.path) {
      page(0)
        .toolbar { ToolbarItem(placement: .navigationBarLeading) {
          Button(action: backToWelcome) { Image(systemName: "chevron.left") }
            .accessibilityLabel("Back to welcome")
        } }
        .navigationDestination(for: Int.self) { page($0) }
    }.tint(.blue)
  }
  private func page(_ step: Int) -> some View {
    Group {
      switch step {
      case 1: OnboardingRadiusPage(model: model)
      case 2: OnboardingFuelPage(model: model)
      case 3: OnboardingBrandsPage(model: model)
      default: OnboardingLocationPage(model: model)
      }
    }
    .background(Color(uiColor: .systemGroupedBackground))
    .navigationBarTitleDisplayMode(.inline)
    .toolbar { ToolbarItem(placement: .principal) {
      Text("\(step + 1) of 4").font(.subheadline.weight(.medium)).foregroundStyle(.secondary)
        .accessibilityLabel("Setup, step \(step + 1) of 4")
    } }
    .safeAreaInset(edge: .bottom, spacing: 0) {
      VStack(spacing: 8) {
        OnboardingPrimaryButton(title: step == 0 ? (model.hasLocationAccess ? "Continue" : model.locationBlocked ? "Open Settings" : "Use my location") : step == 3 ? "Find gas" : "Continue") {
          if step == 0 { model.advanceLocation() }
          else if step == 3 { model.finish() }
          else { model.changed(); model.path.append(step + 1) }
        }.disabled(model.completing)
        if step == 0 && !model.hasLocationAccess {
          Button("Not now") { model.skipLocation() }.frame(minHeight: 44)
            .accessibilityIdentifier("onboarding-skip-location")
        }
      }.padding(.horizontal, 24).padding(.top, 12).padding(.bottom, 12)
        .background(Color(uiColor: .systemGroupedBackground))
    }
  }
}
