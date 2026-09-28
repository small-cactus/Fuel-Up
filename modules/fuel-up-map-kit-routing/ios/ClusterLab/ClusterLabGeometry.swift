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

  // Follow the observed camera movement, with a bounded settling time instead
  // of a speed cap that makes distant destinations trail behind the gesture.
  static func duration(distance: CGFloat, speed: CGFloat, movementDuration: Double) -> Double {
    min(0.22, max(0.08, min(movementDuration, Double(distance / max(speed, 1)))))
  }

  // Ease-out back with distance-scaled rebound (at most three screen points).
  // Both endpoints are exact; elapsed time, not frame count, drives progress.
  static func progress(elapsed: Double, duration: Double, distance: CGFloat) -> CGFloat {
    let t = CGFloat(min(1, max(0, elapsed / max(duration, 0.001))))
    if t == 0 || t == 1 { return t }
    let rebound = min(0.7, pow(3 / max(distance, 1) * 27 / 4, 1.0 / 3))
    let u = t - 1
    return 1 + (rebound + 1) * u * u * u + rebound * u * u
  }
}
