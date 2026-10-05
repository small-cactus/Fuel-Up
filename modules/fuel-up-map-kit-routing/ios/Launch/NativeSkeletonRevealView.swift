import ExpoModulesCore
import SwiftUI

/// A one-shot handoff. Snapshots let the Metal pass include UIKit-backed glass,
/// charts and text without keeping a GPU surface alive after loading finishes.
final class NativeSkeletonRevealView: ExpoView {
  private var slots: [UIView] = []
  private var loading = true
  private var hasShownSkeleton = false
  private var scheduled = false
  private var overlay: UIHostingController<SkeletonRevealArtwork>?
  private var model: SkeletonRevealModel?
  private var link: CADisplayLink?
  private var startedAt: CFTimeInterval?

  func setLoading(_ value: Bool) {
    guard loading != value else { return }
    loading = value
    scheduleUpdate()
  }

  override func mountChildComponentView(_ childComponentView: UIView, index: Int) {
    super.mountChildComponentView(childComponentView, index: index)
    slots.insert(childComponentView, at: min(index, slots.count))
    scheduleUpdate()
  }

  override func unmountChildComponentView(_ childComponentView: UIView, index: Int) {
    slots.removeAll { $0 === childComponentView }
    super.unmountChildComponentView(childComponentView, index: index)
    finish()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    if let overlay, overlay.view.bounds.size != bounds.size { finish() }
    scheduleUpdate()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil { finish(); hasShownSkeleton = false }
    else { scheduleUpdate() }
  }

  private func scheduleUpdate() {
    guard !scheduled else { return }
    scheduled = true
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.scheduled = false
      self.updateContent()
    }
  }

  private func updateContent() {
    guard slots.count == 2, window != nil, bounds.width > 0, bounds.height > 0 else { return }
    if loading {
      finish()
      slots[0].isHidden = false
      slots[1].isHidden = true
      hasShownSkeleton = true
      return
    }
    guard hasShownSkeleton, overlay == nil else {
      if overlay == nil { slots[0].isHidden = true; slots[1].isHidden = false }
      return
    }
    // Empty/error results must release the placeholder too, even if the target
    // deliberately has no height. Never leave a skeleton waiting for a result.
    guard slots[1].bounds.height > 0 else { hasShownSkeleton = false; finish(); return }
    hasShownSkeleton = false
    let visible = convert(bounds, to: window).intersects(window!.bounds)
    guard visible, bounds.height <= 1600 else { finish(); return }
    slots.forEach { $0.isHidden = false; $0.layoutIfNeeded() }
    let from = snapshot(slots[0])
    let to = snapshot(slots[1])
    let state = SkeletonRevealModel(from: from, to: to, reduceMotion: UIAccessibility.isReduceMotionEnabled)
    let controller = UIHostingController(rootView: SkeletonRevealArtwork(model: state))
    controller.safeAreaRegions = []
    controller.view.backgroundColor = .clear
    controller.view.isUserInteractionEnabled = false
    controller.view.accessibilityElementsHidden = true
    controller.view.frame = bounds
    var responder: UIResponder? = self
    while let next = responder?.next {
      if let parent = next as? UIViewController {
        parent.addChild(controller); break
      }
      responder = next
    }
    addSubview(controller.view)
    controller.didMove(toParent: controller.parent)
    slots.forEach { $0.isHidden = true }
    model = state
    overlay = controller
    startedAt = nil
    let timer = CADisplayLink(target: self, selector: #selector(tick))
    link = timer
    timer.add(to: .main, forMode: .common)
  }

  private func snapshot(_ view: UIView) -> UIImage {
    let format = UIGraphicsImageRendererFormat()
    format.scale = window?.screen.scale ?? 3
    return UIGraphicsImageRenderer(bounds: view.bounds, format: format).image { _ in
      view.drawHierarchy(in: view.bounds, afterScreenUpdates: true)
    }
  }

  @objc private func tick() {
    guard let model else { finish(); return }
    guard let startedAt else { self.startedAt = CACurrentMediaTime(); return }
    if model.progress >= 1 { finish(); return }
    model.progress = min(1, (CACurrentMediaTime() - startedAt) / (model.reduceMotion ? 0.18 : 1.05))
  }

  private func finish() {
    link?.invalidate(); link = nil; startedAt = nil
    overlay?.willMove(toParent: nil)
    overlay?.view.removeFromSuperview()
    overlay?.removeFromParent()
    overlay = nil; model = nil
    if slots.count == 2 { slots[0].isHidden = !loading; slots[1].isHidden = loading }
  }
}

