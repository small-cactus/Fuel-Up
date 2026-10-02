import SwiftUI

@available(iOS 16.0, *)
struct OnboardingFlow: View {
  @ObservedObject var model: OnboardingModel
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  var body: some View {
    ZStack {
      TabView(selection: $model.step) {
        OnboardingWelcomePage().tag(0)
        OnboardingLocationPage(model: model).tag(1)
        OnboardingRadiusPage(model: model).tag(2)
        OnboardingFuelPage(model: model).padding(.top, 68).padding(.bottom, 126).tag(3)
        OnboardingBrandsPage(model: model).padding(.top, 60).padding(.bottom, model.searchFocused ? 0 : 126).tag(4)
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
        HStack {
          if model.step > 0 {
            Button { move(to: model.step - 1) } label: {
              Image(systemName: "chevron.left").font(.headline).frame(width: 44, height: 44)
            }.modifier(OnboardingBackStyle()).accessibilityLabel("Previous page")
          }
          Spacer()
        }.padding(.horizontal, 20).padding(.top, 8)
        Spacer()
        if !model.searchFocused {
        VStack(spacing: 12) {
          if model.step == 1 {
            Button("Not now") { model.skipLocation() }.frame(minHeight: 44)
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
        }
      }
    }.tint(.blue).background(Color(uiColor: .systemGroupedBackground))
  }
  private func move(to step: Int) {
    withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.3)) { model.step = step }
  }
}

private struct OnboardingBackStyle: ViewModifier {
  func body(content: Content) -> some View {
    if #available(iOS 26.0, *) { content.buttonStyle(.glass).buttonBorderShape(.circle) }
    else { content.buttonStyle(.bordered).buttonBorderShape(.capsule) }
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
