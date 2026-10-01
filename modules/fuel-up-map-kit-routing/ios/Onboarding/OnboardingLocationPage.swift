import SwiftUI

struct OnboardingLocationPage: View {
  @ObservedObject var model: OnboardingModel
  var body: some View {
    GeometryReader { geometry in
      ScrollView {
        VStack(alignment: .leading, spacing: 28) {
          OnboardingHeading(title: "Gas near you", subtitle: "Use your location to find nearby stations.")
          Spacer(minLength: 0)
          Image(systemName: model.hasLocationAccess ? "location.circle.fill" : "location.circle")
            .font(.system(size: min(geometry.size.width * 0.38, 150), weight: .light))
            .foregroundStyle(.blue).frame(maxWidth: .infinity).accessibilityHidden(true)
          Text(model.hasLocationAccess ? "You’re all set." : model.locationBlocked ? "You can enable location in Settings, or do this later." : "A better fill-up starts nearby.")
            .font(.title3.weight(.medium)).multilineTextAlignment(.center).frame(maxWidth: .infinity)
          if let error = model.locationError { Text(error).font(.subheadline).foregroundStyle(.secondary) }
          Spacer(minLength: 0)
        }.padding(24).frame(minHeight: geometry.size.height)
      }
    }
  }
}
