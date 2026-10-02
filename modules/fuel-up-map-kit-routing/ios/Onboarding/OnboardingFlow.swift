import SwiftUI

@available(iOS 16.0, *)
struct OnboardingFlow: View {
  @ObservedObject var model: OnboardingModel
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var footerHeight: CGFloat = 196
  var body: some View {
    ZStack {
      TabView(selection: $model.step) {
        OnboardingWelcomePage().tag(0)
        OnboardingLocationPage(model: model, bottomInset: max(220, footerHeight + 24)).tag(1)
        OnboardingRadiusPage(model: model).tag(2)
        OnboardingFuelPage(model: model).padding(.top, 24).padding(.bottom, 126).tag(3)
        OnboardingBrandsPage(model: model).padding(.top, 16).padding(.bottom, model.searchFocused ? 0 : 126).tag(4)
      }
      .tabViewStyle(.page(indexDisplayMode: .never))
      .ignoresSafeArea(.container, edges: .vertical)
      .onChange(of: model.step) { step in
        if step != 4 {
          UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
          model.searchFocused = false
        }
        model.changed()
      }
      VStack {
        Spacer()
        if !model.searchFocused {
        VStack(spacing: 12) {
          if model.step == 1 {
            Button { model.skipLocation() } label: {
              Text("Not now").frame(minWidth: 88, minHeight: 44)
            }
              .accessibilityIdentifier("onboarding-skip-location")
          }
          OnboardingPageControl(selection: $model.step, count: 5)
            .frame(width: 130, height: 28)
          OnboardingPrimaryButton(title: model.step == 1 ? (model.locationBlocked ? "Open Settings" : "Use my location") : model.step == 4 ? "Find gas" : "Continue") {
            if model.step == 1 { model.advanceLocation() }
            else if model.step == 4 { model.finish() }
            else { model.changed(); move(to: model.step + 1) }
          }.disabled(model.completing)
        }.padding(.horizontal, 24).padding(.bottom, 16)
          .background(GeometryReader { geometry in
            Color.clear.preference(key: OnboardingFooterHeight.self, value: geometry.size.height)
          })
        }
      }
    }.tint(.blue).background(Color(uiColor: .systemGroupedBackground))
      .onPreferenceChange(OnboardingFooterHeight.self) { footerHeight = $0 }
  }
  private func move(to step: Int) {
    withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.3)) { model.step = step }
  }
}

private struct OnboardingFooterHeight: PreferenceKey {
  static var defaultValue: CGFloat = 196
  static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
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
    view.accessibilityLabel = "Setup pages"
    view.accessibilityValue = "\(selection + 1) of \(count)"
  }
  final class Coordinator: NSObject {
    var parent: OnboardingPageControl
    init(_ parent: OnboardingPageControl) { self.parent = parent }
    @objc func changed(_ sender: UIPageControl) {
      withAnimation(UIAccessibility.isReduceMotionEnabled ? nil : .easeInOut(duration: 0.3)) {
        parent.selection = sender.currentPage
      }
    }
  }
}
