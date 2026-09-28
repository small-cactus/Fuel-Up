import MapKit

struct ClusterLabStation: Equatable {
  let id: String
  let latitude: Double
  let longitude: Double
  let price: Double
  let name: String
  var coordinate: CLLocationCoordinate2D { .init(latitude: latitude, longitude: longitude) }
  var mapPoint: MKMapPoint { MKMapPoint(coordinate) }

  init?(_ value: [String: Any]) {
    guard let id = value["id"] as? String, !id.isEmpty,
          let latitude = value["latitude"] as? Double, let longitude = value["longitude"] as? Double,
          let price = value["price"] as? Double, price.isFinite, price > 0,
          latitude.isFinite, longitude.isFinite,
          CLLocationCoordinate2DIsValid(.init(latitude: latitude, longitude: longitude)) else { return nil }
    self.id = id; self.latitude = latitude; self.longitude = longitude; self.price = price
    name = value["name"] as? String ?? "Gas station"
  }
}

private final class LabStationMotion {
  let station: ClusterLabStation
  var owner: String
  var point: MKMapPoint
  var offset: CGFloat = 0
  var width: CGFloat = 84
  var priceMix: CGFloat = 1
  var count = 1
  var settled = false
  var pill: ClusterLabPill?

  init(_ station: ClusterLabStation) {
    self.station = station; owner = station.id; point = station.mapPoint
  }
}

final class ClusterLabRenderer {
  let container = ClusterLabGlass.container()
  private var motions: [String: LabStationMotion] = [:]
  private var badges: [String: ClusterLabPill] = [:]
  private var owners: [String: String] = [:]
  private(set) var stations: [ClusterLabStation] = []
  private(set) var events: [[String: Any]] = []
  private(set) var frameSamples: [[String: Any]] = []
  var recording = false
  var dark = false

  init() { container.isUserInteractionEnabled = false }

  func setStations(_ next: [ClusterLabStation]) {
    guard next != stations else { return }
    // A data refresh may change price/order; no stale price is retained in a
    // reused pill. Camera state belongs to the map and is left untouched.
    let changed = Set(next.filter { station in motions[station.id]?.station != station }.map(\.id))
    for id in Array(motions.keys) where changed.contains(id) || !next.contains(where: { $0.id == id }) {
      motions.removeValue(forKey: id)?.pill?.view.removeFromSuperview()
    }
    stations = next.sorted { $0.price == $1.price ? $0.id < $1.id : $0.price < $1.price }
  }

  private func project(_ point: MKMapPoint, map: MKMapView) -> CGPoint {
    map.convert(point.coordinate, toPointTo: container)
  }

  private func makePill(_ motion: LabStationMotion) -> ClusterLabPill {
    let pill = ClusterLabPill(price: motion.station.price, name: motion.station.name)
    ClusterLabGlass.content(of: container).addSubview(pill.view)
    motion.pill = pill
    return pill
  }

  private func event(_ type: String, id: String, delta: CGFloat = 0) {
    if recording { events.append(["type": type, "id": id, "delta": delta, "time": CACurrentMediaTime()]) }
  }

  func resetRecording() { events.removeAll(keepingCapacity: true); frameSamples.removeAll(keepingCapacity: true) }

  // Reconcile only on actual camera/data/layout changes. Spatial hashing avoids
  // all-pairs collision checks, and offscreen quotes never allocate native views.
  func reconcile(map: MKMapView) {
    let visible = map.bounds.insetBy(dx: -ClusterLabGeometry.overscan, dy: -ClusterLabGeometry.overscan)
    let candidates = stations.compactMap { station -> LabProjectedStation? in
      let point = map.convert(station.coordinate, toPointTo: map)
      guard point.x.isFinite, point.y.isFinite, visible.contains(point) else { return nil }
      return LabProjectedStation(id: station.id, price: station.price, point: point)
    }
    let nextOwners = ClusterLabGeometry.owners(candidates, previous: owners)
    let previousCounts = Dictionary(grouping: motions.values.filter { $0.settled && $0.owner != $0.station.id }, by: \.owner)
      .mapValues(\.count)
    for id in Array(motions.keys) where nextOwners[id] == nil {
      motions.removeValue(forKey: id)?.pill?.view.removeFromSuperview()
    }
    for station in stations where nextOwners[station.id] != nil {
      let motion = motions[station.id] ?? LabStationMotion(station)
      motions[station.id] = motion
      let nextOwner = nextOwners[station.id]!
      if motion.owner != nextOwner {
        if motion.settled, motion.pill == nil, let oldOwner = motions[motion.owner] {
          // Split: create a 1:1 duplicate at the existing +n before changing it.
          motion.point = oldOwner.station.mapPoint
          motion.offset = ClusterLabGeometry.badgeOffset
          motion.width = ClusterLabGeometry.badgeWidth
          motion.priceMix = 0
          motion.count = max(1, previousCounts[motion.owner] ?? 1)
          _ = makePill(motion)
          event("split-spawn", id: station.id)
        }
        motion.owner = nextOwner
        motion.settled = false
        if nextOwner != station.id { event("merge-start", id: station.id) }
      }
      if !motion.settled && motion.pill == nil { _ = makePill(motion) }
    }
    owners = nextOwners
  }

