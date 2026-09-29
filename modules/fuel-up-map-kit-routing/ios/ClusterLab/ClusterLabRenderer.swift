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

private struct LabPendingRelease {
  let parent: String
  let direction: LabVector
  let speed: CGFloat
  let mass: CGFloat
  let startedAt: Double
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
  var startPoint: MKMapPoint
  var startOffset: CGFloat = 0
  var startWidth: CGFloat = 84
  var startMix: CGFloat = 1
  var elapsed: Double = 0
  var duration: Double = 0.16
  var travel: CGFloat = 0
  var launchSpeed: CGFloat = 0
  var startedAt: Double = 0
  var curveStartedAt: Double = 0
  var reaction = LabSpringBody()
  var displayedReaction = LabVector.zero
  var displayedReactionVelocity = LabVector.zero
  var impactApplied = false
  var contactCatch: LabContactCatch?
  var glassParent: String?
  var pendingRelease: LabPendingRelease?
  var quiet = false
  var clearance: CGFloat = 0
  var startClearance: CGFloat = 0
  var clearanceProgress: CGFloat = 1

  func begin(duration: Double, travel: CGFloat, speed: CGFloat, restarting: Bool = false) {
    startClearance = clearance
    startPoint = point; startOffset = offset; startWidth = width; startMix = priceMix
    elapsed = 0; self.duration = duration; self.travel = travel; launchSpeed = speed
    curveStartedAt = CACurrentMediaTime()
    // A new trajectory starts from the current visible pose. Never carry a
    // delayed clock into a reversal or a camera-end retiming.
    contactCatch = nil
    if !restarting { startedAt = curveStartedAt; impactApplied = false; pendingRelease = nil; glassParent = nil }
  }

  init(_ station: ClusterLabStation) {
    self.station = station; owner = station.id; point = station.mapPoint; startPoint = station.mapPoint
  }
}

final class ClusterLabRenderer {
  private var overviewTransition = false

  func beginOverview() {
    overviewTransition = true
    for motion in motions.values where !motion.settled {
      motion.quiet = true
      motion.begin(duration: min(0.12, motion.duration), travel: motion.travel,
                   speed: motion.launchSpeed, restarting: true)
    }
  }

  func endOverview() { overviewTransition = false }
  let emphasis = ClusterLabEmphasis()
  private let glassGroups = ClusterLabGlassGroups()
  var container: UIView { glassGroups.root }
  private var motions: [String: LabStationMotion] = [:]
  private var badges: [String: ClusterLabPill] = [:]
  private var owners: [String: String] = [:]
  private var badgeOffsetTargets: [String: CGFloat] = [:]
  private var badgeOffsetCarries: [String: (delta: CGFloat, startedAt: Double)] = [:]
  private var renderedBadgeOffsets: [String: CGFloat] = [:]
  private var markets: [String: LabMarketAssessment] = [:]
  private(set) var stations: [ClusterLabStation] = []
  private(set) var events: [[String: Any]] = []
  private(set) var frameSamples: [[String: Any]] = []
  var recording = false
  var dark = false
  var onFocus: ((String) -> Bool)?
  var clusterOwners: [String: String] { owners }

  func station(at point: CGPoint, in source: UIView) -> String? {
    guard !container.isHidden else { return nil }
    let point = source.convert(point, to: container)
    let candidates = motions.compactMap { id, motion in motion.pill.map { (id, $0.view.frame) } } +
      badges.map { ($0.key, $0.value.view.frame) }
    return candidates.filter { $0.1.insetBy(dx: -2, dy: -6).contains(point) }.min {
      let a = ($0.1.contains(point) ? 0.0 : 1000.0) + hypot(point.x - $0.1.midX, point.y - $0.1.midY)
      let b = ($1.1.contains(point) ? 0.0 : 1000.0) + hypot(point.x - $1.1.midX, point.y - $1.1.midY)
      return a == b ? $0.0 < $1.0 : a < b
    }?.0
  }

  private func addFocusAction(_ pill: ClusterLabPill, id: String) {
    pill.view.accessibilityCustomActions = [UIAccessibilityCustomAction(name: "Focus station") { [weak self] _ in
      self?.onFocus?(id) ?? false
    }]
  }
  private var cameraStarted: Double?
  private var previousProjection: [String: CGPoint] = [:]
  private var projectionTime: Double = 0
  private var cameraSpeed: CGFloat = 0
  private var needsInitialLayout = false
  private let locationClearance = ClusterLabLocationClearance()

