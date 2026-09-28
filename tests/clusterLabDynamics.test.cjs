const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

test('native cluster masses exchange momentum and return stably at different frame rates', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'fuelup-cluster-dynamics-'));
    try {
        const main = path.join(directory, 'main.swift');
        writeFileSync(main, `import Foundation
// Contact resistance remains monotonic and rejoins the untouched clock before
// the rebound. Very late contacts and delayed frames cannot extend the flight.
for outward in [0.0544, 0.1088, 0.1496] {
  for elapsed in [0.0, outward * 0.4, outward - 0.001, outward, outward + 0.01] {
    let contact = LabContactCatch(elapsed: elapsed, outwardDuration: outward)
    assert(contact.duration >= 0 && contact.duration <= 0.065)
    assert(contact.delay(at: elapsed) == 0 && contact.delay(at: outward) == 0)
    assert(contact.delay(at: outward + 1) == 0)
    var previous = elapsed
    for step in 1...1000 {
      let now = elapsed + Double(step) * max(contact.duration, 0.001) / 1000
      let adjusted = now - contact.delay(at: now)
      assert(adjusted > previous && adjusted <= now)
      assert(contact.delay(at: now) <= 0.014301)
      previous = adjusted
    }
    if contact.duration > 0.01 {
      let tiny = contact.duration * 0.00001
      assert(contact.delay(at: elapsed + tiny) / tiny < 0.000001)
      assert(contact.delay(at: elapsed + contact.duration - tiny) / tiny < 0.000001)
      assert(contact.delay(at: elapsed + contact.duration / 2) > contact.duration * 0.21)
    }
  }
}
for duration in [0.08, 0.16, 0.22] {
  for distance in [CGFloat(1), 80, 400, 1500] {
    let contact = LabContactCatch(elapsed: duration * 0.2, outwardDuration: duration * 0.68)
    var previous: CGFloat = 0
    for step in 0...1000 {
      let now = Double(step) * duration * 0.68 / 1000
      let original = ClusterLabGeometry.progress(elapsed: now, duration: duration, distance: distance, speed: 1200)
      let delayed = ClusterLabGeometry.progress(elapsed: now - contact.delay(at: now), duration: duration, distance: distance, speed: 1200)
      let resisted = LabContactCatch.resistedProgress(unresisted: original, delayed: delayed, distance: distance)
      assert(resisted >= previous - 0.0000001 && resisted <= original)
      assert((original - resisted) * distance <= 6.000001)
      if now >= contact.startedAt + contact.duration { assert(abs(original - resisted) < 0.000001) }
      previous = resisted
    }
  }
}
let incoming = LabVector(x: 800, y: -200), resting = LabVector.zero
let shared = ClusterLabDynamics.mergedVelocity(target: resting, incoming: incoming, targetMass: 3)
assert((shared * 4 - incoming).length < 0.000001)
assert(shared.x > 0 && shared.y < 0)
let heavy = ClusterLabDynamics.mergedVelocity(target: resting, incoming: incoming, targetMass: 8)
assert(heavy.length < shared.length)
var parent = LabSpringBody(offset: .init(x: 2, y: -1), velocity: .init(x: 10, y: 5))
var child = parent
let before = parent.velocity * 4 + child.velocity
_ = ClusterLabDynamics.release(parent: &parent, child: &child, direction: .init(x: 1), speed: 600, remainingMass: 4)
assert((parent.velocity * 4 + child.velocity - before).length < 0.000001)
assert(parent.velocity.x < 10 && child.velocity.x > 10)
assert(abs((child.velocity.x - 10) / (10 - parent.velocity.x) - 4) < 0.000001)
// Even a very large release uses one shared cap, keeping momentum balanced.
for _ in 0..<100 {
  let before = parent.velocity * 4 + child.velocity
  _ = ClusterLabDynamics.release(parent: &parent, child: &child, direction: .init(x: 1), speed: 10000, remainingMass: 4)
  assert((parent.velocity * 4 + child.velocity - before).length < 0.000001)
}
var slow = LabSpringBody(velocity: .init(x: 500, y: -100))
var fast = slow
var peak: CGFloat = 0
for _ in 0..<120 {
  slow.advance(1.0 / 60)
  fast.advance(1.0 / 120); fast.advance(1.0 / 120)
  assert((slow.offset - fast.offset).length < 0.04)
  assert(slow.offset.length <= LabSpringBody.maximumDisplacement)
  peak = max(peak, slow.offset.length)
}
assert(peak > 10 && !slow.isMoving && slow.offset == .zero)
var delayed = LabSpringBody(velocity: .init(x: 500))
delayed.advance(2)
assert(!delayed.isMoving)
var reduced = LabSpringBody(offset: .init(x: 10), velocity: .init(x: 500))
reduced.advance(0, reducedMotion: true)
assert(reduced.offset == .zero && reduced.velocity == .zero)
print("native dynamics passed")
`);
        const binary = path.join(directory, 'dynamics-test');
        execFileSync('swiftc', ['modules/fuel-up-map-kit-routing/ios/ClusterLab/ClusterLabDynamics.swift',
            'modules/fuel-up-map-kit-routing/ios/ClusterLab/ClusterLabGeometry.swift', main, '-o', binary]);
        assert.match(execFileSync(binary, { encoding: 'utf8' }), /native dynamics passed/);
    } finally { rmSync(directory, { recursive: true, force: true }); }
});
