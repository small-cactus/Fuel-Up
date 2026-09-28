const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

test('native clustering preserves identities, boundary hysteresis, and gesture-timed motion', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'fuelup-glass-geometry-'));
    try {
        const main = path.join(directory, 'main.swift');
        writeFileSync(main, `import Foundation
func station(_ id: String, _ price: Double, _ x: Double, _ y: Double = 0) -> LabProjectedStation {
  LabProjectedStation(id: id, price: price, point: CGPoint(x: x, y: y))
}
let separate = [station("a", 3, 0), station("b", 4, 120)]
assert(ClusterLabGeometry.owners(separate, previous: [:]) == ["a": "a", "b": "b"])
let contact = [station("a", 3, 0), station("b", 4, 83), station("c", 5, 162)]
let merged = ClusterLabGeometry.owners(contact, previous: [:])
assert(merged == ["a": "a", "b": "a", "c": "a"])
assert(ClusterLabGeometry.owners(Array(contact.reversed()), previous: [:]) == merged)
let boundary = [station("a", 3, 0), station("b", 4, 105)]
assert(ClusterLabGeometry.owners(boundary, previous: merged)["b"] == "a")
assert(ClusterLabGeometry.owners(boundary, previous: [:])["b"] == "b")
assert(ClusterLabGeometry.owners(separate, previous: merged)["b"] == "b")
assert(ClusterLabGeometry.owners([station("b", 3, 0), station("a", 3, 0)], previous: [:])["b"] == "a")
assert(ClusterLabGeometry.owners([station("a", 3, -104), station("b", 4, -21)], previous: [:])["b"] == "a")
for distance in stride(from: 0.1, through: 1000, by: 0.5) {
  for speed in [CGFloat(0), 200, 1000, 5000] {
    let duration = ClusterLabGeometry.duration(distance: distance, speed: speed, movementDuration: 0.18)
    assert(duration >= 0.08 && duration <= 0.18)
    assert(ClusterLabGeometry.progress(elapsed: 0, duration: duration, distance: distance, speed: speed) == 0)
    assert(ClusterLabGeometry.progress(elapsed: duration, duration: duration, distance: distance, speed: speed) == 1)
    for t in stride(from: 0.0, through: duration, by: duration / 100) {
      let p = ClusterLabGeometry.progress(elapsed: t, duration: duration, distance: distance, speed: speed)
      assert(p >= 0 && (p - 1) * distance <= 18.000001)
    }
    // At 60 and 120 Hz the exact destination is reached within one frame of
    // the same deadline, even after a delayed frame. No distance-based tail.
    for dt in [1.0/120, 1.0/60, 0.1] {
      let finish = ceil(duration / dt) * dt
      assert(ClusterLabGeometry.progress(elapsed: finish, duration: duration, distance: distance, speed: speed) == 1)
    }
  }
}
assert(ClusterLabGeometry.duration(distance: 200, speed: 5000, movementDuration: 0.5) <
       ClusterLabGeometry.duration(distance: 200, speed: 200, movementDuration: 0.5))
assert(ClusterLabGeometry.duration(distance: 1000, speed: 0, movementDuration: 10) == 0.22)
// Retained connections get only a little extra stretch, on both axes and
// across spatial-hash boundaries; fresh pills still merge at original contact.
let stretched = [station("a", 3, 111), station("b", 4, 219, 48)]
assert(ClusterLabGeometry.owners(stretched, previous: merged)["b"] == "a")
assert(ClusterLabGeometry.owners(stretched, previous: [:])["b"] == "b")
assert(ClusterLabGeometry.owners([station("a", 3, 111), station("b", 4, 220, 48)], previous: merged)["b"] == "b")
assert(ClusterLabGeometry.owners([station("a", 3, 111), station("b", 4, 219, 49)], previous: merged)["b"] == "b")
let gentle = ClusterLabGeometry.rebound(distance: 20, speed: 50)
let fast = ClusterLabGeometry.rebound(distance: 20, speed: 1200)
let long = ClusterLabGeometry.rebound(distance: 180, speed: 50)
assert(gentle < 1 && fast > gentle * 2 && long > gentle * 8)
assert(ClusterLabGeometry.rebound(distance: 180, speed: 1200) == 18)
// A real return, not a longer ease-out: peak is crossed once and converges
// monotonically to the exact destination. Starting/ending velocity stays zero.
let duration = 0.16
let peak = ClusterLabGeometry.progress(elapsed: duration * 0.68, duration: duration, distance: 180, speed: 1200)
assert(abs((peak - 1) * 180 - 18) < 0.00001)
var previous = peak
for t in stride(from: duration * 0.68, through: duration, by: duration / 1000) {
  let p = ClusterLabGeometry.progress(elapsed: t, duration: duration, distance: 180, speed: 1200)
  assert(p <= previous + 0.000001 && p >= 1)
  previous = p
}
let tiny = duration * 0.0001
assert(ClusterLabGeometry.progress(elapsed: tiny, duration: duration, distance: 180, speed: 1200) < 0.000001)
assert(abs(ClusterLabGeometry.progress(elapsed: duration - tiny, duration: duration, distance: 180, speed: 1200) - 1) < 0.000001)
print("native geometry passed")
`);
        const binary = path.join(directory, 'geometry-test');
        execFileSync('swiftc', ['modules/fuel-up-map-kit-routing/ios/ClusterLab/ClusterLabGeometry.swift', main, '-o', binary]);
        assert.match(execFileSync(binary, { encoding: 'utf8' }), /native geometry passed/);
    } finally { rmSync(directory, { recursive: true, force: true }); }
});