  func prepareForCameraFit() {
    overviewTransition = false
    emphasis.reset()
    for motion in motions.values { motion.pill?.view.removeFromSuperview() }
    for badge in badges.values { badge.view.removeFromSuperview() }
    motions.removeAll(); badges.removeAll(); owners.removeAll()
    badgeOffsetTargets.removeAll(); badgeOffsetCarries.removeAll(); renderedBadgeOffsets.removeAll()
    previousProjection.removeAll(); projectionTime = 0; cameraSpeed = 0; cameraStarted = nil
    needsInitialLayout = true
    locationClearance.reset()
  }

  func cameraBegan() { cameraStarted = CACurrentMediaTime(); cameraSpeed = 0 }

  func cameraEnded() {
    overviewTransition = false
    cameraStarted = nil
    // Finish alongside the camera's final settling frames. Snapshot the current
    // pose when shortening a flight, so interruptions never jump to a new curve.
    // Use the base duration here: the longer return must not be restarted/cut short.
    for motion in motions.values where !motion.settled && motion.duration - motion.elapsed > 0.08 {
      motion.begin(duration: 0.08, travel: motion.travel, speed: motion.launchSpeed, restarting: true)
    }
  }

  init() { container.isUserInteractionEnabled = false }

  func setStations(_ next: [ClusterLabStation]) {
    let snapshot = next.sorted { $0.price == $1.price ? $0.id < $1.id : $0.price < $1.price }
    guard snapshot != stations else { return }
    // Keep the full search's identity-to-color table, independent of the culled
    // views and current cluster owners. Only new station data can replace it.
    markets = ClusterLabMarket.assess(snapshot.map {
      LabMarketQuote(id: $0.id, latitude: $0.latitude, longitude: $0.longitude, price: $0.price)
    })
    // A data refresh may change price/order; no stale price is retained in a
    // reused pill. Camera state belongs to the map and is left untouched.
    let changed = Set(next.filter { station in motions[station.id]?.station != station }.map(\.id))
    for id in Array(motions.keys) where changed.contains(id) || !next.contains(where: { $0.id == id }) {
      motions.removeValue(forKey: id)?.pill?.view.removeFromSuperview()
    }
    if let id = emphasis.selectedId, !snapshot.contains(where: { $0.id == id }) { emphasis.select(nil) }
    stations = snapshot
  }

  private func project(_ point: MKMapPoint, map: MKMapView) -> CGPoint {
    let point = map.convert(point.coordinate, toPointTo: map)
    return CGPoint(x: point.x + ClusterLabGeometry.containerPadding,
                   y: point.y + ClusterLabGeometry.containerPadding)
  }

  private func badgeOffset(for owner: String, at time: Double) -> CGFloat {
    var offset = badgeOffsetTargets[owner] ?? ClusterLabGeometry.badgeOffset
    if let carry = badgeOffsetCarries[owner] {
      // Preserve count position at membership changes; ordinary zooming tracks
      // the map directly. This short correction has no additional rebound.
      let t = min(1, max(0, (time - carry.startedAt) / 0.08))
      let smooth = t * t * t * (t * (t * 6 - 15) + 10)
      offset += carry.delta * (1 - smooth)
    }
    let extra = 42 * (emphasis.scale(for: owner, priceMix: 1) - 1)
    return min(ClusterLabGeometry.badgeOffset + ClusterLabGeometry.maximumBadgeStretch,
               max(ClusterLabGeometry.badgeOffset, offset)) + extra
  }

  private func makePill(_ motion: LabStationMotion) -> ClusterLabPill {
    let pill = ClusterLabPill(price: motion.station.price, name: motion.station.name)
    addFocusAction(pill, id: motion.station.id)
    glassGroups.insert(pill.view)
    motion.pill = pill
    return pill
  }

  private func tintOwner(for id: String) -> String {
    var current = id
    var visited = Set<String>()
    // Include outward-moving duplicates while the native glass neck remains.
    // Following the parent also handles a cluster merging into another cluster.
    while visited.insert(current).inserted, let motion = motions[current] {
      let parent = motion.owner != current ? motion.owner : motion.glassParent ?? motion.pendingRelease?.parent
      guard let parent, motions[parent] != nil else { break }
      current = parent
    }
    return current
  }

