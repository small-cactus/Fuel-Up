import SwiftUI
import MapKit

struct OnboardingRadiusPage: View {
  @ObservedObject var model: OnboardingModel
  var body: some View {
    GeometryReader { geometry in
      ScrollView {
        VStack(alignment: .leading, spacing: 20) {
          OnboardingHeading(title: "Your search radius", subtitle: "How far would you go for a better price?")
          if let coordinate = model.coordinate {
            OnboardingRadiusMap(coordinate: coordinate, radius: model.radius, stations: model.stations, adjustingRadius: model.adjustingRadius)
              .frame(height: max(180, min(380, geometry.size.height * 0.48)))
              .clipShape(RoundedRectangle(cornerRadius: 28))
              .accessibilityLabel("Nearby gas stations within \(Int(model.radius.rounded())) miles")
          } else {
            VStack(spacing: 16) {
              Image(systemName: "location.magnifyingglass").font(.system(size: 48)).foregroundStyle(.blue)
              Text(model.locationError ?? (model.hasLocationAccess ? "Finding your location…" : "Your radius will apply wherever you are."))
                .foregroundStyle(.secondary).multilineTextAlignment(.center)
            }.frame(maxWidth: .infinity).frame(height: max(180, min(380, geometry.size.height * 0.48)))
          }
          HStack(alignment: .firstTextBaseline) {
            Text("\(Int(model.radius.rounded()))").font(.system(.largeTitle, design: .rounded).bold()).monospacedDigit()
            Text("miles").font(.title3).foregroundStyle(.secondary)
            Spacer()
            if model.loading { ProgressView().accessibilityLabel("Loading nearby stations") }
          }
          Slider(value: $model.radius, in: 2...15, onEditingChanged: { editing in
            model.adjustingRadius = editing
            if !editing { model.radius = model.radius.rounded(); model.changed() }
          }).accessibilityLabel("Search radius").accessibilityValue("\(Int(model.radius.rounded())) miles")
            .accessibilityIdentifier("onboarding-radius")
          HStack { Text("2 mi"); Spacer(); Text("15 mi") }.font(.caption).foregroundStyle(.secondary)
          if model.error != nil {
            Button("Couldn’t load nearby stations. Try again") { model.emit?(["type": "retry"]) }.font(.subheadline)
          }
        }.padding(24)
      }
    }
  }
}

struct OnboardingRadiusMap: UIViewRepresentable {
  let coordinate: CLLocationCoordinate2D
  let radius: Double
  let stations: [OnboardingStation]
  let adjustingRadius: Bool
  func makeUIView(context: Context) -> OnboardingMapCanvas { OnboardingMapCanvas() }
  func updateUIView(_ view: OnboardingMapCanvas, context: Context) {
    view.update(coordinate: coordinate, radius: radius, stations: stations, adjustingRadius: adjustingRadius)
  }
}
