import Foundation
import CoreGraphics

// Solve in projected map coordinates before creating any pills. Small searches
// use exact contact intervals; dense searches use bounded layout sampling.
// Count capsules are included in the width budget in both cases.
enum ClusterLabCameraFit {
  static func belowHeader(_ usable: CGRect) -> CGRect {
    // Moving only the top edge 50pt lowers the framing center 25pt and keeps
    // the bottom clear of the station card. Cap it in short landscape layouts.
    let clearance = min(50, max(0, usable.height - 64))
    return CGRect(x: usable.minX, y: usable.minY + clearance,
                  width: usable.width, height: usable.height - clearance)
  }

  static func rect(for stations: [LabProjectedStation], viewport: CGSize,
                   usable: CGRect, maximumScale: CGFloat, userLocation: CGPoint? = nil) -> CGRect? {
    guard !stations.isEmpty, usable.width > 120, usable.height > 32,
          viewport.width > 0, viewport.height > 0, maximumScale > 0 else { return nil }
    // The location is a framing anchor only, never a station in the cluster graph.
    // Reserve the same edge breathing room as a chip (including the dot halo).
    let anchors = stations.map(\.point) + (userLocation.map { [$0] } ?? [])
    let minX = anchors.map(\.x).min()!, maxX = anchors.map(\.x).max()!
    let minY = anchors.map(\.y).min()!, maxY = anchors.map(\.y).max()!
    let points = stations.map {
      LabProjectedStation(id: $0.id, price: $0.price, point: CGPoint(x: $0.point.x - minX, y: $0.point.y - minY), isRecommended: $0.isRecommended, highlightE85: $0.highlightE85)
    }
    let dx = maxX - minX, dy = maxY - minY
    var scale = min(maximumScale, dx > 0 ? (usable.width - 84) / dx : maximumScale,
                    dy > 0 ? (usable.height - 32) / dy : maximumScale)
    // Nationwide searches can contain thousands of quotes. Enumerating every
    // pair-contact interval then solving each one is unbounded UI-thread work.
    // Dense searches use a bounded, deterministic search of actual layouts.
    if points.count > 64 {
      return denseRect(points: points, minX: minX, minY: minY, dx: dx, dy: dy,
                       viewport: viewport, usable: usable, upperScale: scale)
    }
    // Clustering changes only at these pair-contact scales. Visit intervals
    // from largest to smallest; solve each interval's monotonic capsule bounds.
    // This avoids trial renders, iterative camera zooms, or binary search across
    // discontinuous +n widths. Normal station searches have only tens of quotes.
    var contacts = Set<CGFloat>()
    for i in points.indices {
      for j in points.indices where j < i {
        let x = abs(points[i].point.x - points[j].point.x)
        let y = abs(points[i].point.y - points[j].point.y)
        for contact in ClusterLabGeometry.contactScales(separation: CGPoint(x: x, y: y)) {
          if contact > 0 && contact < scale { contacts.insert(contact) }
        }
      }
    }
    let boundaries = contacts.sorted(by: >) + [0]
    for boundary in boundaries {
      let projected = points.map {
        LabProjectedStation(id: $0.id, price: $0.price,
                            point: CGPoint(x: $0.point.x * scale, y: $0.point.y * scale), isRecommended: $0.isRecommended, highlightE85: $0.highlightE85)
      }
      let owners = ClusterLabGeometry.owners(projected, previous: [:])
      let byId = Dictionary(uniqueKeysWithValues: points.map { ($0.id, $0.point) })
      func rightEdge(at value: CGFloat) -> CGFloat {
        var result = dx * value + 42
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
        // A directly recruited member can stretch its count on first layout.
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

  private static func denseRect(points: [LabProjectedStation], minX: CGFloat, minY: CGFloat,
                                dx: CGFloat, dy: CGFloat, viewport: CGSize, usable: CGRect,
                                upperScale: CGFloat) -> CGRect? {
    let byId = Dictionary(uniqueKeysWithValues: points.map { ($0.id, $0.point) })
    func rightEdge(_ scale: CGFloat) -> CGFloat {
      let projected = points.map { LabProjectedStation(id: $0.id, price: $0.price,
        point: CGPoint(x: $0.point.x * scale, y: $0.point.y * scale), isRecommended: $0.isRecommended, highlightE85: $0.highlightE85) }
      let owners = ClusterLabGeometry.owners(projected, previous: [:])
      var edge = dx * scale + 42
      for point in points {
        guard let ownerId = owners[point.id], ownerId != point.id, let owner = byId[ownerId] else { continue }
        let stretch = ClusterLabGeometry.badgeStretch(separation:
          CGPoint(x: (point.point.x - owner.x) * scale, y: (point.point.y - owner.y) * scale))
        edge = max(edge, owner.x * scale + 78 + stretch)
      }
      return edge
    }
    func fittedRect(_ scale: CGFloat, _ edge: CGFloat) -> CGRect {
      CGRect(x: minX + ((edge - 42) / 2 - usable.midX) / scale,
             y: minY + (dy * scale / 2 - usable.midY) / scale,
             width: viewport.width / scale, height: viewport.height / scale)
    }
    let upperEdge = rightEdge(upperScale)
    if upperEdge + 42 <= usable.width { return fittedRect(upperScale, upperEdge) }
    // The full badge + maximum stretch is a safe lower camera bound. A narrow
    // viewport may require collapsing the stretch first; halve a bounded number
    // of times, checking the real layout rather than assuming it fits.
    var low = min(upperScale, dx > 0 ? max(0.001, usable.width - 138) / dx : upperScale)
    var edge = rightEdge(low)
    for _ in 0..<24 where edge + 42 > usable.width { low *= 0.5; edge = rightEdge(low) }
    guard edge + 42 <= usable.width else { return nil }
    let guaranteed = low
    var high = upperScale
    // Check from tightest to widest; do not binary-search across all of the
    // discontinuous contact intervals. Refine only the first sampled crossing.
    for step in 1...6 {
      let candidate = upperScale - (upperScale - guaranteed) * CGFloat(step) / 6
      let candidateEdge = rightEdge(candidate)
      if candidateEdge + 42 <= usable.width {
        low = candidate; edge = candidateEdge; break
      }
      high = candidate
    }
    for _ in 0..<4 {
      let candidate = (low + high) / 2
      let candidateEdge = rightEdge(candidate)
      if candidateEdge + 42 <= usable.width { low = candidate; edge = candidateEdge } else { high = candidate }
    }
    return fittedRect(low, edge)
  }
}
