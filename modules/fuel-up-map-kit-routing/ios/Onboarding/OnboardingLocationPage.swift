import SwiftUI

@available(iOS 16.0, *)
struct OnboardingLocationPage: View {
  @ObservedObject var model: OnboardingModel

  var body: some View {
    GeometryReader { geometry in
      let mapHeight = min(440, max(340, geometry.size.width * 1.02))
      ScrollView {
        VStack(spacing: 18) {
          VStack(spacing: 10) {
            Text("Location permission")
              .font(.system(.largeTitle, design: .rounded).bold())
              .accessibilityAddTraits(.isHeader)
            Text("Use your location to discover nearby stations and find a better price at your next stop.")
              .font(.body).fixedSize(horizontal: false, vertical: true)
          }.multilineTextAlignment(.center).padding(.horizontal, 28)

          VStack(alignment: .leading, spacing: 16) {
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
        .padding(.top, mapHeight - 50)
        .padding(.bottom, 24)
        .frame(maxWidth: .infinity)
        .background(alignment: .top) {
          // Extend the artwork behind the content without moving the heading
          // or the stationary footer. Pills stay above the text overlap.
          OnboardingLocationIllustration(isActive: model.step == 1, priceAreaHeight: mapHeight - 95)
            .frame(height: mapHeight + 100)
        }
      }.ignoresSafeArea(.container, edges: .top)
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
