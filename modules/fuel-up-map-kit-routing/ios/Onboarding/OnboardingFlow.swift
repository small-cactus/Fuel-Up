import SwiftUI

@available(iOS 16.0, *)
struct OnboardingFlow: View {
  @ObservedObject var model: OnboardingModel

  var body: some View {
    OnboardingPager(model: model)
      .ignoresSafeArea(.container, edges: .vertical)
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
      .background(Color(uiColor: .systemGroupedBackground))
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
        sender.currentPage = parent.selection
      }
    }
  }
}
