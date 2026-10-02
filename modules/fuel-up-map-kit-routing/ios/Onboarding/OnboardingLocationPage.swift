import SwiftUI

@available(iOS 16.0, *)
struct OnboardingLocationPage: View {
  @ObservedObject var model: OnboardingModel

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 26) {
        OnboardingHeading(title: "Gas near you", subtitle: "Enable location to find nearby gas.")
        VStack(alignment: .leading, spacing: 22) {
          HStack(spacing: 16) {
            Image(systemName: "location.fill")
              .font(.system(size: 32, weight: .semibold)).foregroundStyle(.blue)
              .frame(width: 48, height: 48).accessibilityHidden(true)
            Text("Your current location").font(.headline)
            Spacer(minLength: 0)
          }
          if model.locationReady {
            Label("Location enabled", systemImage: "checkmark.circle.fill")
              .font(.body.weight(.medium)).foregroundStyle(.primary)
              .accessibilityIdentifier("onboarding-location-ready")
          } else {
            locationButton
          }
        }.padding(20).frame(maxWidth: .infinity, alignment: .leading).modifier(OnboardingGlass())
        if let error = model.locationError {
          Text(error).font(.subheadline).foregroundStyle(.secondary)
        } else if model.locationRequested && model.hasLocationAccess && !model.locationReady {
          HStack { ProgressView(); Text("Finding your location…").font(.subheadline) }
        } else if model.locationBlocked {
          Text("Turn on location in Settings to continue.").font(.subheadline).foregroundStyle(.secondary)
        }
      }.padding(24)
    }
  }

  private var locationButton: some View {
    Button { model.requestLocation() } label: {
      Text(model.locationBlocked ? "Open Settings" : "Enable location")
        .font(.headline).frame(maxWidth: .infinity, minHeight: 28)
    }
    .buttonStyle(.borderedProminent).buttonBorderShape(.capsule).controlSize(.large)
    .modifier(OnboardingLocationButtonStyle())
    .accessibilityIdentifier("onboarding-enable-location")
  }
}

private struct OnboardingLocationButtonStyle: ViewModifier {
  func body(content: Content) -> some View {
    if #available(iOS 26.0, *) { content.buttonStyle(.glassProminent) }
    else { content }
  }
}
