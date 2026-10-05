import SwiftUI

@available(iOS 16.0, *)
struct OnboardingLocationPage: View {
  @ObservedObject var model: OnboardingModel

  var body: some View {
    GeometryReader { geometry in
      let mapHeight = min(440, max(340, geometry.size.width * 1.02))
      // Use the spare height on larger phones; compact phones keep short gaps
      // and scroll naturally instead of squeezing text behind the footer.
      let benefitSpacing = 16 + min(30, max(0, (geometry.size.height - 650) * 0.30))
      ZStack(alignment: .top) {
        OnboardingLocationIllustration(isActive: model.step == 1 && model.settledStep == 1, heroHeight: mapHeight + 100)
          .ignoresSafeArea()
        ScrollView {
          VStack(spacing: 18) {
            VStack(spacing: 10) {
              Text("Location permission")
                .font(.system(.largeTitle, design: .rounded).bold())
                .accessibilityAddTraits(.isHeader)
              Text("Use your location to discover nearby stations and find a better price at your next stop.")
                .font(.body).fixedSize(horizontal: false, vertical: true)
            }.multilineTextAlignment(.center).padding(.horizontal, 28)

            VStack(alignment: .leading, spacing: benefitSpacing) {
              benefit("Find nearby gas", detail: "See stations around you and how far away they are.", icon: "location.fill", color: .blue)
              benefit("Find a better price", detail: "Compare reported prices for the fuel you use.", icon: "fuelpump.fill", color: .purple)
              benefit("You’re in control", detail: "Change location access any time in Settings.", icon: "hand.raised.fill", color: .green)
            }.frame(maxWidth: 440, alignment: .leading).padding(.horizontal, 32)

            if model.locationBlocked {
              status("Location access is off. Open Settings to find nearby gas.")
            } else if let error = model.locationError {
              status(error)
            } else if model.locationRequested && model.hasLocationAccess && !model.locationReady {
              HStack(spacing: 10) { ProgressView(); Text("Finding your location…").font(.subheadline) }
            }
          }
          .padding(.top, mapHeight - 25)
          .padding(.bottom, 24)
          .frame(maxWidth: .infinity)
          .overlay(alignment: .top) {
            // Attached to the scroll content, so the mark scrolls with the page.
            OnboardingWordmark().padding(.top, geometry.safeAreaInsets.top)
          }
        }.ignoresSafeArea(.container, edges: .top)
      }
    }
  }

  private func benefit(_ title: String, detail: String, icon: String, color: Color) -> some View {
    HStack(alignment: .top, spacing: 20) {
      Image(systemName: icon).font(.system(size: 30, weight: .semibold))
        .foregroundStyle(color).frame(width: 42, height: 44).accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 4) {
        Text(title).font(.headline)
        Text(detail).font(.subheadline).foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
  }

  private func status(_ text: String) -> some View {
    Text(text).font(.subheadline).foregroundStyle(.secondary)
      .multilineTextAlignment(.center).padding(.horizontal, 28)
  }
}