  private func event(_ type: String, id: String, delta: CGFloat = 0, duration: Double = 0, details: [String: Any] = [:]) {
    if recording {
      var entry: [String: Any] = ["type": type, "id": id, "delta": delta, "duration": duration, "time": CACurrentMediaTime()]
      entry.merge(details) { _, value in value }
      events.append(entry)
    }
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
    let now = CACurrentMediaTime()
    let interval = now - projectionTime
    if interval > 0.004 && interval < 0.25 {
      let speed = candidates.compactMap { candidate -> CGFloat? in
        guard let old = previousProjection[candidate.id] else { return nil }
        return hypot(candidate.point.x - old.x, candidate.point.y - old.y) / interval
      }.max() ?? 0
      cameraSpeed = cameraSpeed * 0.3 + speed * 0.7
    }
    if interval > 0.004 {
      previousProjection = Dictionary(uniqueKeysWithValues: candidates.map { ($0.id, $0.point) })
      projectionTime = now
    }
    let nextOwners = ClusterLabGeometry.owners(candidates, previous: owners, selectedId: emphasis.selectedId)
    let nextMasses = Dictionary(grouping: nextOwners.keys, by: { nextOwners[$0]! }).mapValues(\.count)
    let positions = Dictionary(uniqueKeysWithValues: candidates.map { ($0.id, $0.point) })
    var nextBadgeOffsets: [String: CGFloat] = [:]
    for candidate in candidates {
      guard let owner = nextOwners[candidate.id], owner != candidate.id,
            let center = positions[owner] else { continue }
      let stretch = ClusterLabGeometry.badgeStretch(separation:
        CGPoint(x: candidate.point.x - center.x, y: candidate.point.y - center.y))
      nextBadgeOffsets[owner] = max(nextBadgeOffsets[owner] ?? ClusterLabGeometry.badgeOffset,
                                   ClusterLabGeometry.badgeOffset + stretch)
    }
    let changedGroups = Set(Set(nextOwners.keys).union(owners.keys).filter { nextOwners[$0] != owners[$0] }
      .flatMap { [nextOwners[$0], owners[$0]].compactMap { $0 } })
    for owner in changedGroups {
      if let previous = renderedBadgeOffsets[owner], let target = nextBadgeOffsets[owner] {
        let extra = 42 * (emphasis.scale(for: owner, priceMix: 1) - 1)
        badgeOffsetCarries[owner] = (previous - target - extra, now)
      }
    }
    badgeOffsetTargets = nextBadgeOffsets
    badgeOffsetCarries = badgeOffsetCarries.filter { nextBadgeOffsets[$0.key] != nil && now - $0.value.startedAt < 0.08 }
    if needsInitialLayout {
      needsInitialLayout = false
      let byId = Dictionary(uniqueKeysWithValues: stations.map { ($0.id, $0) })
      for station in stations {
        guard let ownerId = nextOwners[station.id], let owner = byId[ownerId] else { continue }
        let motion = LabStationMotion(station)
        motion.owner = ownerId; motion.point = owner.mapPoint; motion.settled = true
        motions[station.id] = motion
        if ownerId == station.id { _ = makePill(motion) }
        else if badges[ownerId] == nil {
          let badge = ClusterLabPill(price: owner.price, name: owner.name)
          addFocusAction(badge, id: ownerId)
          glassGroups.insert(badge.view); badges[ownerId] = badge
        }
      }
      owners = nextOwners
      return
    }
    var releases: [(child: String, parent: String, direction: LabVector, speed: CGFloat)] = []
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
        let oldOwnerId = motion.owner
        let wasConnected = oldOwnerId != station.id && (motion.settled || motion.impactApplied)
        if motion.pill != nil {
          // A reversal inherits the pose/velocity actually displayed, including
          // its former cluster's recoil. It never jumps back to a bare map pin.
          motion.reaction = LabSpringBody(offset: motion.displayedReaction, velocity: motion.displayedReactionVelocity)
        }
        if motion.settled, motion.pill == nil, let oldOwner = motions[motion.owner] {
          // Split: create a 1:1 duplicate at the existing +n before changing it.
          motion.reaction = oldOwner.reaction
          motion.point = oldOwner.station.mapPoint
          motion.offset = renderedBadgeOffsets[motion.owner] ?? ClusterLabGeometry.badgeOffset
          if let badge = badges[motion.owner] {
            // Duplicate the stretched count exactly where it is rendered.
            // Remove the shared recoil before converting its base to MapKit.
            let center = CGPoint(x: badge.view.center.x - oldOwner.reaction.offset.x,
                                 y: badge.view.center.y - oldOwner.reaction.offset.y)
            let viewportPoint = CGPoint(x: center.x - ClusterLabGeometry.containerPadding,
                                        y: center.y - ClusterLabGeometry.containerPadding)
            motion.point = MKMapPoint(map.convert(viewportPoint, toCoordinateFrom: map))
            motion.offset = 0
          }
          motion.width = ClusterLabGeometry.badgeWidth
          motion.priceMix = 0
          motion.count = max(1, previousCounts[motion.owner] ?? 1)
          let pill = makePill(motion)
          motion.clearance = oldOwner.clearance
          pill.view.transform = CGAffineTransform(translationX: 0, y: motion.clearance)
          var center = project(motion.point, map: map)
          center.x += motion.offset + motion.reaction.offset.x
          center.y += motion.reaction.offset.y
          pill.render(center: center, width: motion.width, priceMix: 0,
                      count: motion.count, market: markets[motion.owner] ?? .unknown, dark: dark)
          let source = badges[motion.owner]?.view.center ?? center
          let sourceFrame = badges[motion.owner]?.view.frame ?? pill.view.frame
          event("split-spawn", id: station.id, delta: hypot(pill.view.center.x - source.x, pill.view.center.y - source.y),
                details: ["renderedDelta": hypot(pill.view.frame.midX - sourceFrame.midX, pill.view.frame.midY - sourceFrame.midY)])
        }
        let destination = stations.first { $0.id == nextOwner }!.mapPoint
        let start = project(motion.point, map: map)
        let end = project(destination, map: map)
        let nextOffset = nextOwner == station.id ? 0 : badgeOffset(for: nextOwner, at: now)
        let travel = hypot(end.x + nextOffset - start.x - motion.offset, end.y - start.y)
        let duration = ClusterLabGeometry.duration(distance: travel, speed: cameraSpeed,
          movementDuration: cameraStarted.map { now - $0 } ?? 0.16)
        if wasConnected && nextOwners[oldOwnerId] != nextOwner {
          let direction = LabVector(x: end.x + nextOffset - start.x - motion.offset,
                                    y: end.y - start.y)
          releases.append((station.id, oldOwnerId, direction * (1 / max(1, direction.length)),
                           min(900, 360 + cameraSpeed * 0.35 + travel * 1.5)))
        }
        motion.begin(duration: duration, travel: travel, speed: cameraSpeed)
        motion.quiet = overviewTransition
        motion.owner = nextOwner
        motion.settled = false
        if nextOwner != station.id { event("merge-start", id: station.id) }
      }
      if !motion.settled && motion.pill == nil { _ = makePill(motion) }
    }
    for release in releases {
      guard motions[release.parent] != nil, let child = motions[release.child] else { continue }
      let mass = CGFloat(nextMasses[release.parent] ?? 1)
      child.glassParent = release.parent
      child.pendingRelease = LabPendingRelease(parent: release.parent, direction: release.direction,
        speed: release.speed, mass: mass, startedAt: now)
      event("split-stretch", id: release.child, details: ["owner": release.parent])
    }
    owners = nextOwners
  }

  @discardableResult
  func render(map: MKMapView, deltaTime: Double) -> Bool {
    var animating = false
    var samples: [[String: Any]] = []
    var previousRenderedCenters: [ObjectIdentifier: CGPoint] = [:]
    if recording {
      for pill in motions.values.compactMap(\.pill) + Array(badges.values) {
        previousRenderedCenters[ObjectIdentifier(pill.view)] = CGPoint(x: pill.view.frame.midX, y: pill.view.frame.midY)
      }
    }
    let reducedMotion = UIAccessibility.isReduceMotionEnabled
    let now = CACurrentMediaTime()
    if reducedMotion { badgeOffsetCarries.removeAll() }
    badgeOffsetCarries = badgeOffsetCarries.filter { now - $0.value.startedAt < 0.08 }
    let emphasisMoving = emphasis.advance(deltaTime, reducedMotion: reducedMotion)
    renderedBadgeOffsets = Dictionary(uniqueKeysWithValues: badgeOffsetTargets.keys.map {
      ($0, badgeOffset(for: $0, at: now))
    })
    animating = emphasisMoving || !badgeOffsetCarries.isEmpty
    for motion in motions.values {
      if reducedMotion { motion.pendingRelease = nil }
      if motion.owner == motion.station.id || !motion.settled {
        motion.reaction.advance(deltaTime, reducedMotion: reducedMotion)
      } else { motion.reaction = LabSpringBody() }
    }
    var connectedMasses = Dictionary(grouping: motions.values.filter {
      $0.owner != $0.station.id && ($0.settled || $0.impactApplied)
    }, by: \.owner).mapValues { $0.count + 1 }
    // One main-thread transaction updates positions, glass sizes, text, and
    // handoffs together. No asynchronous animation completions can race a pinch.
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    for id in motions.keys.sorted() {
      guard let motion = motions[id], let owner = motions[motion.owner] else { continue }
      let merged = motion.owner != id
      let targetPoint = merged ? owner.station.mapPoint : motion.station.mapPoint
      let targetOffset = merged ? (renderedBadgeOffsets[motion.owner] ?? ClusterLabGeometry.badgeOffset) : 0
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
      if deltaTime > 0 { motion.elapsed = max(0, CACurrentMediaTime() - motion.curveStartedAt) }
      var start = motion.settled ? target : project(motion.startPoint, map: map)
      if !motion.settled { start.x += motion.startOffset }
      let projectedTravel = hypot(target.x - start.x, target.y - start.y)
      let contactDelay = !motion.settled && merged && !reducedMotion && !motion.quiet ?
        (motion.contactCatch?.delay(at: motion.elapsed) ?? 0) : 0
      let quietTime = CGFloat(min(1, max(0, motion.elapsed / max(motion.duration, 0.001))))
      let quietProgress = quietTime * quietTime * quietTime * (quietTime * (quietTime * 6 - 15) + 10)
      let unresistedProgress = motion.settled ? 1 : motion.quiet ? quietProgress : ClusterLabGeometry.progress(
        elapsed: motion.elapsed, duration: motion.duration, distance: projectedTravel, speed: motion.launchSpeed)
      let delayedProgress = motion.settled ? 1 : motion.quiet ? quietProgress : ClusterLabGeometry.progress(
        elapsed: motion.elapsed - contactDelay, duration: motion.duration, distance: projectedTravel, speed: motion.launchSpeed)
      let progress = LabContactCatch.resistedProgress(unresisted: unresistedProgress,
        delayed: delayedProgress, distance: projectedTravel)
      motion.clearanceProgress = min(1, max(0, progress))
      motion.point = MKMapPoint(x: motion.startPoint.x + (targetPoint.x - motion.startPoint.x) * progress,
                               y: motion.startPoint.y + (targetPoint.y - motion.startPoint.y) * progress)
      motion.offset = motion.startOffset + (targetOffset - motion.startOffset) * progress
      motion.width = motion.startWidth + (targetWidth - motion.startWidth) * progress
      motion.priceMix = min(1, max(0, motion.startMix + (targetMix - motion.startMix) * progress))
      let completion = motion.quiet ? motion.duration : ClusterLabGeometry.completionDuration(for: motion.duration)
      let arrived = motion.settled || motion.elapsed >= completion || (motion.startedAt == 0 && error < 0.001) || reducedMotion
      if arrived {
        motion.point = targetPoint; motion.offset = targetOffset
        motion.width = targetWidth; motion.priceMix = targetMix
      } else { animating = true }
      point = project(motion.point, map: map)
      point.x += motion.offset
      if merged && !motion.settled && !motion.impactApplied && deltaTime > 0 && progress >= 0.25 && !reducedMotion && !motion.quiet {
        // The impact happens on contact, not after the travelling pill vanishes.
        let contactX = abs(point.x + motion.reaction.offset.x - target.x - owner.reaction.offset.x)
        let contactY = abs(point.y + motion.reaction.offset.y - target.y - owner.reaction.offset.y)
        if contactX <= (motion.width + ClusterLabGeometry.badgeWidth) / 2 + ClusterLabGeometry.impactSpacing &&
           contactY <= ClusterLabGeometry.pillSize.height + ClusterLabGeometry.impactSpacing {
          motion.contactCatch = LabContactCatch(elapsed: motion.elapsed, outwardDuration: motion.duration * 0.68)
          if let contact = motion.contactCatch, contact.duration > 0 {
            event("contact-catch", id: id, duration: contact.duration,
                  details: ["owner": motion.owner])
          }
          let incoming = (LabVector(x: point.x - previousRenderedPoint.x, y: point.y - previousRenderedPoint.y) *
            (1 / CGFloat(deltaTime)) + motion.reaction.velocity).limited(to: 1200)
          let mass = CGFloat(connectedMasses[motion.owner] ?? 1)
          connectedMasses[motion.owner] = Int(mass) + 1
          let shared = ClusterLabDynamics.mergedVelocity(target: owner.reaction.velocity,
            incoming: incoming * ClusterLabDynamics.connectionVelocityRetention, targetMass: mass)
          // Both connected surfaces inherit the same impact velocity. Native
          // glass continues to merge them inside their shared native container.
          let common = motion.reaction.limitedVelocity(owner.reaction.limitedVelocity(shared))
          owner.reaction.velocity = common
          motion.reaction.velocity = common
          motion.impactApplied = true
          event("merge-impulse", id: id, delta: common.length,
                details: ["owner": motion.owner, "targetMass": mass,
                          "incomingX": incoming.x, "incomingY": incoming.y,
                          "sharedX": common.x, "sharedY": common.y])
        }
      }
      let carry = merged ? min(1, max(0, progress)) : 0
      let reaction = motion.reaction.offset * (1 - carry) + owner.reaction.offset * carry
      motion.displayedReaction = reaction
      motion.displayedReactionVelocity = motion.reaction.velocity * (1 - carry) + owner.reaction.velocity * carry
      let basePoint = point
      point.x += reaction.x; point.y += reaction.y
      if let pill = motion.pill {
        let previousCenter = pill.view.bounds.isEmpty ? point : pill.view.center
        let marketId = tintOwner(for: id)
        pill.view.accessibilityTraits = emphasis.selectedId == id && motion.priceMix > 0.5 ? [.selected] : []
        pill.render(center: point, width: motion.width, priceMix: motion.priceMix, count: motion.count,
                    market: nil, dark: dark, scale: emphasis.scale(for: id, priceMix: motion.priceMix))
        if arrived && merged { pill.view.transform = CGAffineTransform(translationX: 0, y: owner.clearance) }
        if recording {
          // Compare the actual view with the original trajectory in the same
          // map projection, so the probe proves visible resistance at contact.
          let unresistedMapPoint = MKMapPoint(
            x: motion.startPoint.x + (targetPoint.x - motion.startPoint.x) * unresistedProgress,
            y: motion.startPoint.y + (targetPoint.y - motion.startPoint.y) * unresistedProgress)
          var unresisted = project(unresistedMapPoint, map: map)
          unresisted.x += motion.startOffset + (targetOffset - motion.startOffset) * unresistedProgress
          samples.append(["id": id, "x": pill.view.center.x, "y": pill.view.center.y,
                          "width": pill.view.bounds.width, "height": pill.view.bounds.height, "priceMix": motion.priceMix,
                          "tintScore": pill.tintScore, "tintUpdates": pill.tintUpdateCount,
                          "materialTint": pill.materialTint,
                          "tintOwner": marketId, "clusterOwner": motion.owner,
                          "releaseParent": motion.pendingRelease?.parent ?? "",
                          "quiet": motion.quiet, "progress": progress,
                          "rebound": max(0, ((basePoint.x - target.x) * (target.x - start.x) +
                            (basePoint.y - target.y) * (target.y - start.y)) / max(projectedTravel, 0.001)),
                          "reactionX": reaction.x, "reactionY": reaction.y,
                          "contactDelay": contactDelay,
                          "unresistedX": unresisted.x, "unresistedY": unresisted.y,
                          "homeX": target.x, "homeY": target.y, "baseX": basePoint.x, "baseY": basePoint.y,
                          "primary": !merged,
                          "role": merged ? "merge" : (motion.settled ? "price" : "split"),
                          "step": hypot(pill.view.center.x - previousCenter.x, pill.view.center.y - previousCenter.y),
                          "contained": container.bounds.contains(pill.view.frame)])
        }
      }
      if arrived && !motion.settled {
        motion.settled = true
        let handoffDelta = hypot(point.x - target.x - reaction.x, point.y - target.y - reaction.y)
        let duration = motion.startedAt == 0 ? 0 : CACurrentMediaTime() - motion.startedAt
        if merged { event("merge-arrive", id: id, delta: handoffDelta, duration: duration) }
        else { event("split-handoff", id: id, delta: handoffDelta, duration: duration) }
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
        addFocusAction(badge, id: ownerId)
      } else { continue }
      var center = project(owner.station.mapPoint, map: map)
      let attachmentOffset = renderedBadgeOffsets[ownerId] ?? ClusterLabGeometry.badgeOffset
      center.x += attachmentOffset + owner.reaction.offset.x
      center.y += owner.reaction.offset.y
      badge.render(center: center, width: 44, priceMix: 0, count: members.count, market: nil, dark: dark)
      for member in members where member.pill != nil {
        let moverCenter = member.pill!.view.center
        let handoffDelta = hypot(moverCenter.x - badge.view.center.x, moverCenter.y - badge.view.center.y)
        // Match the accumulator's content as well as its geometry in this same
        // transaction before releasing the temporary native effect view.
        member.pill?.render(center: moverCenter, width: 44, priceMix: 0, count: members.count, market: nil, dark: dark)
        member.pill?.view.transform = badge.view.transform
        let renderedDelta = hypot(member.pill!.view.frame.midX - badge.view.frame.midX,
                                  member.pill!.view.frame.midY - badge.view.frame.midY)
        member.pill?.view.removeFromSuperview(); member.pill = nil
        event("merge-handoff", id: member.station.id, delta: handoffDelta, details: ["renderedDelta": renderedDelta])
      }
      if recording {
        samples.append(["id": "badge:\(ownerId)", "x": badge.view.center.x, "y": badge.view.center.y,
                        "width": badge.view.bounds.width, "count": members.count, "role": "badge",
                        "attachmentOffset": attachmentOffset, "priceMix": 0,
                        "tintScore": badge.tintScore, "tintUpdates": badge.tintUpdateCount,
                        "materialTint": badge.materialTint,
                        "tintOwner": tintOwner(for: ownerId), "clusterOwner": ownerId, "releaseParent": "",
                        "reactionX": owner.reaction.offset.x, "reactionY": owner.reaction.offset.y,
                        "contained": container.bounds.contains(badge.view.frame)])
      }
    }
    // First let the existing native glass surfaces pull apart. Apply the same
    // balanced recoil only after visible edge separation, not at membership
    // change while the two copies still occupy the exact same position.
    if deltaTime > 0 {
      for id in motions.keys.sorted() {
        guard let child = motions[id], let release = child.pendingRelease else { continue }
        guard !reducedMotion, let parent = motions[release.parent],
              let childView = child.pill?.view, let parentView = parent.pill?.view else {
          child.pendingRelease = nil
          continue
        }
        var gap = ClusterLabGeometry.capsuleGap(childView.frame, parentView.frame)
        if let badge = badges[release.parent] {
          gap = min(gap, ClusterLabGeometry.capsuleGap(childView.frame, badge.view.frame))
        }
        let age = CACurrentMediaTime() - release.startedAt
        if recording, let index = samples.firstIndex(where: { $0["id"] as? String == id }) {
          samples[index]["stretchGap"] = gap
          samples[index]["stretchAge"] = age
        }
        guard (gap >= ClusterLabGeometry.glassSpacing * 0.75 && age >= 0.025) || child.settled else { continue }
        if child.quiet { child.pendingRelease = nil; continue }
        let before = parent.reaction.velocity * release.mass + child.reaction.velocity
        let oldParentVelocity = parent.reaction.velocity, oldChildVelocity = child.reaction.velocity
        _ = ClusterLabDynamics.release(parent: &parent.reaction, child: &child.reaction,
          direction: release.direction, speed: release.speed, remainingMass: release.mass)
        parent.displayedReactionVelocity = parent.displayedReactionVelocity + parent.reaction.velocity - oldParentVelocity
        child.displayedReactionVelocity = child.displayedReactionVelocity + child.reaction.velocity - oldChildVelocity
        let after = parent.reaction.velocity * release.mass + child.reaction.velocity
        event("split-impulse", id: id, delta: (after - before).length,
          details: ["owner": release.parent, "remainingMass": release.mass,
                    "gap": gap, "stretchDuration": age, "arrived": child.settled])
        child.pendingRelease = nil
      }
    }
    animating = animating || motions.values.contains {
      $0.pendingRelease != nil || (($0.owner == $0.station.id || !$0.settled) && $0.reaction.isMoving)
    }
    var renderedPills: [String: ClusterLabPill] = [:]
    for (id, motion) in motions { if let pill = motion.pill { renderedPills[id] = pill } }
    for (id, badge) in badges { renderedPills["badge:\(id)"] = badge }
    let renderedViews = renderedPills.mapValues(\.view)
    let dot: CGPoint? = map.showsUserLocation && map.userLocation.location != nil && map.isUserLocationVisible ?
      project(MKMapPoint(map.userLocation.coordinate), map: map) : nil
    var groupFrames: [String: CGRect] = [:]
    for (id, motion) in motions where motion.owner == id {
      guard let pill = motion.pill else { continue }
      // Untransformed frames keep avoidance separate from map projection and
      // the approved springs. Never feed the previous nudge back into its solve.
      var frame = CGRect(x: pill.view.center.x - pill.view.bounds.width / 2,
                         y: pill.view.center.y - pill.view.bounds.height / 2,
                         width: pill.view.bounds.width, height: pill.view.bounds.height)
      if let badge = badges[id] {
        frame = frame.union(CGRect(x: badge.view.center.x - 22, y: badge.view.center.y - 16, width: 44, height: 32))
      }
      groupFrames[id] = frame
    }
    let safeBounds = map.bounds.inset(by: map.safeAreaInsets).insetBy(dx: 15, dy: 15)
      .offsetBy(dx: ClusterLabGeometry.containerPadding, dy: ClusterLabGeometry.containerPadding)
    let clearance = locationClearance.update(frames: groupFrames, dot: dot, bounds: safeBounds,
                                             deltaTime: deltaTime, reducedMotion: reducedMotion)
    animating = animating || clearance.moving
    for motion in motions.values {
      let target = clearance.offsets[motion.owner] ?? 0
      motion.clearance = motion.settled || reducedMotion ? target :
        motion.startClearance + (target - motion.startClearance) * motion.clearanceProgress
      motion.pill?.view.transform = CGAffineTransform(translationX: 0, y: motion.clearance)
    }
    for (id, badge) in badges {
      badge.view.transform = CGAffineTransform(translationX: 0, y: clearance.offsets[id] ?? 0)
    }
    // A departing duplicate stays in its original glass family through the
    // native neck's remaining reach, independently of the recoil trigger.
    for motion in motions.values where motion.glassParent != nil {
      guard let parentId = motion.glassParent, let child = motion.pill?.view,
            let parent = motions[parentId]?.pill?.view else {
        motion.glassParent = nil; continue
      }
      let gap = min(ClusterLabGeometry.capsuleGap(child.frame, parent.frame),
                    badges[parentId].map { ClusterLabGeometry.capsuleGap(child.frame, $0.view.frame) } ?? .infinity)
      if gap > ClusterLabGeometry.glassSpacing && motion.pendingRelease == nil { motion.glassParent = nil }
    }
    let logicalTints = Dictionary(uniqueKeysWithValues: renderedPills.keys.map { key in
      (key, tintOwner(for: key.hasPrefix("badge:") ? String(key.dropFirst(6)) : key))
    })
    // Native glass starts connecting before logical membership changes. Derive
    // those preview families from the parent PRICE anchors on the map, never
    // from a nearby count capsule, recoil, or location-avoidance displacement.
    let familyFrames = Dictionary(uniqueKeysWithValues: Set(logicalTints.values).compactMap { id -> (String, CGRect)? in
      guard let motion = motions[id] else { return nil }
      let center = project(motion.station.mapPoint, map: map)
      let size = motion.pill?.view.bounds.size ?? ClusterLabGeometry.pillSize
      return (id, CGRect(x: center.x - size.width / 2, y: center.y - size.height / 2,
                         width: size.width, height: size.height))
    })
    let previews = ClusterLabGlassGrouping.layout(familyFrames.map {
      LabGlassItem(id: $0.key, frame: $0.value)
    }, previous: [:]).connections
    let connections = glassGroups.update(renderedViews, families: logicalTints.mapValues { previews[$0] ?? $0 })
    // Glass connectivity controls only morphing, never a station's market color.
    // A surface showing a price keeps that station's global tint. Only +N
    // content inherits the representative parent's tint, including split copies.
    let visibleTints = Dictionary(uniqueKeysWithValues: renderedPills.keys.map { id in
      let owner = id.hasPrefix("badge:") ? String(id.dropFirst(6)) :
        ((motions[id]?.priceMix ?? 0) > 0 ? id : logicalTints[id] ?? id)
      return (id, owner)
    })
    for (id, pill) in renderedPills { pill.applyMarket(markets[visibleTints[id] ?? id] ?? .unknown) }
    if recording {
      // Handoffs are recorded as events; frame samples describe surviving views.
      samples.removeAll { renderedViews[$0["id"] as? String ?? ""] == nil }
      for index in samples.indices {
        if let id = samples[index]["id"] as? String, let view = renderedViews[id] {
          if let pill = renderedPills[id], let connection = connections[id] {
            samples[index]["logicalTintOwner"] = logicalTints[id]
            samples[index]["glassConnection"] = connection
            samples[index]["tintOwner"] = visibleTints[id]
            if let family = logicalTints[id], let anchor = familyFrames[family] {
              samples[index]["glassFamily"] = previews[family] ?? family
              samples[index]["familyAnchor"] = ["x": anchor.midX, "y": anchor.midY,
                "width": anchor.width, "height": anchor.height]
            }
            samples[index]["tintScore"] = pill.tintScore
            samples[index]["tintUpdates"] = pill.tintUpdateCount
            samples[index]["materialTint"] = pill.materialTint
          }
          samples[index]["glassGroup"] = glassGroups.group(of: view)
          samples[index]["clearanceY"] = view.transform.ty
          samples[index]["x"] = view.frame.midX
          samples[index]["y"] = view.frame.midY
          if let previous = previousRenderedCenters[ObjectIdentifier(view)] {
            samples[index]["step"] = hypot(view.frame.midX - previous.x, view.frame.midY - previous.y)
          }
          samples[index]["contained"] = container.bounds.contains(view.frame)
        }
      }
    }
    CATransaction.commit()
    if recording {
      frameSamples.append(["time": CACurrentMediaTime(), "views": samples,
                           "viewCount": glassGroups.pillCount, "glassGroupCount": glassGroups.groupCount,
                           "glassMaterialResets": glassGroups.materialResetCount,
                           "stationCount": motions.count, "animating": animating,
                           "selectedId": emphasis.selectedId ?? "",
                           "userLocation": dot.map { ["x": $0.x, "y": $0.y] } ?? [:]])
    }
    return animating
  }
}
