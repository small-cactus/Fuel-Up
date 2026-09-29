import Foundation
import CoreGraphics

struct LabGlassItem {
  let id: String
  let frame: CGRect
}

// Native glass has one isotropic spacing. Share effects along horizontal runs,
// but keep stacked runs in separate native effects until their capsules touch.
// Distant runs reuse the same effect; there is no container per station.
enum ClusterLabGlassGrouping {
  struct Layout {
    let groups: [String: Int]
    let connections: [String: String]
  }
  private struct Cell: Hashable { let x: Int; let y: Int }

  static func groups(_ input: [LabGlassItem], previous: [String: Int]) -> [String: Int] {
    layout(input, previous: previous).groups
  }

  static func layout(_ input: [LabGlassItem], previous: [String: Int]) -> Layout {
    let items = input.sorted { $0.id < $1.id }
    guard !items.isEmpty else { return Layout(groups: [:], connections: [:]) }
    let reach = ClusterLabGeometry.glassSpacing * 2
    let cellWidth = (items.map { $0.frame.width }.max() ?? 84) + reach
    let cellHeight = (items.map { $0.frame.height }.max() ?? 32) + reach
    var parents = Array(items.indices)
    func root(_ index: Int) -> Int {
      var current = index
      while parents[current] != current { current = parents[current] }
      return current
    }
    var cells: [Cell: [Int]] = [:]
    var conflicts: [(Int, Int)] = []
    for (i, item) in items.enumerated() {
      let cell = Cell(x: Int(floor(item.frame.midX / cellWidth)), y: Int(floor(item.frame.midY / cellHeight)))
      for x in (cell.x - 1)...(cell.x + 1) {
        for y in (cell.y - 1)...(cell.y + 1) {
          for j in cells[Cell(x: x, y: y)] ?? [] {
            let other = items[j].frame
            let gap = ClusterLabGeometry.capsuleGap(item.frame, other)
            guard gap <= reach else { continue }
            // Classify the nearest capsule edges, not their centers. A count
            // beside a price has a diagonal center-to-center line to the next
            // row; treating that line as horizontal reconnects both rows through
            // the count and lets native glass pull vertically across the gap.
            let segments = max(0, (item.frame.width - item.frame.height) / 2) +
              max(0, (other.width - other.height) / 2)
            let separation = CGPoint(x: max(0, abs(item.frame.midX - other.midX) - segments),
                                     y: item.frame.midY - other.midY)
            let stacked = abs(separation.y) >= (item.frame.height + other.height) / 2 ||
              ClusterLabGeometry.isVertical(separation)
            if !stacked {
              guard gap <= ClusterLabGeometry.glassSpacing else { continue }
              let a = root(i), b = root(j)
              parents[max(a, b)] = min(a, b)
            } else if gap <= 2 {
              let a = root(i), b = root(j)
              parents[max(a, b)] = min(a, b)
            } else { conflicts.append((i, j)) }
          }
        }
      }
      cells[cell, default: []].append(i)
    }
    let components = Dictionary(grouping: items.indices, by: { root($0) })
    var neighbors: [Int: Set<Int>] = [:]
    for (i, j) in conflicts {
      let a = root(i), b = root(j)
      // A horizontal chain must remain one native effect, including its turns.
      guard a != b else { continue }
      neighbors[a, default: []].insert(b)
      neighbors[b, default: []].insert(a)
    }
    var colors: [Int: Int] = [:]
    var result: [String: Int] = [:]
    var connections: [String: String] = [:]
    for component in components.keys.sorted() {
      let indices = components[component]!
      let occupied = Set((neighbors[component] ?? []).compactMap { colors[$0] })
      let votes = Dictionary(grouping: indices.compactMap { previous[items[$0].id] }, by: { $0 }).mapValues(\.count)
      let preferred = votes.keys.sorted { votes[$0] == votes[$1] ? $0 < $1 : votes[$0]! > votes[$1]! }
      var color = preferred.first { !occupied.contains($0) } ?? 0
      while occupied.contains(color) { color += 1 }
      colors[component] = color
      for index in indices {
        result[items[index].id] = color
        connections[items[index].id] = items[component].id
      }
    }
    return Layout(groups: result, connections: connections)
  }
}
