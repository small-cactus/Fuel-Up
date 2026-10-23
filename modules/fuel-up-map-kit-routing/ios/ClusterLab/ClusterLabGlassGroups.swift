import UIKit

// Every native effect fills the same padded root under the single map anchor.
// Moving a pill between effects preserves its frame and identity atomically.
final class ClusterLabGlassGroups {
  let root = UIView()
  private var containers: [Int: UIView] = [:]
  // Reuse detached native effects across pinch reversals. Exact group IDs
  // preserve the neutral/green/yellow namespaces; idle effects have no pills
  // and never participate in compositing. Bound retained resources, and yield
  // them immediately under memory pressure.
  private var idleContainers: [Int: UIView] = [:]
  private var idleOrder: [Int] = []
  private let idleLimit = 6
  private var memoryObserver: NSObjectProtocol?
  private var assignments: [String: Int] = [:]
  private var viewReparents: [ObjectIdentifier: Int] = [:]

  init() {
    root.isUserInteractionEnabled = false
    root.clipsToBounds = false
    memoryObserver = NotificationCenter.default.addObserver(forName: UIApplication.didReceiveMemoryWarningNotification,
      object: nil, queue: .main) { [weak self] _ in
        self?.purgeIdleContainers()
      }
  }

  deinit { if let memoryObserver { NotificationCenter.default.removeObserver(memoryObserver) } }

  private func purgeIdleContainers() {
    idleContainers.removeAll(); idleOrder.removeAll()
  }

  #if DEBUG
  // Exercise actual UIKit objects offscreen; no fake material implementation.
  static func verifyReuse() -> Bool {
    let pool = ClusterLabGlassGroups()
    pool.root.bounds = CGRect(x: 0, y: 0, width: 200, height: 300)
    var identities: [Int: ObjectIdentifier] = [:]
    for group in 0..<9 {
      let content = pool.content(for: group)
      content.addSubview(UIView())
      identities[group] = ObjectIdentifier(pool.containers[group]!)
      pool.retire(group)
    }
    guard pool.idleContainers.count == 6, pool.idleContainers[0] == nil,
          pool.idleContainers.values.allSatisfy({ $0.superview == nil && ClusterLabGlass.content(of: $0).subviews.isEmpty }) else { return false }
    pool.root.bounds.size = CGSize(width: 320, height: 400)
    _ = pool.content(for: 4)
    guard ObjectIdentifier(pool.containers[4]!) == identities[4],
          pool.containers[4]!.frame == pool.root.bounds, pool.idleContainers[4] == nil else { return false }
    for group in [-1, -2, 1] { _ = pool.content(for: group); pool.retire(group) }
    let live = pool.containers[4]
    pool.purgeIdleContainers()
    return pool.idleContainers.isEmpty && pool.idleOrder.isEmpty && pool.containers[4] === live
  }
  #endif

  private func retire(_ group: Int) {
    guard let container = containers.removeValue(forKey: group) else { return }
    container.removeFromSuperview()
    for view in ClusterLabGlass.content(of: container).subviews { view.removeFromSuperview() }
    idleContainers[group] = container
    idleOrder.removeAll { $0 == group }
    idleOrder.append(group)
    while idleOrder.count > idleLimit { idleContainers.removeValue(forKey: idleOrder.removeFirst()) }
  }

  private func content(for group: Int) -> UIView {
    if let container = containers[group] { return ClusterLabGlass.content(of: container) }
    let container = idleContainers.removeValue(forKey: group) ?? ClusterLabGlass.container()
    idleOrder.removeAll { $0 == group }
    container.isUserInteractionEnabled = false
    container.frame = root.bounds
    root.addSubview(container)
    containers[group] = container
    return ClusterLabGlass.content(of: container)
  }

  func update(_ views: [String: UIView], families: [String: String], anchors: [String: Int],
              highlightedFamilies: Set<String>, yellowIDs: Set<String> = [],
              recordConnections: Bool = false) -> [String: String] {
    let items = views.map { LabGlassItem(id: $0.key, frame: $0.value.frame, family: families[$0.key], anchorPriority: anchors[$0.key] ?? 0) }
    let regularItems = items.filter { !yellowIDs.contains($0.id) }
    // Prepare the shared effect before native glass reaches visible contact.
    // The effect's 36pt spacing and strict vertical contact remain unchanged.
    let layout = ClusterLabGlassGrouping.isolatedLayout(regularItems, previous: assignments.filter { $0.value >= 0 },
      highlightedFamilies: highlightedFamilies, preparation: true)
    var next = layout.groups
    // Exact contact connections are telemetry only. Keep the real probe intact,
    // but avoid repeating the grouping work on every ordinary gesture frame.
    var connections = recordConnections ? ClusterLabGlassGrouping.isolatedLayout(regularItems, previous: next,
      highlightedFamilies: highlightedFamilies).connections : [:]
    // A separate stable namespace prevents yellow from tinting green/neutral
    // pills through UIKit's shared native glass composite, including movers.
    let yellow = ClusterLabGlassGrouping.layout(items.filter { yellowIDs.contains($0.id) },
      previous: assignments.filter { $0.value < 0 }.mapValues { -$0 - 1 }, preparation: true)
    var layers = layout.layers
    for (id, group) in yellow.groups { next[id] = -group - 1 }
    if recordConnections { for (id, connection) in yellow.connections { connections[id] = connection } }
    for (group, layer) in yellow.layers { layers[-group - 1] = (layout.layers.values.max() ?? -1) + 1 + layer }
    let live = Set(views.values.map(ObjectIdentifier.init))
    viewReparents = viewReparents.filter { live.contains($0.key) }
    for container in containers.values where container.frame != root.bounds { container.frame = root.bounds }
    let orderedIDs = views.keys.sorted()
    for id in orderedIDs {
      guard let view = views[id], let group = next[id] else { continue }
      let parent = content(for: group)
      if view.superview !== parent {
        if view.superview != nil { viewReparents[ObjectIdentifier(view), default: 0] += 1 }
        parent.addSubview(view)
      }
    }
    let used = Set(next.values)
    for group in Array(containers.keys) where !used.contains(group) {
      retire(group)
    }
    // Adding a reparented pill/container appends it in UIKit. Restore one paint
    // order so native shadows and backdrop sampling cannot depend on zoom history.
    for group in used {
      let parent = content(for: group)
      let ordered = orderedIDs.filter { next[$0] == group }.compactMap { views[$0] }
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
