import Foundation
import CoreGraphics

// Solve in projected map coordinates before creating any pills. Larger uniform
// scale can only split fresh clusters, so the largest feasible scale also gives
// the fewest grouped stations. Count capsules are included in the width budget.
enum ClusterLabCameraFit {
  static func rect(for stations: [LabProjectedStation], viewport: CGSize,
                   usable: CGRect, maximumScale: CGFloat) -> CGRect? {
    guard !stations.isEmpty, usable.width > 120, usable.height > 32,
          viewport.width > 0, viewport.height > 0, maximumScale > 0 else { return nil }
    let minX = stations.map { $0.point.x }.min()!, maxX = stations.map { $0.point.x }.max()!
    let minY = stations.map { $0.point.y }.min()!, maxY = stations.map { $0.point.y }.max()!
    let points = stations.map {
      LabProjectedStation(id: $0.id, price: $0.price, point: CGPoint(x: $0.point.x - minX, y: $0.point.y - minY))
    }
    let dx = maxX - minX, dy = maxY - minY
    var scale = min(maximumScale, dx > 0 ? (usable.width - 84) / dx : maximumScale,
                    dy > 0 ? (usable.height - 32) / dy : maximumScale)
    // Clustering changes only at these pair-contact scales. Visit intervals
    // from largest to smallest; solve each interval's monotonic capsule bounds.
    // This avoids trial renders, iterative camera zooms, or binary search across
    // discontinuous +n widths. Normal station searches have only tens of quotes.
    var contacts = Set<CGFloat>()
    for i in points.indices {
      for j in points.indices where j < i {
        let x = abs(points[i].point.x - points[j].point.x)
        let y = abs(points[i].point.y - points[j].point.y)
        let contact = min(x > 0 ? 84 / x : .infinity, y > 0 ? 32 / y : .infinity)
        if contact > 0 && contact < scale { contacts.insert(contact) }
      }
    }
    let boundaries = contacts.sorted(by: >) + [0]
    for boundary in boundaries {
      let projected = points.map {
        LabProjectedStation(id: $0.id, price: $0.price,
                            point: CGPoint(x: $0.point.x * scale, y: $0.point.y * scale))
      }
      let owners = ClusterLabGeometry.owners(projected, previous: [:])
      let byId = Dictionary(uniqueKeysWithValues: points.map { ($0.id, $0.point) })
      func rightEdge(at value: CGFloat) -> CGFloat {
        var result = points.map { $0.point.x * value + 42 }.max()!
        for point in points {
          guard let ownerId = owners[point.id], ownerId != point.id, let owner = byId[ownerId] else { continue }
          let stretch = ClusterLabGeometry.badgeStretch(separation:
            CGPoint(x: (point.point.x - owner.x) * value, y: (point.point.y - owner.y) * value))
          result = max(result, owner.x * value + 78 + stretch)
        }
        return result
      }
      var candidate = scale
      if rightEdge(at: candidate) + 42 > usable.width {
        // Transitive groups can have a stretched count even on first layout.
        // Solve that existing smoothstep width too, entirely offscreen.
        var low: CGFloat = 0, high = scale
        for _ in 0..<48 {
          let middle = (low + high) / 2
          if rightEdge(at: middle) + 42 <= usable.width { low = middle } else { high = middle }
        }
        candidate = low
      }
      if candidate > boundary || boundary == 0 {
        let centerX = minX + ((rightEdge(at: candidate) - 42) / 2 - usable.midX) / candidate
        let centerY = minY + (dy * candidate / 2 - usable.midY) / candidate
        return CGRect(x: centerX, y: centerY, width: viewport.width / candidate, height: viewport.height / candidate)
      }
      // Enter the next contact interval just inside its boundary, avoiding
      // floating-point ambiguity at exactly touching capsule centers.
      scale = boundary * (1 - 1e-9)
    }
    return nil
  }
}
