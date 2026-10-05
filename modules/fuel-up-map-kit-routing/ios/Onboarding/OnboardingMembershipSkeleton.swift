import SwiftUI

/// Shared by onboarding and Settings so discovery never leaves a blank section.
struct OnboardingMembershipSkeleton: View {
  var title = "Memberships"
  var loadingLabel = "Loading memberships"
  var identifier = "onboarding-membership-loading"
  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack {
        Text(title).font(.headline)
        Spacer()
        ProgressView().tint(.primary)
      }
      VStack(spacing: 0) {
        ForEach(0..<3) { index in
          HStack(spacing: 14) {
            RoundedRectangle(cornerRadius: 10).frame(width: 40, height: 40)
            RoundedRectangle(cornerRadius: 5).frame(width: index == 1 ? 104 : 136, height: 16)
            Spacer()
            Circle().frame(width: 22, height: 22)
          }
          .foregroundStyle(.quaternary)
          .padding(.horizontal, 20).padding(.vertical, 16)
          if index < 2 { Divider().padding(.horizontal, 20) }
        }
      }
      .modifier(OnboardingGlass())
      .accessibilityHidden(true)
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(loadingLabel)
    .accessibilityIdentifier(identifier)
  }
}
