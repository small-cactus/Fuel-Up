const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

test('location clearance stays small, clears capsules, respects edges, and settles without rebound', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'fuelup-location-clearance-'));
    try {
        const main = path.join(directory, 'main.swift');
        writeFileSync(main, `import Foundation
import CoreGraphics
let bounds = CGRect(x: 15, y: 65, width: 345, height: 650)
let pill = CGRect(x: 145, y: 384, width: 84, height: 32)
let center = CGPoint(x: pill.midX, y: pill.midY)
func offset(_ dot: CGPoint?, frame: CGRect = pill) -> CGFloat {
  ClusterLabLocationClearance.offset(frame: frame, dot: dot, bounds: bounds)
}
assert(offset(nil) == 0)
assert(offset(CGPoint(x: 0, y: 0)) == 0)
assert(offset(center) == -31)
assert(offset(CGPoint(x: center.x, y: center.y + 20)) == -11)
assert(offset(CGPoint(x: center.x, y: center.y - 20)) == 11)
let edge = CGRect(x: 145, y: 65, width: 84, height: 32)
assert(offset(CGPoint(x: edge.midX, y: edge.midY), frame: edge) == 31)
for x in stride(from: CGFloat(100), through: 275, by: 1) {
  for y in stride(from: CGFloat(360), through: 440, by: 1) {
    let dot = CGPoint(x: x, y: y)
    let dy = offset(dot)
    assert(abs(dy) <= 32)
    let moved = pill.offsetBy(dx: 0, dy: dy)
    let horizontal = max(0, max(moved.minX + 16 - x, x - moved.maxX + 16))
    assert(hypot(horizontal, moved.midY - y) >= 31 - 0.00001)
    assert(bounds.contains(moved))
    let shift = CGSize(width: 20, height: 25)
    let panned = ClusterLabLocationClearance.offset(frame: pill.offsetBy(dx: shift.width, dy: shift.height),
      dot: CGPoint(x: x + shift.width, y: y + shift.height), bounds: bounds.offsetBy(dx: shift.width, dy: shift.height))
    assert(abs(panned - dy) < 0.000001)
  }
}
let countGroup = CGRect(x: 145, y: 384, width: 138, height: 32)
assert(offset(CGPoint(x: 263, y: 400), frame: countGroup) == -31)
assert(ClusterLabLocationClearance.offset(frame: pill, dot: center, bounds: bounds,
  neighbors: [pill.offsetBy(dx: 0, dy: -40)]) == 31)
// A nudge that clears the dot must not stop in the neighbor's 2pt glass band.
// In this arrangement both directions clear the dot, but only below stays separate.
assert(ClusterLabLocationClearance.offset(frame: pill, dot: center, bounds: bounds,
  neighbors: [pill.offsetBy(dx: 0, dy: -64)]) == 31)
let state = ClusterLabLocationClearance()
var previous: CGFloat = 0
for _ in 0..<12 {
  let value = state.update(frames: ["a": pill], dot: center, bounds: bounds, deltaTime: 1.0/120, reducedMotion: false).offsets["a"]!
  assert(value <= previous && value >= -31)
  previous = value
}
assert(previous == -31)
for _ in 0..<12 {
  let value = state.update(frames: ["a": pill], dot: nil, bounds: bounds, deltaTime: 1.0/120, reducedMotion: false).offsets["a"]!
  assert(value >= previous && value <= 0)
  previous = value
}
assert(previous == 0)
state.reset()
let first = state.update(frames: ["a": pill], dot: center, bounds: bounds, deltaTime: 0, reducedMotion: false)
assert(first.offsets["a"] == -31 && !first.moving)
assert(state.update(frames: ["a": pill], dot: nil, bounds: bounds, deltaTime: 0, reducedMotion: true).offsets["a"] == 0)
print("location clearance passed")
`);
        const binary = path.join(directory, 'clearance-test');
        execFileSync('swiftc', ['modules/fuel-up-map-kit-routing/ios/ClusterLab/ClusterLabLocationClearance.swift', main, '-o', binary]);
        assert.match(execFileSync(binary, { encoding: 'utf8' }), /location clearance passed/);
    } finally { rmSync(directory, { recursive: true, force: true }); }
});
