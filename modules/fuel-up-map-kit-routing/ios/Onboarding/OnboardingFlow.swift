import SwiftUI

@available(iOS 16.0, *)
struct OnboardingFlow: View {
  @ObservedObject var model: OnboardingModel

  var body: some View {
    ZStack(alignment: .bottom) {
      OnboardingMapBackdrop(presentation: model.mapPresentation, onMapReady: { model.emit?(["type": "mapReady"]) })
        .ignoresSafeArea()
      OnboardingPager(model: model)
        .allowsHitTesting(!model.completing)
        .ignoresSafeArea(.container, edges: .vertical)
      OnboardingFooter(model: model)
        .background {
          // Welcome already blurs beneath these controls. A second backdrop
          // there made its gradual transition become an opaque-looking band.
          PureProgressiveBlur(radius: model.step <= 1 ? 8 : 16, direction: .bottom)
              .padding(.top, -40)
              .ignoresSafeArea(.container, edges: .bottom)
              .allowsHitTesting(false)
              .opacity(model.step == 0 ? 0 : 1)
        }
        .background {
          GeometryReader { geometry in
            Color.clear.preference(key: OnboardingFooterHeightKey.self, value: geometry.size.height)
          }
        }
        .onPreferenceChange(OnboardingFooterHeightKey.self) { height in
          if height > 0 && abs(model.footerHeight - height) > 0.5 { model.footerHeight = height }
        }
    }
      .onChange(of: model.step) { step in
        if step != 3 {
          UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
          model.searchFocused = false
        }
        model.changed()
      }
      .onChange(of: model.locationReady) { ready in
        // Wait for a usable location so the next pages can load nearby choices.
        // Later GPS updates must not advance a user who swiped back.
        if ready && model.step == 1 { model.selectStep(2) }
      }
      .tint(.blue)
      .alert("Location Access Is Off", isPresented: $model.showLocationSettingsAlert) {
        Button("Cancel", role: .cancel) {}
        Button("Settings") { model.openLocationSettings() }
      } message: {
        Text("Allow location access in Settings to find gas stations near you.")
      }
  }
}

struct OnboardingPageControl: UIViewRepresentable {
  @Binding var selection: Int
  let count: Int
  func makeCoordinator() -> Coordinator { Coordinator(self) }
  func makeUIView(context: Context) -> UIPageControl {
    let control = UIPageControl()
    control.numberOfPages = count
    control.currentPageIndicatorTintColor = .systemBlue
    control.pageIndicatorTintColor = .tertiaryLabel
    control.addTarget(context.coordinator, action: #selector(Coordinator.changed(_:)), for: .valueChanged)
    return control
  }
  func updateUIView(_ view: UIPageControl, context: Context) {
    context.coordinator.parent = self
    view.currentPage = selection
    view.accessibilityLabel = NSLocalizedString("Setup pages", comment: "")
    view.accessibilityValue = "\(selection + 1) of \(count)"
  }
  final class Coordinator: NSObject {
    var parent: OnboardingPageControl
    init(_ parent: OnboardingPageControl) { self.parent = parent }
    @objc func changed(_ sender: UIPageControl) {
      withAnimation(UIAccessibility.isReduceMotionEnabled ? nil : .easeInOut(duration: 0.3)) {
        parent.selection = sender.currentPage
        sender.currentPage = parent.selection
      }
    }
  }
}
