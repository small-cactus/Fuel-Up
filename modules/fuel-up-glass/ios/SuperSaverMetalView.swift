import ExpoModulesCore
import MetalKit
import UIKit

/// Native decorative surface. Animation never crosses the React Native bridge.
final class SuperSaverMetalView: ExpoView, MTKViewDelegate {
  var isDark = false { didSet { refreshAppearance() } }
  var wordmark = false { didSet { refreshAppearance(); setNeedsLayout() } }
  var effect = 0 { didSet { refreshAppearance(); setNeedsLayout() } }
  var hdrBrand = false
  var glyphText = "" { didSet { setNeedsLayout() } }
  var glyphFontSize: Double = 40 { didSet { setNeedsLayout() } }
  var active = true { didSet { updatePlayback() } }
  private var metalView: MTKView?
  private var pipeline: MTLRenderPipelineState?
  private var commandQueue: MTLCommandQueue?
  private var observers: [NSObjectProtocol] = []
  private var elapsed: CFTimeInterval = 0
  private var resumedAt: CFTimeInterval?
  private let glyphClip = CALayer()
  private var staticGeometry = ""
  private let inFlight = DispatchSemaphore(value: 2)
  private var reduceMotion: Bool { UIAccessibility.isReduceMotionEnabled }
  private var foreground: Bool { UIApplication.shared.applicationState == .active }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    SaverLightScene.shared.views.add(self)
    isOpaque = false
    layer.isOpaque = false
    isUserInteractionEnabled = false
    accessibilityElementsHidden = true
    refreshAppearance()
    guard let device = MTLCreateSystemDefaultDevice() else { return }
    let surface = MTKView(frame: .zero, device: device)
    surface.isPaused = true
    surface.enableSetNeedsDisplay = false
    surface.autoResizeDrawable = false
    surface.colorPixelFormat = .rgba16Float
    if let displayLayer = surface.layer as? CAMetalLayer {
      displayLayer.colorspace = CGColorSpace(name: CGColorSpace.extendedLinearDisplayP3)
      if #available(iOS 16.0, *) { displayLayer.wantsExtendedDynamicRangeContent = true }
    }
    surface.framebufferOnly = true
    surface.preferredFramesPerSecond = 30
    surface.isUserInteractionEnabled = false
    surface.delegate = self
    surface.isOpaque = false
    surface.backgroundColor = .clear
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
        descriptor.colorAttachments[0].pixelFormat = .rgba16Float
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

  fileprivate var needsGlyphClip: Bool { layer.mask == nil }

  fileprivate func installGlyphClip(_ image: CGImage) {
    glyphClip.contents = image
    glyphClip.contentsGravity = .resize
    glyphClip.frame = bounds
    layer.mask = glyphClip
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    guard let surface = metalView, bounds.width > 0, bounds.height > 0 else { return }
    surface.frame = bounds
    glyphClip.frame = bounds
    // Smooth broad fields need no full-screen retina buffer. Keep the logo crisp.
    let scale = wordmark || effect > 0 ? min(traitCollection.displayScale, 3) : min(1, 360 / bounds.width)
    surface.drawableSize = CGSize(width: max(1, bounds.width * scale), height: max(1, bounds.height * scale))
    if surface.isPaused && foreground { surface.draw() }
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    updatePlayback()
  }

