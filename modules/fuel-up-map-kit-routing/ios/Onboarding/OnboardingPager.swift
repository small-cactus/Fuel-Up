import SwiftUI
import UIKit

// Keep every page and its scroll state alive. UIKit owns both button-driven
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
  private var scrollObservation: NSKeyValueObservation?
  private var transitionPages: (from: Int, to: Int)?
  private var gestureStartStep = 0
  private var locationReady: Bool

  init(model: OnboardingModel) {
    self.model = model
    locationReady = model.locationReady
    model.mapPresentation.position = CGFloat(model.step)
    super.init(transitionStyle: .scroll, navigationOrientation: .horizontal)
    pages = (0..<4).map { index in
      let host = OnboardingPageHost(rootView: OnboardingPage(index: index, model: model))
      return host
    }
    dataSource = self
    delegate = self
    setViewControllers([pages[model.step]], direction: .forward, animated: false)
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .clear
    // Observe UIKit's native paging position without taking over its delegate.
    // This also follows cancelled swipes and button/page-dot transitions.
    if let scroll = view.subviews.compactMap({ $0 as? UIScrollView }).first {
      scrollObservation = scroll.observe(\.contentOffset, options: [.new]) { [weak self] scroll, _ in
        guard let self, let pages = self.transitionPages, scroll.bounds.width > 0 else { return }
        let fraction = min(1, abs(scroll.contentOffset.x - scroll.bounds.width) / scroll.bounds.width)
        self.model.mapPresentation.position = CGFloat(pages.from) + CGFloat(pages.to - pages.from) * fraction
      }
    }
  }

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
    transitionPages = (current, target)
    setViewControllers([pages[target]], direction: target > current ? .forward : .reverse,
                       animated: !UIAccessibility.isReduceMotionEnabled) { [weak self] _ in
      guard let self else { return }
      self.transitioning = false
      self.transitionPages = nil
      self.model.mapPresentation.position = CGFloat(target)
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
    if let target = index(of: pendingViewControllers.first) {
      transitionPages = (gestureStartStep, target)
    }
  }
  func pageViewController(_ pageViewController: UIPageViewController, didFinishAnimating finished: Bool,
                          previousViewControllers: [UIViewController], transitionCompleted completed: Bool) {
    transitioning = false
    transitionPages = nil
    if let visible = index(of: viewControllers?.first) {
      model.mapPresentation.position = CGFloat(visible)
    }
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
      .background {
        if index >= 2 {
          PureProgressiveBlur(direction: .uniform)
            .ignoresSafeArea().allowsHitTesting(false).accessibilityHidden(true)
        }
      }
  }

  @ViewBuilder private var page: some View {
    switch index {
    case 0: OnboardingWelcomePage()
    case 1: OnboardingLocationPage(model: model)
    case 2: OnboardingFuelPage(model: model)
    default: OnboardingBrandsPage(model: model)
    }
  }
}

// Page hosts contain only content and blur; MapKit stays in the shared backdrop.
private final class OnboardingPageHost: UIHostingController<OnboardingPage> {
  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .clear
  }
}
