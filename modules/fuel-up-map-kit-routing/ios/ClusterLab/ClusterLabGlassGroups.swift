import UIKit

// Every native effect fills the same padded root under the single map anchor.
// Moving a pill between effects preserves its frame and identity atomically.
final class ClusterLabGlassGroups {
  let root = UIView()
  private var containers: [Int: UIView] = [:]
  private var assignments: [String: Int] = [:]

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

  func insert(_ view: UIView) { content(for: 0).addSubview(view) }

  func update(_ views: [String: UIView]) -> [String: String] {
    let layout = ClusterLabGlassGrouping.layout(views.map { LabGlassItem(id: $0.key, frame: $0.value.frame) }, previous: assignments)
    let next = layout.groups
    for container in containers.values where container.frame != root.bounds { container.frame = root.bounds }
    for id in views.keys.sorted() {
      guard let view = views[id], let group = next[id] else { continue }
      let parent = content(for: group)
      if view.superview !== parent { parent.addSubview(view) }
    }
    let used = Set(next.values)
    for group in Array(containers.keys) where !used.contains(group) {
      containers.removeValue(forKey: group)?.removeFromSuperview()
    }
    assignments = next
    return layout.connections
  }

  // Read the actual UIKit hierarchy for the live probe, not planned assignments.
  func group(of view: UIView) -> Int? {
    containers.first { ClusterLabGlass.content(of: $0.value) === view.superview }?.key
  }
  var pillCount: Int { containers.values.reduce(0) { $0 + ClusterLabGlass.content(of: $1).subviews.count } }
  var groupCount: Int { containers.count }
}