  private func refreshAppearance() {
    if effect == 2 {
      backgroundColor = .clear
      metalView?.clearColor = MTLClearColorMake(0, 0, 0, 0)
      return
    }
    backgroundColor = wordmark ? UIColor(red: 1, green: 0.45, blue: 0.015, alpha: 1)
      : isDark ? UIColor(red: 0.188, green: 0.192, blue: 0.212, alpha: 1) : UIColor(red: 0.962, green: 0.956, blue: 0.946, alpha: 1)
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
      // Keep layout observations alive, but submit no repeated static frames.
      metalView?.isPaused = false
    } else {
      if resumedAt == nil { resumedAt = CACurrentMediaTime() }
      metalView?.isPaused = false
    }
  }

  func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

  func draw(in view: MTKView) {
    // Current, not potential, headroom: brightness and thermal state can change it.
    var headroom: Float = 1
    if #available(iOS 16.0, *) {
      headroom = Float(max(1, min(window?.screen.currentEDRHeadroom ?? 1, 4)))
    }
    if reduceMotion, let window {
      let geometry = SaverLightScene.shared.geometryKey(window: window) + "|\(isDark)|\(effect)|\(hdrBrand)|\(headroom)"
      if geometry == staticGeometry { return }
      staticGeometry = geometry
    } else { staticGeometry = "" }
    guard foreground, let pipeline, let commandQueue,
          inFlight.wait(timeout: .now()) == .success else { return }
    guard let drawable = view.currentDrawable, let descriptor = view.currentRenderPassDescriptor,
          let command = commandQueue.makeCommandBuffer(),
          let encoder = command.makeRenderCommandEncoder(descriptor: descriptor) else {
      inFlight.signal()
      return
    }
    let phase = CACurrentMediaTime() - SaverLightScene.shared.epoch
    let screen = window?.bounds ?? UIScreen.main.bounds
    let rect = convert(bounds, to: window)
    let scene = SaverLightScene.shared
    guard let device = view.device, let window, let atlas = scene.update(device: device, window: window) else {
      encoder.endEncoding(); inFlight.signal(); return
    }
    let lamp = scene.buttonRect
    let u = screen.width, h = screen.height
    let uniforms: [SIMD4<Float>] = [
      SIMD4<Float>(reduceMotion ? 0 : Float(phase.truncatingRemainder(dividingBy: 80)),
                   isDark ? 1 : 0, Float(effect > 0 ? effect : wordmark ? 1 : 0), Float(screen.width / screen.height)),
      SIMD4<Float>(Float(rect.minX / screen.width), Float(rect.minY / screen.height),
                   Float(rect.width / screen.width), Float(rect.height / screen.height)),
      SIMD4<Float>(Float(lamp.minX/u), Float(lamp.minY/h), Float(lamp.width/u), Float(lamp.height/h)),
      SIMD4<Float>(Float(atlas.width), Float(atlas.height), Float(screen.width * window.screen.scale), Float(screen.height * window.screen.scale)),
      scene.glyphBounds(0, screen: screen), scene.glyphBounds(1, screen: screen),
      SIMD4<Float>(headroom, hdrBrand ? 1 : 0, 0, 0)
    ]
    encoder.setRenderPipelineState(pipeline)
    encoder.setFragmentTexture(atlas, index: 0)
    uniforms.withUnsafeBytes { bytes in
      encoder.setFragmentBytes(bytes.baseAddress!, length: bytes.count, index: 0)
    }
    encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
    encoder.endEncoding()
    let semaphore = inFlight
    command.addCompletedHandler { _ in semaphore.signal() }
    command.present(drawable)
    command.commit()
  }
}


/// Shared glyph normals, height fields and emitter geometry. All surfaces track
/// the actual button rectangle, including while the compact layout scrolls.
private final class SaverLightScene {
  static let shared = SaverLightScene()
  let epoch = CACurrentMediaTime()
  func geometryKey(window: UIWindow) -> String {
    views.allObjects.filter { $0.window === window && $0.active }.map {
      "\($0.effect)|\($0.glyphText)|\($0.glyphFontSize)|\($0.convert($0.bounds,to:window))"
    }.sorted().joined()
  }
  let views = NSHashTable<SuperSaverMetalView>.weakObjects()
  private var atlas: MTLTexture?
  private var glyphImages: [CGImage] = []
  private var signature = ""
  private var glyphRects: [CGRect] = []
  func glyphBounds(_ index: Int, screen: CGRect) -> SIMD4<Float> {
    guard index < glyphRects.count else { return SIMD4<Float>(-2,-2,0,0) }
    let rect = glyphRects[index]
    return SIMD4<Float>(Float(rect.minX/screen.width),Float(rect.minY/screen.height),
                        Float(rect.maxX/screen.width),Float(rect.maxY/screen.height))
  }
  private(set) var buttonRect = CGRect(x: 30, y: 700, width: 315, height: 62)

