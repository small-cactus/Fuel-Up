import SwiftUI

@available(iOS 16.0, *)
struct OnboardingLocationPage: View {
  @ObservedObject var model: OnboardingModel
  let bottomInset: CGFloat
  @Environment(\.dynamicTypeSize) private var typeSize

  var body: some View {
    GeometryReader { geometry in
      ZStack(alignment: .top) {
        OnboardingLocationMap(coordinate: model.hasLocationAccess ? model.coordinate : nil)
          .ignoresSafeArea().allowsHitTesting(false).accessibilityHidden(true)
        OnboardingMapScrim(topHeight: 330, bottomHeight: 260)
        ScrollView {
          VStack(alignment: .leading, spacing: 24) {
            OnboardingHeading(title: "Gas near you", subtitle: "Enable location to find nearby gas.")
            locationAction
          }
          .padding(.horizontal, 24).padding(.top, 24)
          .padding(.bottom, 24)
        }
        .frame(height: max(0, geometry.size.height - bottomInset))
        .scrollIndicators(.automatic)
        .background {
          if typeSize.isAccessibilitySize { Rectangle().fill(.regularMaterial) }
        }
      }
    }
  }

  private var locationAction: some View {
    VStack(alignment: .leading, spacing: 12) {
      Button { model.requestLocation() } label: {
        Label(model.locationReady ? "Location enabled" : model.locationBlocked ? "Open Settings" : "Enable location",
              systemImage: model.locationReady ? "checkmark.circle.fill" : "location.fill")
          .font(.headline).frame(maxWidth: .infinity, minHeight: 44)
      }
      .buttonStyle(.borderedProminent).buttonBorderShape(.capsule).controlSize(.large)
      .modifier(OnboardingLocationButtonStyle())
      .disabled(model.locationReady)
      .accessibilityIdentifier("onboarding-enable-location")
      if let error = model.locationError {
        Text(error).font(.subheadline).foregroundStyle(.primary)
      } else if model.locationRequested && model.hasLocationAccess && !model.locationReady {
        HStack { ProgressView(); Text("Finding your location…").font(.subheadline) }
      } else if model.locationBlocked {
        Text("Turn on location in Settings to continue.").font(.subheadline).foregroundStyle(.primary)
      }
    }
  }
}

private struct OnboardingLocationButtonStyle: ViewModifier {
  func body(content: Content) -> some View {
    if #available(iOS 26.0, *) { content.buttonStyle(.glassProminent) }
    else { content }
  }
}
