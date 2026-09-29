import Foundation
import CoreGraphics

// Solve the settled screen geometry without creating views or moving the map.
// Membership has hysteresis; visible glass can also connect to a nearby count.
enum ClusterLabFocus {
  struct Plan { let scale: CGFloat; let isolated: Bool }

  static func plan(id: String, stations: [LabProjectedStation], previous: [String: String],
                   dot: CGPoint?, bounds: CGRect, maximumScale: CGFloat) -> Plan? {
    guard let target = stations.first(where: { $0.id == id }), maximumScale.isFinite,
          maximumScale >= 1, bounds.width > 0, bounds.height > 0,
          stations.allSatisfy({ $0.point.x.isFinite && $0.point.y.isFinite }) else { return nil }
    let center = CGPoint(x: bounds.midX, y: bounds.midY)
    func project(_ point: CGPoint, _ scale: CGFloat) -> CGPoint {
      CGPoint(x: center.x + (point.x - target.point.x) * scale,
              y: center.y + (point.y - target.point.y) * scale)
    }
    func clear(_ scale: CGFloat) -> Bool {
      let points = stations.map { LabProjectedStation(id: $0.id, price: $0.price, point: project($0.point, scale)) }
      let owners = ClusterLabGeometry.owners(points, previous: previous)
      guard owners[id] == id, !owners.contains(where: { $0.key != id && $0.value == id }) else { return false }
      let positions = Dictionary(uniqueKeysWithValues: points.map { ($0.id, $0.point) })
      var frames: [String: CGRect] = [:], groupFrames: [String: CGRect] = [:]
      var offsets: [String: CGFloat] = [:]
      for point in points where owners[point.id] != point.id {
        guard let owner = owners[point.id], let origin = positions[owner] else { continue }
        offsets[owner] = max(offsets[owner] ?? 56, 56 + ClusterLabGeometry.badgeStretch(separation:
          CGPoint(x: point.point.x - origin.x, y: point.point.y - origin.y)))
      }
      for point in points where owners[point.id] == point.id {
        let frame = CGRect(x: point.point.x - 42, y: point.point.y - 16, width: 84, height: 32)
        frames[point.id] = frame; groupFrames[point.id] = frame
        if let offset = offsets[point.id] {
          let badge = CGRect(x: point.point.x + offset - 22, y: point.point.y - 16, width: 44, height: 32)
          frames["badge:\(point.id)"] = badge
          groupFrames[point.id] = frame.union(badge)
        }
      }
      let clearance = ClusterLabLocationClearance()
      let shifts = clearance.update(frames: groupFrames, dot: dot.map { project($0, scale) },
                                     bounds: bounds.insetBy(dx: 15, dy: 15), deltaTime: 0, reducedMotion: true).offsets
      for key in Array(frames.keys) {
        let owner = key.hasPrefix("badge:") ? String(key.dropFirst(6)) : key
        frames[key] = frames[key]!.offsetBy(dx: 0, dy: shifts[owner] ?? 0)
      }
      let groups = ClusterLabGlassGrouping.groups(frames.map { LabGlassItem(id: $0.key, frame: $0.value) }, previous: [:])
      guard let frame = frames[id] else { return false }
      return !frames.contains { key, other in
        key != id && groups[key] == groups[id] &&
          ClusterLabGeometry.capsuleGap(frame, other) <= ClusterLabGeometry.glassSpacing + 3
      }
    }
    if clear(1) { return Plan(scale: 1, isolated: true) }
    // Identical coordinates cannot be separated by any geographic zoom.
    if stations.contains(where: { $0.id != id && hypot($0.point.x - target.point.x, $0.point.y - target.point.y) < 1e-7 }) {
      return Plan(scale: 1, isolated: false)
    }
    var low: CGFloat = 1, high: CGFloat = 1
    while high < maximumScale {
      low = high; high = min(maximumScale, high * 1.25)
      if clear(high) { break }
    }
    guard clear(high) else { return Plan(scale: high, isolated: false) }
    for _ in 0..<24 {
      let middle = (low + high) / 2
      if clear(middle) { high = middle } else { low = middle }
    }
    // Small projection tolerance, checked again because count membership can
    // change discontinuously. All of these trials remain pure geometry.
    let padded = min(maximumScale, high * 1.04)
    return Plan(scale: clear(padded) ? padded : high, isolated: true)
  }
}
