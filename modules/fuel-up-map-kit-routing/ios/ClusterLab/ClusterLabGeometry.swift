import Foundation
import CoreGraphics

// Pure screen-space broad phase. Yellow E85 stations lead mixed clusters,
// then recommendation and stable price/ID order break ties. Hysteresis prevents
// membership chatter at a contact boundary.
struct LabProjectedStation {
  let id: String
  let price: Double
  let point: CGPoint
  var isRecommended: Bool = false
  var highlightE85: Bool = false
}

enum ClusterLabGeometry {
  static let focusedScale: CGFloat = 1.18
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
  static let verticalDisconnectDistance: CGFloat = 34

  static func isVertical(_ separation: CGPoint) -> Bool {
    abs(separation.y) > abs(separation.x)
  }

  // Pull the count away while membership is still retained. It remains +n
  // throughout this map-driven range, before a split flight can start.
  static func badgeStretch(separation: CGPoint) -> CGFloat {
    guard !isVertical(separation) else { return 0 }
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

  static func pillFrame(at point: CGPoint, selected: Bool = false) -> CGRect {
    let scale = selected ? focusedScale : 1
    return CGRect(x: point.x - pillSize.width * scale / 2, y: point.y - pillSize.height * scale / 2,
                  width: pillSize.width * scale, height: pillSize.height * scale)
  }

  // One contact rule for logical membership and native glass. In particular,
  // horizontally stretched glass cannot remain connected to a second price.
  static func canBlend(_ a: CGRect, _ b: CGRect, preparation: Bool = false) -> Bool {
    let segments = max(0, (a.width - a.height) / 2) + max(0, (b.width - b.height) / 2)
    let dx = max(0, abs(a.midX - b.midX) - segments), dy = abs(a.midY - b.midY)
    let stacked = dy >= (a.height + b.height) / 2 || dy > dx
    return capsuleGap(a, b) <= (stacked ? 2 : glassSpacing + (preparation ? 12 : 0))
  }

  // All scale boundaries of canBlend for two normal price capsules. Including
  // orientation boundaries keeps the pre-render camera solve exact at diagonals.
  static func contactScales(separation: CGPoint) -> [CGFloat] {
    let x = abs(separation.x), y = abs(separation.y), segment = pillSize.width - pillSize.height
    guard x + y > 0 else { return [] }
    func edgeScale(_ reach: CGFloat) -> CGFloat {
      let radius = pillSize.height + reach
      if y > 0 && x * radius / y <= segment { return radius / y }
      let length2 = x * x + y * y
      return (x * segment + sqrt(max(0, length2 * radius * radius - y * y * segment * segment))) / length2
    }
    return [edgeScale(2), edgeScale(glassSpacing), y > 0 ? pillSize.height / y : .infinity,
            x > y ? segment / (x - y) : .infinity]
  }

  static func owners(_ stations: [LabProjectedStation], previous: [String: String], selectedId: String? = nil,
                     displayOffsets: [String: CGFloat] = [:], pillWidth: CGFloat = pillSize.width) -> [String: String] {
    let sorted = stations.sorted {
      if $0.highlightE85 != $1.highlightE85 { return $0.highlightE85 }
      if $0.isRecommended != $1.isRecommended { return $0.isRecommended }
      return $0.price == $1.price ? $0.id < $1.id : $0.price < $1.price
    }
    var owners: [String: String] = [:]
    struct Cell: Hashable { let x: Int; let y: Int }
    var grid: [Cell: [Int]] = [:]
    let extraWidth = pillSize.width * (focusedScale - 1) / 2
    let extraHeight = pillSize.height * (focusedScale - 1) / 2
    let retainedWidth = disconnectRange.width - pillSize.width + pillWidth
    let cellWidth = retainedWidth + extraWidth
    let cellHeight = disconnectRange.height + extraHeight + 2 * (displayOffsets.values.map { abs($0) }.max() ?? 0)
    for (index, station) in sorted.enumerated() {
      // A cell spans the largest retained connection, so the adjacent-cell
      // search cannot miss a stretched pair across a bucket boundary.
      let cell = Cell(x: Int(floor(station.point.x / cellWidth)),
                      y: Int(floor(station.point.y / cellHeight)))
      var representative: Int?
      for x in (cell.x - 1)...(cell.x + 1) {
        for y in (cell.y - 1)...(cell.y + 1) {
          for other in grid[Cell(x: x, y: y)] ?? [] {
            let retained = previous[station.id] == sorted[other].id
            let dx = abs(station.point.x - sorted[other].point.x)
            let dy = abs(station.point.y - sorted[other].point.y)
            let vertical = isVertical(CGPoint(x: dx, y: dy))
            let retainedHeight = vertical ? verticalDisconnectDistance : disconnectRange.height
            let selected = station.id == selectedId || sorted[other].id == selectedId
            let ownFrame = pillFrame(at: station.point, selected: station.id == selectedId).insetBy(dx: (pillSize.width - pillWidth) / 2, dy: 0)
            let parentFrame = pillFrame(at: sorted[other].point, selected: sorted[other].id == selectedId).insetBy(dx: (pillSize.width - pillWidth) / 2, dy: 0)
            // A geographic contact will share one nudge after merging. Separate
            // hypothetical nudges must not prevent that original connection.
            let contact = canBlend(ownFrame, parentFrame) || canBlend(
              ownFrame.offsetBy(dx: 0, dy: displayOffsets[station.id] ?? 0),
              parentFrame.offsetBy(dx: 0, dy: displayOffsets[sorted[other].id] ?? 0))
            let held = retained && dx <= retainedWidth + (selected ? extraWidth : 0) &&
              dy <= retainedHeight + (selected ? extraHeight : 0)
            if contact || held {
              representative = min(representative ?? other, other)
            }
          }
        }
      }
      if let representative {
        owners[station.id] = sorted[representative].id
      } else {
        owners[station.id] = station.id
        // Only visible representatives recruit members. Hidden stations cannot
        // form a transitive chain that pulls distant prices into this badge.
        grid[cell, default: []].append(index)
      }
    }
    return owners
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
