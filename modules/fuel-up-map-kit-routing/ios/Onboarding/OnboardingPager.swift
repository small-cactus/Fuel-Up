import SwiftUI
import UIKit

// Keep every page (and its map/scroll state) alive. UIKit owns both button-driven
// and interactive sliding; changing permission state never rebuilds the page list.
@available(iOS 16.0, *)
struct OnboardingPager: UIViewControllerRepresentable {
  @ObservedObject var model: OnboardingModel

  func makeUIViewController(context: Context) -> OnboardingPagerController {
    OnboardingPagerController(model: model)
  }
  func updateUIViewController(_ controller: OnboardingPagerController, context: Context) {
    controller.update()
  }
}

@available(iOS 16.0, *)
final class OnboardingPagerController: UIPageViewController, UIPageViewControllerDataSource, UIPageViewControllerDelegate {
  private let model: OnboardingModel
  private var pages: [UIHostingController<OnboardingPage>] = []
  private var transitioning = false
  private var gestureStartStep = 0
  private var locationReady: Bool

  init(model: OnboardingModel) {
    self.model = model
    locationReady = model.locationReady
    super.init(transitionStyle: .scroll, navigationOrientation: .horizontal)
    pages = (0..<4).map { index in
      let host = UIHostingController(rootView: OnboardingPage(index: index, model: model))
      host.view.backgroundColor = .clear
      return host
    }
    dataSource = self
    delegate = self
    setViewControllers([pages[model.step]], direction: .forward, animated: false)
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  func update() { showRequestedPage() }

  private func index(of controller: UIViewController?) -> Int? {
    pages.firstIndex { $0 === controller }
  }
  private func showRequestedPage() {
    guard !transitioning, let current = index(of: viewControllers?.first) else { return }
    if locationReady != model.locationReady {
      locationReady = model.locationReady
      // The scroll pager caches adjacent pages, including a blocked forward swipe.
      // Refresh that cache once permission changes, retaining the same page views.
      dataSource = nil
      setViewControllers([pages[current]], direction: .forward, animated: false)
      dataSource = self
    }
    let target = model.locationReady ? model.step : min(model.step, 1)
    guard target != current else { return }
    transitioning = true
    setViewControllers([pages[target]], direction: target > current ? .forward : .reverse,
                       animated: !UIAccessibility.isReduceMotionEnabled) { [weak self] _ in
      guard let self else { return }
      self.transitioning = false
      // Serialize rapid taps and changes in permission during a gesture.
      self.showRequestedPage()
    }
  }

  func pageViewController(_ pageViewController: UIPageViewController,
                          viewControllerBefore viewController: UIViewController) -> UIViewController? {
    guard let current = index(of: viewController), current > 0 else { return nil }
    return pages[current - 1]
  }
  func pageViewController(_ pageViewController: UIPageViewController,
                          viewControllerAfter viewController: UIViewController) -> UIViewController? {
    guard let current = index(of: viewController), current < (model.locationReady ? 3 : 1) else { return nil }
    return pages[current + 1]
  }
  func pageViewController(_ pageViewController: UIPageViewController,
                          willTransitionTo pendingViewControllers: [UIViewController]) {
    transitioning = true
    gestureStartStep = model.step
  }
  func pageViewController(_ pageViewController: UIPageViewController, didFinishAnimating finished: Bool,
                          previousViewControllers: [UIViewController], transitionCompleted completed: Bool) {
    transitioning = false
    if completed, model.step == gestureStartStep, let visible = index(of: viewControllers?.first) {
      model.selectStep(visible)
    }
    showRequestedPage()
  }
}

@available(iOS 16.0, *)
private struct OnboardingPage: View {
  let index: Int
  @ObservedObject var model: OnboardingModel

  var body: some View {
    page
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .modifier(OnboardingBottomBar(model: model, overlaysMap: index == 0))
      .background(Color(uiColor: .systemGroupedBackground))
  }

  @ViewBuilder private var page: some View {
    switch index {
    case 0: OnboardingWelcomePage()
    case 1: OnboardingLocationPage(model: model)
    case 2: OnboardingFuelPage(model: model).padding(.top, 24)
    default: OnboardingBrandsPage(model: model)
    }
  }
}
