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
  private var gestureStartStep = 0
  private var locationReady: Bool

  init(model: OnboardingModel) {
    self.model = model
    locationReady = model.locationReady
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
    // Read each page's real origin rather than estimating transition progress.
    // This covers edge bounce, cancellation, and nonadjacent page-dot jumps.
    if let scroll = view.subviews.compactMap({ $0 as? UIScrollView }).first {
      scrollObservation = scroll.observe(\.contentOffset, options: [.new]) { [weak self] _, _ in
        self?.updateMapOffsets()
      }
    }
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    updateMapOffsets()
  }

  private func updateMapOffsets() {
    guard isViewLoaded, view.bounds.width > 0 else { return }
    model.mapPresentation.pageOffsets = pages.map { page in
      guard let pageView = page.viewIfLoaded, pageView.isDescendant(of: view) else { return nil }
      return pageView.convert(pageView.bounds, to: view).minX / view.bounds.width
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
    setViewControllers([pages[target]], direction: target > current ? .forward : .reverse,
                       animated: !UIAccessibility.isReduceMotionEnabled) { [weak self] _ in
      guard let self else { return }
      self.transitioning = false
      self.updateMapOffsets()
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
    updateMapOffsets()
  }
  func pageViewController(_ pageViewController: UIPageViewController, didFinishAnimating finished: Bool,
                          previousViewControllers: [UIViewController], transitionCompleted completed: Bool) {
    transitioning = false
    updateMapOffsets()
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

// Map renderers remain mounted in the backdrop and track these exact page frames.
private final class OnboardingPageHost: UIHostingController<OnboardingPage> {
  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .clear
  }
}
