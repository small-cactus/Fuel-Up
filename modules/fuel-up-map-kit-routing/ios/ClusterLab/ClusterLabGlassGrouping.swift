import Foundation
import CoreGraphics

struct LabGlassItem {
  let id: String
  let frame: CGRect
  var family: String? = nil
  var anchorPriority: Int = 0
}

// Native glass has one isotropic spacing. Share effects along horizontal runs,
// but keep stacked runs in separate native effects until their capsules touch.
// Distant runs reuse the same effect; there is no container per station.
enum ClusterLabGlassGrouping {
  struct Layout {
    let groups: [String: Int]
    let connections: [String: String]
    let layers: [Int: Int]
  }
  private struct Cell: Hashable { let x: Int; let y: Int }

  static func groups(_ input: [LabGlassItem], previous: [String: Int]) -> [String: Int] {
    layout(input, previous: previous).groups
  }

  // Prewarm incoming native effects without allowing a count capsule to bridge
  // two independent parents. Once membership changes, movers share their actual
  // parent's family and retain the full native connection/disconnection morph.
  static func previews(anchors: [LabGlassItem], footprints: [String: [CGRect]]) -> [String: String] {
    var result = layout(anchors, previous: [:], preparation: true).connections
    let groups = Dictionary(grouping: result.keys, by: { result[$0]! })
    for ids in groups.values where ids.count > 1 {
      var touches = false
      for (index, id) in ids.enumerated() {
        for other in ids.dropFirst(index + 1) {
          if (footprints[id] ?? []).contains(where: { a in
            (footprints[other] ?? []).contains(where: { ClusterLabGeometry.canBlend(a, $0) })
          }) { touches = true }
        }
      }
      if touches { for id in ids { result[id] = id } }
    }
    return result
  }

  // UIKit composites an entire glass container. Pool neutral and highlighted
  // families separately even when they are geographically far apart. Stable ID
  // namespaces prevent a previously green container being reused as neutral.
  static func isolatedLayout(_ input: [LabGlassItem], previous: [String: Int],
                             highlightedFamilies: Set<String>, preparation: Bool = false) -> Layout {
    var groups: [String: Int] = [:], connections: [String: String] = [:], layers: [Int: Int] = [:]
    for scope in 0...1 {
      let items = input.filter { item in
        let highlighted = item.family.map { highlightedFamilies.contains($0) } ?? false
        return highlighted == (scope == 1)
      }
      let compatible = previous.filter { $0.value % 2 == scope }.mapValues { $0 / 2 }
      let result = layout(items, previous: compatible, preparation: preparation)
      for (id, group) in result.groups { groups[id] = group * 2 + scope }
      for (id, connection) in result.connections { connections[id] = connection }
      for (group, layer) in result.layers { layers[group * 2 + scope] = layer * 2 + scope }
    }
    return Layout(groups: groups, connections: connections, layers: layers)
  }

  static func layout(_ input: [LabGlassItem], previous: [String: Int], preparation: Bool = false) -> Layout {
    let items = input.sorted { $0.id < $1.id }
    guard !items.isEmpty else { return Layout(groups: [:], connections: [:], layers: [:]) }
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
            // Proximity must not join independent cluster islands, including
            // diagonal price-to-count chains. Distant islands still pool effects.
            if item.family != items[j].family {
              conflicts.append((i, j))
              continue
            }
            if ClusterLabGeometry.canBlend(item.frame, other, preparation: preparation) {
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
    let priority = components.mapValues { $0.map { items[$0].anchorPriority }.max() ?? 0 }
    let ordered = components.keys.sorted {
      priority[$0] == priority[$1] ? $0 < $1 : priority[$0]! > priority[$1]!
    }
    // Canonical paint layers depend only on the current scene, never on which
    // effect happened to be allocated first. History-dependent pooling changes
    // native shadow/backdrop composition even when every tint is unchanged.
    var colors: [Int: Int] = [:]
    for component in ordered {
      let occupied = Set((neighbors[component] ?? []).compactMap { colors[$0] })
      var color = 0
      while occupied.contains(color) { color += 1 }
      colors[component] = color
    }
    let buckets = Dictionary(grouping: ordered, by: { colors[$0]! })
    var result: [String: Int] = [:]
    var connections: [String: String] = [:]
    var layers: [Int: Int] = [:]
    // Reuse actual effect objects separately from their canonical paint order.
    // Preserve the strongest stationary anchor when a bucket acquires movers.
    for color in buckets.keys.sorted() {
      let indices = buckets[color]!.flatMap { components[$0]! }
      let votes = Dictionary(grouping: indices.compactMap { previous[items[$0].id] }, by: { $0 }).mapValues(\.count)
      let anchored = indices.filter { items[$0].anchorPriority > 0 }.sorted {
        items[$0].anchorPriority == items[$1].anchorPriority ? $0 < $1 : items[$0].anchorPriority > items[$1].anchorPriority
      }.compactMap { previous[items[$0].id] }
      let preferred = anchored + votes.keys.sorted { votes[$0] == votes[$1] ? $0 < $1 : votes[$0]! > votes[$1]! }
      var group = preferred.first { layers[$0] == nil } ?? 0
      while layers[group] != nil { group += 1 }
      layers[group] = color
      for component in buckets[color]! {
        for index in components[component]! {
          result[items[index].id] = group
          connections[items[index].id] = items[component].id
        }
      }
    }
    return Layout(groups: result, connections: connections, layers: layers)
  }
}
