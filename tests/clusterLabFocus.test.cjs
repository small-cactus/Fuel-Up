const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const path = require('node:path');
const { tmpdir } = require('node:os');

test('focus solves separate membership and glass without unnecessary zoom or unbounded coincident zoom', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fuelup-focus-'));
    try {
        writeFileSync(path.join(dir, 'main.swift'), `import Foundation
import CoreGraphics
let bounds = CGRect(x: 0, y: 0, width: 375, height: 812)
func station(_ id: String, _ x: CGFloat, _ y: CGFloat) -> LabProjectedStation {
  LabProjectedStation(id: id, price: id == "a" ? 3 : 4, point: CGPoint(x: x, y: y))
}
func plan(_ points: [LabProjectedStation], previous: [String: String] = [:], dot: CGPoint? = nil, cap: CGFloat = 100) -> ClusterLabFocus.Plan {
  ClusterLabFocus.plan(id: "a", stations: points, previous: previous, dot: dot, bounds: bounds, maximumScale: cap)!
}
let a = station("a", 0, 0)
assert(plan([a]).scale == 1)
assert(plan([a, station("b", 200, 0)]).scale == 1)
assert(ClusterLabFocus.plan(id: "missing", stations: [a], previous: [:], dot: nil, bounds: bounds, maximumScale: 100) == nil)
let horizontal = plan([a, station("b", 40, 0)], previous: ["a":"a", "b":"a"])
assert(horizontal.isolated && abs(horizontal.scale - ((42 * 1.20 + 42 + 39) / 40 * 1.04)) < 0.001)
let vertical = plan([a, station("b", 0, 20)], previous: ["a":"a", "b":"a"])
assert(vertical.isolated && abs(vertical.scale - ((16 * 1.20 + 16 + 2) / 20 * 1.04)) < 0.001)
let duplicate = plan([a, station("b", 0, 0)])
assert(!duplicate.isolated && duplicate.scale == 1)
let limited = plan([a, station("b", 0.001, 0)], cap: 10)
assert(!limited.isolated && limited.scale == 10)
// A count on a neighboring cluster can reach the target even after target
// membership has split. Check the displayed capsule, not just coordinates.
let countNeighbors = [a, station("b", -100, 0), station("c", -101, 0)]
let countPlan = plan(countNeighbors)
assert(countPlan.isolated && countPlan.scale > 1.5 && countPlan.scale < 2)
for angle in stride(from: CGFloat(0), to: 6.28, by: 0.11) {
  let b = station("b", cos(angle) * 25, sin(angle) * 25)
  let result = plan([a, b], previous: ["a":"a", "b":"a"])
  assert(result.isolated && result.scale >= 1 && result.scale < 6)
  let projected = [a, station("b", b.point.x * result.scale, b.point.y * result.scale)]
  let owners = ClusterLabGeometry.owners(projected, previous: ["a":"a", "b":"a"], selectedId: "a")
  assert(owners["a"] != owners["b"])
}
let cleared = plan([a, station("b", 0, 45)], dot: .zero)
assert(cleared.isolated && cleared.scale.isFinite)
print("focus geometry passed")
`);
        const source = 'modules/fuel-up-map-kit-routing/ios/ClusterLab/';
        const binary = path.join(dir, 'focus');
        execFileSync('swiftc', ['ClusterLabGeometry.swift', 'ClusterLabGlassGrouping.swift', 'ClusterLabLocationClearance.swift', 'ClusterLabFocus.swift'].map(f => source + f).concat([path.join(dir, 'main.swift'), '-o', binary]));
        assert.match(execFileSync(binary, { encoding: 'utf8' }), /focus geometry passed/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});
