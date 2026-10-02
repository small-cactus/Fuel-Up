import SwiftUI

struct OnboardingLocationPage: View {
  @ObservedObject var model: OnboardingModel
  var body: some View {
    GeometryReader { geometry in
      ScrollView {
        VStack(spacing: 28) {
          ZStack {
            Circle().fill(.blue.opacity(0.05)).frame(width: 230, height: 230)
            Circle().fill(.blue.opacity(0.08)).frame(width: 166, height: 166)
            Image(systemName: "location.fill").font(.system(size: 62, weight: .medium)).foregroundStyle(.blue)
          }.accessibilityHidden(true)
          VStack(spacing: 12) {
            Text("Find gas near you").font(.system(.largeTitle, design: .rounded).bold())
            Text("Use your location to see nearby stations.").font(.body).foregroundStyle(.secondary)
            if model.locationBlocked { Text("Location is turned off. You can change it in Settings.").font(.footnote).foregroundStyle(.secondary) }
          }.multilineTextAlignment(.center)
        }.padding(.horizontal, 28).padding(.top, max(100, geometry.size.height * 0.17))
          .padding(.bottom, 180).frame(maxWidth: .infinity)
      }
    }.background(Color(uiColor: .systemGroupedBackground))
  }
}
