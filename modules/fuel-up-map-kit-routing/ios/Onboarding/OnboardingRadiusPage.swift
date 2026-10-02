import SwiftUI
import MapKit

struct OnboardingRadiusPage: View {
  @ObservedObject var model: OnboardingModel
  @Environment(\.dynamicTypeSize) private var typeSize
  var body: some View {
    GeometryReader { geometry in
      ZStack {
        if let coordinate = model.coordinate {
          OnboardingRadiusMap(model: model, coordinate: coordinate).ignoresSafeArea()
        } else { Color(uiColor: .systemGroupedBackground).ignoresSafeArea() }
        VStack {
          LinearGradient(stops: [.init(color: Color(uiColor: .systemGroupedBackground), location: 0), .init(color: Color(uiColor: .systemGroupedBackground).opacity(0.96), location: 0.7), .init(color: .clear, location: 1)], startPoint: .top, endPoint: .bottom).frame(height: 340)
          Spacer()
          LinearGradient(stops: [.init(color: .clear, location: 0), .init(color: Color(uiColor: .systemGroupedBackground).opacity(0.96), location: 0.35), .init(color: Color(uiColor: .systemGroupedBackground), location: 1)], startPoint: .top, endPoint: .bottom).frame(height: 340)
        }.ignoresSafeArea().allowsHitTesting(false)
        VStack(alignment: .leading, spacing: 12) {
          if typeSize.isAccessibilitySize {
            Text("Search radius").font(.title2.bold()).fixedSize(horizontal: false, vertical: true)
          } else {
            OnboardingHeading(title: "Your search radius", subtitle: "How far would you go for a better price?")
          }
          Spacer()
          if model.coordinate == nil {
            Text(model.hasLocationAccess ? "Finding your location…" : "Enable location to preview your area.")
              .font(.body).foregroundStyle(.secondary).frame(maxWidth: .infinity)
            Spacer()
          }
          HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text("\(Int(model.radius.rounded()))").font(.system(.largeTitle, design: .rounded).bold()).monospacedDigit()
            Text("miles").font(.title3).foregroundStyle(.secondary)
            Spacer()
            if model.coordinate != nil && !typeSize.isAccessibilitySize { Text("Pinch to resize").font(.subheadline).foregroundStyle(.secondary) }
          }
          Slider(value: $model.radius, in: RadiusSelection.minimum...RadiusSelection.maximum, onEditingChanged: { editing in
            model.adjustingRadius = editing
            if !editing { model.radius = RadiusSelection.snap(model.radius); model.changed(); UISelectionFeedbackGenerator().selectionChanged() }
          }).accessibilityLabel("Search radius").accessibilityValue("\(Int(model.radius.rounded())) miles")
            .accessibilityIdentifier("onboarding-radius")
          HStack {
            ForEach(RadiusSelection.notches, id: \.self) { tick in
              VStack(spacing: 5) {
                Capsule().fill(Color.secondary.opacity(0.5)).frame(width: 2, height: tick == 2 || tick == 15 ? 7 : 4)
              }.frame(maxWidth: .infinity, alignment: .top)
            }
          }.foregroundStyle(.secondary).accessibilityHidden(true)
          HStack {
            Text("2 mi")
            Spacer()
            Text("15 mi")
          }.font(.caption2).foregroundStyle(.secondary).accessibilityHidden(true)
        }.padding(.horizontal, 24).padding(.top, max(40, geometry.safeAreaInsets.top + 24)).padding(.bottom, 164)
      }
    }
  }
}

private struct OnboardingRadiusMap: UIViewRepresentable {
  @ObservedObject var model: OnboardingModel
  let coordinate: CLLocationCoordinate2D
  func makeUIView(context: Context) -> OnboardingMapCanvas {
    let view = OnboardingMapCanvas()
    view.radiusChanged = { value, settled in
      model.adjustingRadius = !settled; model.radius = value
      if settled { model.changed() }
    }
    return view
  }
  func updateUIView(_ view: OnboardingMapCanvas, context: Context) {
    view.update(coordinate: coordinate, radius: model.radius, adjustingRadius: model.adjustingRadius)
  }
}
