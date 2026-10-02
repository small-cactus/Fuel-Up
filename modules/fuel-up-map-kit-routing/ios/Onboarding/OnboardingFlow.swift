import SwiftUI

@available(iOS 16.0, *)
struct OnboardingFlow: View {
  @ObservedObject var model: OnboardingModel

  var body: some View {
    ZStack(alignment: .bottom) {
      OnboardingPager(model: model)
        .ignoresSafeArea(.container, edges: .vertical)
      OnboardingFooter(model: model)
        .background {
          // A continuous native-material fade protects the stationary controls
          // while the pages and their scrolling content move underneath.
          Rectangle().fill(.ultraThinMaterial)
            .mask(LinearGradient(stops: [
              .init(color: .clear, location: 0),
              .init(color: .black.opacity(0.65), location: 0.35),
              .init(color: .black, location: 0.65)
            ], startPoint: .top, endPoint: .bottom))
            .padding(.top, -40)
            .ignoresSafeArea(.container, edges: .bottom)
            .allowsHitTesting(false)
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
