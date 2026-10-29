import ExpoModulesCore
import MetalKit
import UIKit

/// Native decorative surface. Animation never crosses the React Native bridge.
final class SuperSaverMetalView: ExpoView, MTKViewDelegate {
  var isDark = false { didSet { refreshAppearance() } }
  var wordmark = false { didSet { refreshAppearance(); setNeedsLayout() } }
  var active = true { didSet { updatePlayback() } }
  private var metalView: MTKView?
  private var pipeline: MTLRenderPipelineState?
  private var commandQueue: MTLCommandQueue?
  private var observers: [NSObjectProtocol] = []
  private var elapsed: CFTimeInterval = 0
  private var resumedAt: CFTimeInterval?
  private let inFlight = DispatchSemaphore(value: 2)
  private var reduceMotion: Bool { UIAccessibility.isReduceMotionEnabled }
  private var foreground: Bool { UIApplication.shared.applicationState == .active }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    isUserInteractionEnabled = false
    accessibilityElementsHidden = true
    refreshAppearance()
    guard let device = MTLCreateSystemDefaultDevice() else { return }
    let surface = MTKView(frame: .zero, device: device)
    surface.isPaused = true
    surface.enableSetNeedsDisplay = false
    surface.autoResizeDrawable = false
    surface.colorPixelFormat = .bgra8Unorm
    surface.framebufferOnly = true
    surface.preferredFramesPerSecond = 30
    surface.isUserInteractionEnabled = false
    surface.delegate = self
    surface.isOpaque = true
    metalView = surface
    addSubview(surface)
    for name in [UIApplication.didBecomeActiveNotification, UIApplication.willResignActiveNotification,
                 UIAccessibility.reduceMotionStatusDidChangeNotification] {
      observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] notification in
        if notification.name == UIApplication.willResignActiveNotification {
          self?.pause()
        } else {
          self?.updatePlayback()
        }
      })
    }
    // Runtime compilation runs off the main thread; the static fill is visible meanwhile.
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      do {
        let library = try device.makeLibrary(source: SuperSaverMetalShader.source, options: nil)
        let descriptor = MTLRenderPipelineDescriptor()
        descriptor.vertexFunction = library.makeFunction(name: "saverVertex")
        descriptor.fragmentFunction = library.makeFunction(name: "saverFragment")
        descriptor.colorAttachments[0].pixelFormat = .bgra8Unorm
        let pipeline = try device.makeRenderPipelineState(descriptor: descriptor)
        let queue = device.makeCommandQueue()
        DispatchQueue.main.async { [weak self] in
          self?.pipeline = pipeline
          self?.commandQueue = queue
          self?.updatePlayback()
        }
      } catch {
        // Keep the opaque, theme-aware fill if this device cannot create a pipeline.
        NSLog("Super Saver Metal pipeline unavailable: %@", String(describing: error))
        DispatchQueue.main.async { [weak self] in self?.metalView?.isHidden = true }
      }
    }
  }

  deinit { observers.forEach(NotificationCenter.default.removeObserver) }

  override func layoutSubviews() {
    super.layoutSubviews()
    guard let surface = metalView, bounds.width > 0, bounds.height > 0 else { return }
    surface.frame = bounds
    // Smooth broad fields need no full-screen retina buffer. Keep the logo crisp.
    let scale = wordmark ? min(traitCollection.displayScale, 3) : min(1, 480 / bounds.width)
    surface.drawableSize = CGSize(width: max(1, bounds.width * scale), height: max(1, bounds.height * scale))
    if surface.isPaused && foreground { surface.draw() }
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    updatePlayback()
  }

  private func refreshAppearance() {
    backgroundColor = wordmark ? UIColor(red: 1, green: 0.45, blue: 0.015, alpha: 1)
      : isDark ? UIColor(white: 0.022, alpha: 1) : UIColor(red: 0.962, green: 0.956, blue: 0.946, alpha: 1)
    metalView?.clearColor = MTLClearColorMake(isDark ? 0.022 : 0.962, isDark ? 0.021 : 0.956, isDark ? 0.020 : 0.946, 1)
    if metalView?.isPaused == true && foreground { metalView?.draw() }
  }

  private func pause() {
    if let start = resumedAt { elapsed += CACurrentMediaTime() - start }
    resumedAt = nil
    metalView?.isPaused = true
  }

  private func updatePlayback() {
    guard window != nil, foreground, active, pipeline != nil else { pause(); return }
    if reduceMotion {
      pause()
      metalView?.draw()
    } else {
      if resumedAt == nil { resumedAt = CACurrentMediaTime() }
      metalView?.isPaused = false
    }
  }

  func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

  func draw(in view: MTKView) {
    guard foreground, let pipeline, let commandQueue,
          inFlight.wait(timeout: .now()) == .success else { return }
    guard let drawable = view.currentDrawable, let descriptor = view.currentRenderPassDescriptor,
          let command = commandQueue.makeCommandBuffer(),
          let encoder = command.makeRenderCommandEncoder(descriptor: descriptor) else {
      inFlight.signal()
      return
    }
    let phase = elapsed + (resumedAt.map { CACurrentMediaTime() - $0 } ?? 0)
    var uniforms = SIMD4<Float>(reduceMotion ? 0 : Float(phase.truncatingRemainder(dividingBy: 80)),
                                isDark ? 1 : 0, wordmark ? 1 : 0, Float(bounds.width / max(bounds.height, 1)))
    encoder.setRenderPipelineState(pipeline)
    encoder.setFragmentBytes(&uniforms, length: MemoryLayout<SIMD4<Float>>.stride, index: 0)
    encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
    encoder.endEncoding()
    let semaphore = inFlight
    command.addCompletedHandler { _ in semaphore.signal() }
    command.present(drawable)
    command.commit()
  }
}
