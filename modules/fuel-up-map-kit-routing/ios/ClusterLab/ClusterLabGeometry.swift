import Foundation

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
      let cell = Cell(x: Int(floor(station.point.x / 104)), y: Int(floor(station.point.y / 48)))
      for x in (cell.x - 1)...(cell.x + 1) {
        for y in (cell.y - 1)...(cell.y + 1) {
          for other in grid[Cell(x: x, y: y)] ?? [] {
            let retained = previous[station.id] != nil && previous[station.id] == previous[sorted[other].id]
            let dx = abs(station.point.x - sorted[other].point.x)
            let dy = abs(station.point.y - sorted[other].point.y)
            if dx <= (retained ? 100 : 84) && dy <= (retained ? 44 : 32) {
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

  // Bound animation's contribution to movement to two points per displayed
  // frame. Map movement is projected separately and never smoothed or delayed.
  static func fraction(distance: CGFloat, deltaTime: Double, reducedMotion: Bool) -> CGFloat {
    if reducedMotion || distance < 0.08 { return 1 }
    let eased = 1 - exp(-max(0, min(deltaTime, 1.0 / 30)) * 18)
    return min(CGFloat(eased), min(2, CGFloat(deltaTime * 120)) / max(distance, 0.001))
  }
}
