import Foundation
import CoreGraphics

// Protect the small native location dot, not its potentially enormous accuracy
// circle. Only vertical translation is allowed, preserving longitude and the
// camera fit's side margins. A price and its count use one shared translation.
final class ClusterLabLocationClearance {
  static let radius: CGFloat = 15 // Dot/white rim plus a small breathing gap.
  static let maximumOffset: CGFloat = 32
  private struct Motion {
    var value: CGFloat = 0
    var start: CGFloat = 0
    var target: CGFloat = 0
    var elapsed: Double = 0
  }
  private var motions: [String: Motion] = [:]
  private var snapNext = false

  func reset() { motions.removeAll(); snapNext = true }

  static func offset(frame: CGRect, dot: CGPoint?, bounds: CGRect, neighbors: [CGRect] = []) -> CGFloat {
    guard let dot else { return 0 }
    let radius = frame.height / 2
    let dx = max(0, max(frame.minX + radius - dot.x, dot.x - frame.maxX + radius))
    let clearance = radius + self.radius
    guard dx < clearance else { return 0 }
    let dy = sqrt(clearance * clearance - dx * dx)
    guard abs(frame.midY - dot.y) < dy else { return 0 }
    let up = dot.y - dy - frame.midY, down = dot.y + dy - frame.midY
    let low = max(-maximumOffset, min(0, bounds.minY - frame.minY))
    let high = min(maximumOffset, max(0, bounds.maxY - frame.maxY))
    let upFits = up >= low, downFits = down <= high
    func overlap(_ shift: CGFloat) -> CGFloat {
      neighbors.reduce(0) { total, other in
        let segment = max(0, (frame.width - frame.height) / 2) + max(0, (other.width - other.height) / 2)
        let x = max(0, abs(frame.midX - other.midX) - segment)
        let penetration = max(0, (frame.height + other.height) / 2 - hypot(x, frame.midY + shift - other.midY))
        return total + penetration * penetration
      }
    }
    if upFits && downFits {
      let above = overlap(up), below = overlap(down)
      if abs(above - below) > 0.01 { return above < below ? up : down }
    }
    // Prefer above on an exact/near tie, avoiding floating-point direction
    // chatter when a station shares the user's coordinate.
    if upFits && (!downFits || abs(up) <= down + 1) { return up }
    if downFits { return down }
    // At a screen edge retain the geographic cap. The native dot remains on
    // top even if there isn't enough room for complete capsule clearance.
    return abs(frame.midY + low - dot.y) >= abs(frame.midY + high - dot.y) ? low : high
  }

  func update(frames: [String: CGRect], dot: CGPoint?, bounds: CGRect,
              deltaTime: Double, reducedMotion: Bool) -> (offsets: [String: CGFloat], moving: Bool) {
    motions = motions.filter { frames[$0.key] != nil }
    var offsets: [String: CGFloat] = [:]
    var moving = false
    var occupied = frames
    for id in frames.keys.sorted() {
      let frame = frames[id]!
      let initial = Self.offset(frame: frame, dot: dot, bounds: bounds)
      let target = initial == 0 ? 0 : Self.offset(frame: frame, dot: dot, bounds: bounds,
                                                 neighbors: occupied.filter { $0.key != id }.map(\.value))
      occupied[id] = frame.offsetBy(dx: 0, dy: target)
      var motion = motions[id] ?? Motion()
      if abs(target - motion.target) > 0.05 {
        motion.start = motion.value; motion.target = target; motion.elapsed = 0
      }
      motion.elapsed = min(0.08, motion.elapsed + max(0, deltaTime))
      let t = CGFloat(motion.elapsed / 0.08)
      let eased = t * t * t * (t * (t * 6 - 15) + 10)
      motion.value = snapNext || reducedMotion ? target : motion.start + (motion.target - motion.start) * eased
      if snapNext || reducedMotion { motion.start = target; motion.target = target; motion.elapsed = 0.08 }
      moving = moving || abs(motion.value - motion.target) > 0.01
      offsets[id] = motion.value
      motions[id] = motion
    }
    snapNext = false
    return (offsets, moving)
  }
}
