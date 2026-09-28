import Foundation

// Brief surface resistance, expressed as a smooth local change of pace.
// The clock never stops or reverses, and catches up before the outward peak,
// preserving the existing rebound amplitude, return timing, and deadline.
struct LabContactCatch {
  static let maximumLag: CGFloat = 6
  let startedAt: Double
  let duration: Double

  init(elapsed: Double, outwardDuration: Double) {
    startedAt = elapsed
    duration = min(0.065, max(0, outwardDuration - elapsed))
  }

  func delay(at elapsed: Double) -> Double {
    guard duration > 0, elapsed > startedAt, elapsed < startedAt + duration else { return 0 }
    let u = (elapsed - startedAt) / duration
    // C2-continuous at entry/exit. Peak lag is at most 14.3 ms; the
    // lowest clock speed is still positive, about 24% of the usual pace.
    let bell = 64 * pow(u * (1 - u), 3)
    return duration * 0.22 * bell
  }

  static func resistedProgress(unresisted: CGFloat, delayed: CGFloat, distance: CGFloat) -> CGFloat {
    guard distance > 0 else { return unresisted }
    let lag = max(0, (unresisted - delayed) * distance)
    // Smoothly saturate rather than hard-clamp: even a very fast arrival only
    // stretches a few points, without a corner in its velocity curve.
    return unresisted - lag / (1 + lag / maximumLag) / distance
  }
}

struct LabVector: Equatable {
  var x: CGFloat = 0
  var y: CGFloat = 0
  static let zero = LabVector()
  var length: CGFloat { hypot(x, y) }
  static func + (a: Self, b: Self) -> Self { .init(x: a.x + b.x, y: a.y + b.y) }
  static func - (a: Self, b: Self) -> Self { .init(x: a.x - b.x, y: a.y - b.y) }
  static func * (a: Self, b: CGFloat) -> Self { .init(x: a.x * b, y: a.y * b) }
  func dot(_ b: Self) -> CGFloat { x * b.x + y * b.y }
  func limited(to limit: CGFloat) -> Self { self * min(1, limit / max(length, 0.00001)) }
}

// A map anchor is the magnetic home. The spring is integrated analytically,
// so dropped frames, 60/120 Hz, and gesture reversals cannot destabilize it.
// State is numbers only; it adds no UIKit views or independent animators.
struct LabSpringBody {
  static let frequency: CGFloat = 16
  static let damping: CGFloat = 0.67
  static let maximumDisplacement: CGFloat = 36
  var offset = LabVector.zero
  var velocity = LabVector.zero
  var isMoving: Bool { offset.length > 0.02 || velocity.length > 0.2 }

  mutating func advance(_ elapsed: Double, reducedMotion: Bool = false) {
    if reducedMotion { offset = .zero; velocity = .zero; return }
    guard elapsed > 0 else { return }
    let t = CGFloat(elapsed), w = Self.frequency, a = w * Self.damping
    let b = w * sqrt(1 - Self.damping * Self.damping)
    let decay = exp(-a * t), c = cos(b * t), s = sin(b * t)
    let position = (offset * c + (velocity + offset * a) * (s / b)) * decay
    velocity = (velocity * c - (velocity * a + offset * (w * w)) * (s / b)) * decay
    offset = position
    if !isMoving { offset = .zero; velocity = .zero }
  }

  // Bound energy, never position: no hard position clamp or clipped spring arc.
  // Viscous impact loss acts equally on both bodies' common collision velocity.
  func limitedVelocity(_ value: LabVector) -> LabVector {
    let budget = Self.frequency * sqrt(max(0, Self.maximumDisplacement * Self.maximumDisplacement - offset.dot(offset)))
    return value.limited(to: budget)
  }

  func allowedImpulseFraction(_ change: LabVector) -> CGFloat {
    let a = change.dot(change)
    guard a > 0.000001 else { return 1 }
    let b = 2 * velocity.dot(change)
    let w = Self.frequency
    let c = velocity.dot(velocity) + w * w * offset.dot(offset) - pow(w * Self.maximumDisplacement, 2)
    return min(1, max(0, (-b + sqrt(max(0, b * b - 4 * a * c))) / (2 * a)))
  }
}

enum ClusterLabDynamics {
  // Soften incoming contact energy without slowing the magnetic return.
  static let connectionVelocityRetention: CGFloat = 0.85

  static func mergedVelocity(target: LabVector, incoming: LabVector, targetMass: CGFloat, incomingMass: CGFloat = 1) -> LabVector {
    (target * targetMass + incoming * incomingMass) * (1 / max(1, targetMass + incomingMass))
  }

  // The released constraint contributes equal/opposite impulse. The lighter
  // side moves farther. Limiting one shared impulse preserves that balance.
  static func release(parent: inout LabSpringBody, child: inout LabSpringBody,
                      direction: LabVector, speed: CGFloat, remainingMass: CGFloat) -> CGFloat {
    let mass = max(1, remainingMass)
    let impulse = direction * (min(900, max(0, speed)) * mass / (mass + 1))
    let parentChange = impulse * (-1 / mass)
    let fraction = min(parent.allowedImpulseFraction(parentChange), child.allowedImpulseFraction(impulse))
    parent.velocity = parent.velocity + parentChange * fraction
    child.velocity = child.velocity + impulse * fraction
    return fraction
  }
}
