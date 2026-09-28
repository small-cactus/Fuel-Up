const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

test('native glass groups preserve horizontal chains and isolate separated rows with shared effects', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'fuelup-glass-groups-'));
    try {
        const main = path.join(directory, 'main.swift');
        writeFileSync(main, `import Foundation
import CoreGraphics
func item(_ id: String, _ x: CGFloat, _ y: CGFloat) -> LabGlassItem {
  LabGlassItem(id: id, frame: CGRect(x: x - 42, y: y - 16, width: 84, height: 32))
}
func grouped(_ items: [LabGlassItem], _ previous: [String: Int] = [:]) -> [String: Int] {
  ClusterLabGlassGrouping.groups(items, previous: previous)
}
assert(grouped([]).isEmpty)
for gap in stride(from: CGFloat(0), through: 72, by: 0.5) {
  let horizontal = grouped([item("a", 0, 0), item("b", 84 + gap, 0)], ["a": 1, "b": 0])
  if gap <= 36 { assert(horizontal["a"] == horizontal["b"]) }
  let vertical = grouped([item("a", 0, 0), item("b", 0, 32 + gap)])
  assert((vertical["a"] == vertical["b"]) == (gap <= 2))
}
let rows = [item("a", -110, -20), item("b", 0, -20), item("c", 110, -20),
            item("d", -110, 30), item("e", 0, 30), item("f", 110, 30)]
let groups = grouped(rows)
assert(groups["a"] == groups["b"] && groups["b"] == groups["c"])
assert(groups["d"] == groups["e"] && groups["e"] == groups["f"])
assert(groups["a"] != groups["d"])
assert(Set(groups.values).count == 2)
assert(grouped(Array(rows.reversed())) == groups)
assert(grouped(rows, groups) == groups)
// Real clusters include a narrower count capsule. A diagonal price-to-count
// pair must not reconnect two otherwise isolated stacked rows transitively.
for y in stride(from: CGFloat(35), through: 68, by: 1) {
  for x in stride(from: CGFloat(-15), through: 15, by: 1) {
    let clusters = [item("a", 0, 0), item("b", x, y),
      LabGlassItem(id: "badge:a", frame: CGRect(x: 34, y: -16, width: 44, height: 32)),
      LabGlassItem(id: "badge:b", frame: CGRect(x: x + 34, y: y - 16, width: 44, height: 32))]
    let result = grouped(clusters)
    assert(result["a"] == result["badge:a"])
    assert(result["b"] == result["badge:b"])
    assert(result["a"] != result["b"], "diagonal count joined stacked rows")
  }
}
let distant = (0..<1000).map { item(String($0), CGFloat($0) * 400, 0) }
assert(Set(grouped(distant).values).count == 1)
let stack = (0..<30).map { item(String(format: "%02d", $0), 0, CGFloat($0) * 50) }
assert(Set(grouped(stack).values).count <= 3)
// Merge back to the same horizontal effect regardless of earlier row assignments.
let joined = grouped([item("a", 0, 0), item("b", 110, 0), item("c", 220, 0)], ["a": 0, "b": 1, "c": 2])
assert(Set(joined.values).count == 1)
print("native grouping passed")
`);
        const binary = path.join(directory, 'grouping-test');
        execFileSync('swiftc', [
            'modules/fuel-up-map-kit-routing/ios/ClusterLab/ClusterLabGeometry.swift',
            'modules/fuel-up-map-kit-routing/ios/ClusterLab/ClusterLabGlassGrouping.swift', main, '-o', binary,
        ]);
        assert.match(execFileSync(binary, { encoding: 'utf8' }), /native grouping passed/);
    } finally { rmSync(directory, { recursive: true, force: true }); }
});
