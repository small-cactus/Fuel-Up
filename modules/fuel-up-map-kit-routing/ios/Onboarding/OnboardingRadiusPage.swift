import SwiftUI
import MapKit

struct OnboardingRadiusPage: View {
  @ObservedObject var model: OnboardingModel
  @State private var showsHint = true
  @Environment(\.dynamicTypeSize) private var typeSize
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    GeometryReader { geometry in
      ZStack {
        if let coordinate = model.coordinate {
          OnboardingRadiusMap(model: model, coordinate: coordinate).ignoresSafeArea()
        }
        VStack(alignment: .leading, spacing: 12) {
          VStack(alignment: .leading, spacing: 10) {
            if typeSize.isAccessibilitySize {
              Text("Search radius").font(.headline).fixedSize(horizontal: false, vertical: true)
            } else {
              OnboardingHeading(title: "Your search radius", subtitle: "How far would you go for a better price?")
            }
          }.padding(20).modifier(OnboardingGlass())
          Spacer()
          Text("\(Int(model.radius.rounded())) miles")
            .font(.system(.title, design: .rounded).bold()).monospacedDigit()
            .padding(.horizontal, 20).padding(.vertical, 12).modifier(OnboardingGlass())
            .accessibilityLabel("Search radius, \(Int(model.radius.rounded())) miles")
            .accessibilityIdentifier("onboarding-radius-value")
        }
        .padding(.horizontal, 24).padding(.top, max(24, geometry.safeAreaInsets.top + 16))
        .padding(.bottom, 150).allowsHitTesting(false)
        if showsHint {
          OnboardingPinchHint().transition(.opacity).allowsHitTesting(false)
        }
      }
      .onChange(of: model.adjustingRadius) { adjusting in
        if adjusting { dismissHint() }
      }
      .onChange(of: model.radius) { _ in dismissHint() }
    }
  }
  private func dismissHint() {
    guard showsHint else { return }
    withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) { showsHint = false }
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
