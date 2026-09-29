import Foundation

// Selection shares the renderer's clock and transaction. Retarget from the
// current size/velocity; there are no view animators or completion callbacks.
final class ClusterLabEmphasis {
  private struct State {
    var target: CGFloat
    var spring: LabSpringBody
  }
  private var states: [String: State] = [:]
  private(set) var selectedId: String?

  func reset() { states.removeAll(); selectedId = nil }

  func select(_ id: String?) {
    guard id != selectedId else { return }
    let previous = selectedId
    selectedId = id
    for key in Set([previous, id].compactMap { $0 }) {
      let old = states[key] ?? State(target: 0, spring: LabSpringBody())
      let target: CGFloat = key == id ? (ClusterLabGeometry.focusedScale - 1) * 100 : 0
      states[key] = State(target: target, spring: LabSpringBody(
        offset: LabVector(x: old.target + old.spring.offset.x - target), velocity: old.spring.velocity))
    }
  }

  func advance(_ deltaTime: Double, reducedMotion: Bool) -> Bool {
    var moving = false
    for id in Array(states.keys) {
      guard var state = states[id] else { continue }
      state.spring.advance(deltaTime * 2, reducedMotion: reducedMotion)
      moving = moving || state.spring.isMoving
      states[id] = state.target == 0 && !state.spring.isMoving ? nil : state
    }
    return moving
  }

  func scale(for id: String, priceMix: CGFloat) -> CGFloat {
    guard let state = states[id] else { return 1 }
    return 1 + (state.target + state.spring.offset.x) * priceMix / 100
  }
}