  func update(device: MTLDevice, window: UIWindow) -> MTLTexture? {
    let surfaces = views.allObjects.filter { $0.window === window && $0.active }
    if let button = surfaces.first(where: { $0.effect == 3 }) {
      buttonRect = button.convert(button.bounds, to: window)
    }
    let letters = surfaces.filter { $0.effect == 2 && !$0.glyphText.isEmpty && $0.bounds.width > 0 }
      .sorted { $0.glyphText < $1.glyphText }
    glyphRects = letters.map { $0.convert($0.bounds, to: window) }
    let screen = window.bounds.size
    let next = "\(screen)" + letters.map { "\($0.glyphText)|\($0.glyphFontSize)|\($0.bounds.size)" }.joined()
    if next == signature, let atlas {
      for (index, view) in letters.prefix(2).enumerated() where view.needsGlyphClip && index < glyphImages.count {
        view.installGlyphClip(glyphImages[index])
      }
      return atlas
    }
    let scale = min(window.screen.scale, 3)
    // Two local glyph tiles stay cached when the screen scrolls. Only the
    // screen-space rectangles change, so scrolling allocates no new atlas.
    let tileWidth = max(1, letters.map { $0.bounds.width }.max() ?? 1)
    let tileHeight = max(1, letters.map { $0.bounds.height }.max() ?? 1)
    let atlasSize = CGSize(width: tileWidth, height: tileHeight * 2)
    let width = max(1, Int(atlasSize.width * scale)), height = max(1, Int(atlasSize.height * scale))
    let format = UIGraphicsImageRendererFormat()
    format.scale = scale; format.opaque = false
    let image = UIGraphicsImageRenderer(size: atlasSize, format: format).image { context in
      for (index, view) in letters.prefix(2).enumerated() {
        let rect = view.bounds
        context.cgContext.saveGState()
        context.cgContext.translateBy(x: 0, y: CGFloat(index) * tileHeight)
        context.cgContext.scaleBy(x: tileWidth / rect.width, y: tileHeight / rect.height)
        let font = UIFont.systemFont(ofSize: view.glyphFontSize, weight: .bold)
        let paragraph = NSMutableParagraphStyle(); paragraph.alignment = .center
        let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: UIColor.white,
          .kern: -1.5, .paragraphStyle: paragraph]
        let textRect = CGRect(x: rect.minX, y: rect.midY - font.lineHeight / 2,
                              width: rect.width, height: font.lineHeight + 2)
        (view.glyphText as NSString).draw(in: textRect, withAttributes: attributes)
        context.cgContext.restoreGState()
      }
    }
    guard let cg = image.cgImage else { return atlas }
    glyphImages = []
    for (index, view) in letters.prefix(2).enumerated() {
      if let clip = cg.cropping(to: CGRect(x: 0, y: CGFloat(index) * tileHeight * scale,
                                           width: tileWidth * scale, height: tileHeight * scale)) {
        glyphImages.append(clip)
        view.installGlyphClip(clip)
      }
    }
    var bytes = [UInt8](repeating: 0, count: width * height * 4)
    let rendered = bytes.withUnsafeMutableBytes { buffer -> Bool in
      guard let context = CGContext(data: buffer.baseAddress, width: width, height: height,
        bitsPerComponent: 8, bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
      context.draw(cg, in: CGRect(x: 0, y: 0, width: width, height: height))
      return true
    }
    guard rendered else { return atlas }
    let descriptor = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .rgba8Unorm,
      width: width, height: height, mipmapped: false)
    descriptor.usage = .shaderRead
    guard let texture = device.makeTexture(descriptor: descriptor) else { return atlas }
    bytes.withUnsafeBytes { buffer in
      texture.replace(region: MTLRegionMake2D(0,0,width,height), mipmapLevel: 0,
                      withBytes: buffer.baseAddress!, bytesPerRow: width * 4)
    }
    atlas = texture; signature = next
    return texture
  }
}
