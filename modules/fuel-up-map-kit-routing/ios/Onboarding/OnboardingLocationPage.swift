import SwiftUI

@available(iOS 16.0, *)
struct OnboardingLocationPage: View {
  @ObservedObject var model: OnboardingModel

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 28) {
        OnboardingHeading(title: "Your next great stop", subtitle: "Good gas prices are closer than you think.")
        OnboardingLocationIllustration()
          .frame(height: 280)
          .clipShape(RoundedRectangle(cornerRadius: 32, style: .continuous))
          .accessibilityLabel("Illustration of gas stations on a map")
        VStack(alignment: .leading, spacing: 12) {
          Text("Find the savings around you").font(.title3.weight(.semibold))
          Text("Fuel Up uses your location to find nearby stations, compare reported prices, and show how far away they are.")
            .font(.body).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
          if model.locationBlocked {
            Text("Location access is off. You can change it in Settings to find nearby gas.")
              .font(.subheadline).foregroundStyle(.secondary)
          } else if let error = model.locationError {
            Text(error).font(.subheadline).foregroundStyle(.secondary)
          } else if model.locationRequested && model.hasLocationAccess && !model.locationReady {
            HStack(spacing: 10) { ProgressView(); Text("Finding your location…").font(.subheadline) }
          } else if !model.hasLocationAccess {
            Text("Continue opens Apple’s location permission prompt.")
              .font(.footnote).foregroundStyle(.secondary)
          }
        }
      }.padding(24)
    }
  }
}