  @discardableResult
  func render(map: MKMapView, deltaTime: Double) -> Bool {
    var animating = false
    var samples: [[String: Any]] = []
    let reducedMotion = UIAccessibility.isReduceMotionEnabled
    // One main-thread transaction updates positions, glass sizes, text, and
    // handoffs together. No asynchronous animation completions can race a pinch.
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    for id in motions.keys.sorted() {
      guard let motion = motions[id], let owner = motions[motion.owner] else { continue }
      let merged = motion.owner != id
      let targetPoint = merged ? owner.station.mapPoint : motion.station.mapPoint
      let targetOffset = merged ? ClusterLabGeometry.badgeOffset : 0
      let targetWidth = merged ? ClusterLabGeometry.badgeWidth : 84
      let targetMix: CGFloat = merged ? 0 : 1
      if motion.settled {
        motion.point = targetPoint; motion.offset = targetOffset
      }
      var point = project(motion.point, map: map)
      point.x += motion.offset
      let previousRenderedPoint = point
      var target = project(targetPoint, map: map)
      target.x += targetOffset
      let distance = hypot(point.x - target.x, point.y - target.y)
      let error = max(distance, max(abs(targetWidth - motion.width), abs(targetMix - motion.priceMix) * 32))
      let fraction = deltaTime > 0 ? ClusterLabGeometry.fraction(distance: error, deltaTime: deltaTime, reducedMotion: reducedMotion) : 0
      motion.point = MKMapPoint(x: motion.point.x + (targetPoint.x - motion.point.x) * fraction,
                               y: motion.point.y + (targetPoint.y - motion.point.y) * fraction)
      motion.offset += (targetOffset - motion.offset) * fraction
      motion.width += (targetWidth - motion.width) * fraction
      motion.priceMix += (targetMix - motion.priceMix) * fraction
      let arrived = error < 0.12 || reducedMotion
      if arrived {
        motion.point = targetPoint; motion.offset = targetOffset
        motion.width = targetWidth; motion.priceMix = targetMix
      } else { animating = true }
      point = project(motion.point, map: map)
      point.x += motion.offset
      if let pill = motion.pill {
        pill.render(center: point, width: motion.width, priceMix: motion.priceMix, count: motion.count,
                    best: id == stations.first?.id, dark: dark)
        if recording {
          samples.append(["id": id, "x": pill.view.center.x, "y": pill.view.center.y,
                          "width": pill.view.bounds.width, "priceMix": motion.priceMix,
                          "role": merged ? "merge" : (motion.settled ? "price" : "split"),
                          "step": hypot(pill.view.center.x - previousRenderedPoint.x, pill.view.center.y - previousRenderedPoint.y),
                          "contained": container.bounds.contains(pill.view.frame)])
        }
      }
      if arrived && !motion.settled {
        motion.settled = true
        if merged { event("merge-arrive", id: id, delta: distance) }
        else { event("split-handoff", id: id, delta: distance) }
      }
    }

    let joined = Dictionary(grouping: motions.values.filter { $0.settled && $0.owner != $0.station.id }, by: \.owner)
    for ownerId in Array(badges.keys) where joined[ownerId] == nil {
      badges.removeValue(forKey: ownerId)?.view.removeFromSuperview()
    }
    for (ownerId, members) in joined {
      guard let owner = motions[ownerId] else { continue }
      let badge: ClusterLabPill
      if let existing = badges[ownerId] { badge = existing }
      else if let first = members.first(where: { $0.pill != nil }), let pill = first.pill {
        // The first arriving mover becomes the accumulator in place. The effect
        // view never remounts and no duplicate glass surface flashes underneath.
        badge = pill; first.pill = nil; badges[ownerId] = badge
      } else { continue }
      var center = project(owner.station.mapPoint, map: map)
      center.x += ClusterLabGeometry.badgeOffset
      badge.render(center: center, width: 44, priceMix: 0, count: members.count, best: false, dark: dark)
      for member in members where member.pill != nil {
        member.pill?.view.removeFromSuperview(); member.pill = nil
        event("merge-handoff", id: member.station.id)
      }
      if recording {
        samples.append(["id": "badge:\(ownerId)", "x": badge.view.center.x, "y": badge.view.center.y,
                        "width": badge.view.bounds.width, "count": members.count, "role": "badge",
                        "contained": container.bounds.contains(badge.view.frame)])
      }
    }
    CATransaction.commit()
    if recording {
      frameSamples.append(["time": CACurrentMediaTime(), "views": samples,
                           "viewCount": ClusterLabGlass.content(of: container).subviews.count,
                           "stationCount": motions.count, "animating": animating])
    }
    return animating
  }
}