private final class SkeletonRevealModel: ObservableObject {
  let from: UIImage
  let to: UIImage
  let reduceMotion: Bool
  @Published var progress = 0.0
  init(from: UIImage, to: UIImage, reduceMotion: Bool) {
    self.from = from; self.to = to; self.reduceMotion = reduceMotion
  }
}

private struct SkeletonRevealArtwork: View {
  @ObservedObject var model: SkeletonRevealModel
  var body: some View {
    GeometryReader { geometry in
      let eased = model.progress * model.progress * (3 - 2 * model.progress)
      let height = model.from.size.height + (model.to.size.height - model.from.size.height) * eased
      ZStack(alignment: .topLeading) {
        Image(uiImage: model.from).resizable()
          .frame(width: geometry.size.width, height: height).opacity(1 - model.progress)
        Image(uiImage: model.to).resizable()
          .frame(width: geometry.size.width, height: height).opacity(model.progress)
      }
      .modifier(SkeletonLiquidEffect(progress: model.progress, reduceMotion: model.reduceMotion))
    }.ignoresSafeArea().accessibilityHidden(true)
  }
}

/// Composite the two silhouettes before deforming/softening them. The native
/// glass stays outside this surface, and at rest the shader is fully detached.
struct SkeletonLiquidEffect: ViewModifier, Animatable {
  var progress: Double
  var reduceMotion: Bool
  var animatableData: Double { get { progress } set { progress = newValue } }
  @ViewBuilder
  func body(content: Content) -> some View {
    if reduceMotion || progress <= 0 || progress >= 1 {
      content
    } else {
      let radius = 15 * pow(sin(.pi * progress), 1.3)
      content.drawingGroup().visualEffect { view, geometry in
        view.distortionEffect(ShaderLibrary.default.fuelUpSkeletonFlow(
          .float2(geometry.size), .float(progress)), maxSampleOffset: CGSize(width: 10, height: 6))
          // SwiftUI's native Gaussian uses the full-resolution Metal surface
          // without the coarse sampling pattern of a small custom tap kernel.
          .blur(radius: radius)
          .colorEffect(ShaderLibrary.default.fuelUpSkeletonInk(.float(progress)))
      }
    }
  }
}

/// SwiftUI lists use the same paired-image math with their actual row layers.
struct SkeletonLiquidSwap<Placeholder: View, Loaded: View>: View {
  let loading: Bool
  let placeholder: Placeholder
  let loaded: Loaded
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var startedAt: Date?
  @State private var cleanup: Task<Void, Never>?

  init(loading: Bool, @ViewBuilder placeholder: () -> Placeholder, @ViewBuilder content: () -> Loaded) {
    self.loading = loading; self.placeholder = placeholder(); self.loaded = content()
  }

  var body: some View {
    Group {
      if loading {
        placeholder
      } else if let startedAt {
        TimelineView(.animation) { timeline in
          let progress = min(1, max(0, timeline.date.timeIntervalSince(startedAt) / (reduceMotion ? 0.18 : 1.05)))
          let blend = progress * progress * (3 - 2 * progress)
          ZStack(alignment: .topLeading) {
            placeholder.opacity(1 - blend).accessibilityHidden(true)
            loaded.opacity(blend)
          }
          .modifier(SkeletonLiquidEffect(progress: progress, reduceMotion: reduceMotion))
          // The opacity, distortion and blur must use this same frame, rather
          // than independent implicit animations on newly inserted row trees.
          .transaction { $0.animation = nil }
        }
      } else {
        loaded
      }
    }
    .onChange(of: loading) { _, nowLoading in
      cleanup?.cancel()
      if nowLoading {
        startedAt = nil
      } else {
        startedAt = .now
        cleanup = Task { @MainActor in
          try? await Task.sleep(for: .seconds(reduceMotion ? 0.22 : 1.1))
          guard !Task.isCancelled else { return }
          startedAt = nil
        }
      }
    }
    .onDisappear { cleanup?.cancel(); startedAt = nil }
  }
}
