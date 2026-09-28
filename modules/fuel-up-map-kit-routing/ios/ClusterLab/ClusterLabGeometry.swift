import Foundation
import CoreGraphics

// Pure screen-space broad phase. Stable price/ID order chooses the cheapest
// representative. Hysteresis prevents membership chatter at a contact boundary.
struct LabProjectedStation {
  let id: String
  let price: Double
  let point: CGPoint
}

enum ClusterLabGeometry {
  static let pillSize = CGSize(width: 84, height: 32)
  static let badgeWidth: CGFloat = 44
  static let badgeOffset: CGFloat = 56
  static let overscan: CGFloat = 160
  static let containerPadding: CGFloat = 360
  static let maximumRebound: CGFloat = 18
  static let disconnectRange = CGSize(width: 120, height: 56)
  static let glassSpacing: CGFloat = 36
  // Keep the already-tuned connection impulse inside the longer native neck.
  static let impactSpacing: CGFloat = 18
  static let maximumBadgeStretch: CGFloat = 18

  // Pull the count away while membership is still retained. It remains +n
  // throughout this map-driven range, before a split flight can start.
  static func badgeStretch(separation: CGPoint) -> CGFloat {
    let x = (abs(separation.x) - pillSize.width) / (disconnectRange.width - pillSize.width)
    let y = (abs(separation.y) - pillSize.height) / (disconnectRange.height - pillSize.height)
    let t = min(1, max(0, max(x, y)))
    return maximumBadgeStretch * t * t * (3 - 2 * t)
  }

  // Exact edge distance for the horizontal capsules, including their rounded
  // ends. A diagonal separation must not release on a rectangular corner gap.
  static func capsuleGap(_ a: CGRect, _ b: CGRect) -> CGFloat {
    let radiusSum = (a.height + b.height) / 2
    let segmentSum = max(0, (a.width - a.height) / 2) + max(0, (b.width - b.height) / 2)
    let dx = max(0, abs(a.midX - b.midX) - segmentSum)
    return max(0, hypot(dx, a.midY - b.midY) - radiusSum)
  }

  static func owners(_ stations: [LabProjectedStation], previous: [String: String]) -> [String: String] {
    let sorted = stations.sorted { $0.price == $1.price ? $0.id < $1.id : $0.price < $1.price }
    var parent = Array(sorted.indices)
    func root(_ index: Int) -> Int {
      var result = index
      while parent[result] != result { result = parent[result] }
      return result
    }
    struct Cell: Hashable { let x: Int; let y: Int }
    var grid: [Cell: [Int]] = [:]
    for (index, station) in sorted.enumerated() {
      // A cell spans the largest retained connection, so the adjacent-cell
      // search cannot miss a stretched pair across a bucket boundary.
      let cell = Cell(x: Int(floor(station.point.x / disconnectRange.width)),
                      y: Int(floor(station.point.y / disconnectRange.height)))
      for x in (cell.x - 1)...(cell.x + 1) {
        for y in (cell.y - 1)...(cell.y + 1) {
          for other in grid[Cell(x: x, y: y)] ?? [] {
            let retained = previous[station.id] != nil && previous[station.id] == previous[sorted[other].id]
            let dx = abs(station.point.x - sorted[other].point.x)
            let dy = abs(station.point.y - sorted[other].point.y)
            if dx <= (retained ? disconnectRange.width : pillSize.width) &&
               dy <= (retained ? disconnectRange.height : pillSize.height) {
              let a = root(index), b = root(other)
              parent[max(a, b)] = min(a, b)
            }
          }
        }
      }
      grid[cell, default: []].append(index)
    }
    return Dictionary(uniqueKeysWithValues: sorted.indices.map { (sorted[$0].id, sorted[root($0)].id) })
  }

  // Follow the observed camera movement, with a bounded settling time instead
  // of a speed cap that makes distant destinations trail behind the gesture.
  static func duration(distance: CGFloat, speed: CGFloat, movementDuration: Double) -> Double {
    min(0.22, max(0.08, min(movementDuration, Double(distance / max(speed, 1)))))
  }

  // One viscous surge and return, with zero velocity/acceleration at both ends
  // and the turnaround. Small drags remain quiet; long or fast moves carry more
  // momentum. Only the return phase is stretched: half speed, twice the time.
  static func rebound(distance: CGFloat, speed: CGFloat) -> CGFloat {
    let travelEnergy = min(1, max(0, distance) / 180)
    let gestureEnergy = min(1, max(0, speed) / 1200)
    return min(maximumRebound, max(0, distance) * (0.025 + 0.07 * travelEnergy + 0.08 * gestureEnergy))
  }

  static func completionDuration(for duration: Double) -> Double {
    // Original outward phase: 68%. Original rebound: 32%, now doubled.
    duration * 1.32
  }

  static func progress(elapsed: Double, duration: Double, distance: CGFloat, speed: CGFloat = 0) -> CGFloat {
    let outwardDuration = duration * 0.68
    let curveTime = elapsed <= outwardDuration ? elapsed : outwardDuration + (elapsed - outwardDuration) * 0.5
    let t = CGFloat(min(1, max(0, curveTime / max(duration, 0.001))))
    if t == 0 || t == 1 { return t }
    let overshoot = rebound(distance: distance, speed: speed) / max(distance, 0.001)
    func smooth(_ value: CGFloat) -> CGFloat {
      value * value * value * (value * (value * 6 - 15) + 10)
    }
    let turnaround: CGFloat = 0.68
    if t < turnaround { return (1 + overshoot) * smooth(t / turnaround) }
    return 1 + overshoot * (1 - smooth((t - turnaround) / (1 - turnaround)))
  }
}
