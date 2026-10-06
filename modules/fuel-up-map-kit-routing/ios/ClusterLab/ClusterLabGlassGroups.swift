import UIKit

// Every native effect fills the same padded root under the single map anchor.
// Moving a pill between effects preserves its frame and identity atomically.
final class ClusterLabGlassGroups {
  let root = UIView()
  private var containers: [Int: UIView] = [:]
  private var assignments: [String: Int] = [:]
  private var viewReparents: [ObjectIdentifier: Int] = [:]

  init() {
    root.isUserInteractionEnabled = false
    root.clipsToBounds = false
  }

  private func content(for group: Int) -> UIView {
    if let container = containers[group] { return ClusterLabGlass.content(of: container) }
    let container = ClusterLabGlass.container()
    container.isUserInteractionEnabled = false
    container.frame = root.bounds
    root.addSubview(container)
    containers[group] = container
    return ClusterLabGlass.content(of: container)
  }

  func update(_ views: [String: UIView], families: [String: String], anchors: [String: Int],
              highlightedFamilies: Set<String>, yellowIDs: Set<String> = []) -> [String: String] {
    let items = views.map { LabGlassItem(id: $0.key, frame: $0.value.frame, family: families[$0.key], anchorPriority: anchors[$0.key] ?? 0) }
    // Prepare the shared effect before native glass reaches visible contact.
    // The effect's 36pt spacing and strict vertical contact remain unchanged.
    let layout = ClusterLabGlassGrouping.isolatedLayout(items.filter { !yellowIDs.contains($0.id) }, previous: assignments.filter { $0.value >= 0 },
      highlightedFamilies: highlightedFamilies, preparation: true)
    var next = layout.groups
    var connections = ClusterLabGlassGrouping.isolatedLayout(items.filter { !yellowIDs.contains($0.id) }, previous: next,
      highlightedFamilies: highlightedFamilies).connections
    // A separate stable namespace prevents yellow from tinting green/neutral
    // pills through UIKit's shared native glass composite, including movers.
    let yellow = ClusterLabGlassGrouping.layout(items.filter { yellowIDs.contains($0.id) },
      previous: assignments.filter { $0.value < 0 }.mapValues { -$0 - 1 }, preparation: true)
    var layers = layout.layers
    for (id, group) in yellow.groups { next[id] = -group - 1 }
    for (id, connection) in yellow.connections { connections[id] = connection }
    for (group, layer) in yellow.layers { layers[-group - 1] = (layout.layers.values.max() ?? -1) + 1 + layer }
    let live = Set(views.values.map(ObjectIdentifier.init))
    viewReparents = viewReparents.filter { live.contains($0.key) }
    for container in containers.values where container.frame != root.bounds { container.frame = root.bounds }
    for id in views.keys.sorted() {
      guard let view = views[id], let group = next[id] else { continue }
      let parent = content(for: group)
      if view.superview !== parent {
        if view.superview != nil { viewReparents[ObjectIdentifier(view), default: 0] += 1 }
        parent.addSubview(view)
      }
    }
    let used = Set(next.values)
    for group in Array(containers.keys) where !used.contains(group) {
      containers.removeValue(forKey: group)?.removeFromSuperview()
    }
    // Adding a reparented pill/container appends it in UIKit. Restore one paint
    // order so native shadows and backdrop sampling cannot depend on zoom history.
    for group in used {
      let parent = content(for: group)
      let ordered = views.keys.sorted().filter { next[$0] == group }.compactMap { views[$0] }
      if !parent.subviews.elementsEqual(ordered, by: { $0 === $1 }) {
        for view in ordered { parent.bringSubviewToFront(view) }
      }
    }
    let orderedContainers = used.sorted { layers[$0]! < layers[$1]! }.compactMap { containers[$0] }
    if !root.subviews.elementsEqual(orderedContainers, by: { $0 === $1 }) {
      for container in orderedContainers { root.bringSubviewToFront(container) }
    }
    assignments = next
    return connections
  }

  // Read the actual UIKit hierarchy for the live probe, not planned assignments.
  func group(of view: UIView) -> Int? {
    containers.first { ClusterLabGlass.content(of: $0.value) === view.superview }?.key
  }
  func containsHighlight(_ view: UIView) -> Bool {
    guard let group = group(of: view) else { return false }
    return group < 0 || group % 2 == 1
  }
  func paintLayer(of view: UIView) -> Int? {
    guard let group = group(of: view), let container = containers[group] else { return nil }
    return root.subviews.firstIndex { $0 === container }
  }
  // Inspect real material writes on UIKit views, not copied getter identities.
  var materialResetCount: Int {
    containers.values.reduce(0) { $0 + (($1 as? ClusterLabGlassContainer)?.materialResetCount ?? 0) }
  }
  func reparents(of view: UIView) -> Int { viewReparents[ObjectIdentifier(view)] ?? 0 }
  var pillCount: Int { containers.values.reduce(0) { $0 + ClusterLabGlass.content(of: $1).subviews.count } }
  var groupCount: Int { containers.count }
}
