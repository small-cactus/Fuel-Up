import UIKit

// Keep overlay work after MapKit's gesture/display-link work and in the same
// Core Animation commit. The modern clock observes idle UI updates passively.
final class ClusterLabFrameClock {
  let synchronizesWithCommit: Bool
  private let setContinuous: (Bool) -> Void
  private let invalidate: () -> Void

  init(view: UIView, tick: @escaping (CFTimeInterval) -> Void) {
    if #available(iOS 18.0, *) {
      let link = UIUpdateLink(view: view)
      link.preferredFrameRateRange = CAFrameRateRange(minimum: 60, maximum: 120, preferred: 120)
      link.addAction(to: .beforeCATransactionCommit) { _, info in tick(info.modelTime) }
      link.isEnabled = true
      synchronizesWithCommit = true
      setContinuous = { link.requiresContinuousUpdates = $0 }
      invalidate = { link.isEnabled = false }
    } else {
      let target = LabLegacyFrameTarget(tick: tick)
      let link = CADisplayLink(target: target, selector: #selector(LabLegacyFrameTarget.frame(_:)))
      link.preferredFrameRateRange = CAFrameRateRange(minimum: 60, maximum: 120, preferred: 120)
      link.isPaused = true
      link.add(to: .main, forMode: .common)
      synchronizesWithCommit = false
      setContinuous = { link.isPaused = !$0 }
      invalidate = { link.invalidate() }
    }
  }

  func requestContinuous(_ value: Bool) { setContinuous(value) }
  deinit { invalidate() }
}

private final class LabLegacyFrameTarget: NSObject {
  private let tick: (CFTimeInterval) -> Void
  init(tick: @escaping (CFTimeInterval) -> Void) { self.tick = tick }
  @objc func frame(_ link: CADisplayLink) { tick(link.timestamp) }
}
