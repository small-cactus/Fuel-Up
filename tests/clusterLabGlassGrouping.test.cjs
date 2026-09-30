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
// The screenshot's staggered cluster islands can form a diagonal chain through
// price and count edges. Each intended pair must blend without joining neighbors.
func cluster(_ id: String, _ x: CGFloat, _ y: CGFloat) -> [LabGlassItem] {
  [LabGlassItem(id: id, frame: CGRect(x: x - 42, y: y - 16, width: 84, height: 32), family: id),
   LabGlassItem(id: "badge:" + id, frame: CGRect(x: x + 34, y: y - 16, width: 44, height: 32), family: id)]
}
for y in stride(from: CGFloat(-45), through: 45, by: 1) {
  let islands = cluster("a", 0, 0) + cluster("b", 95, y) + cluster("c", -65, y - 35)
  let result = grouped(islands)
  for id in ["a", "b", "c"] { assert(result[id] == result["badge:" + id]) }
  assert(result["a"] != result["b"] && result["a"] != result["c"] && result["b"] != result["c"])
}
// Intended logical families retain native glass morphing.
let previewAnchors = ClusterLabGlassGrouping.layout([item("a", 0, 0), item("b", 110, 0), item("c", 240, 45)], previous: [:]).connections
assert(previewAnchors["a"] == previewAnchors["b"])
assert(previewAnchors["a"] != previewAnchors["c"])
let previewPills = cluster("a", 0, 0) + cluster("b", 110, 0)
let preview = grouped(previewPills.map { LabGlassItem(id: $0.id, frame: $0.frame, family: previewAnchors[$0.family!]) })
assert(Set(preview.values).count == 1, "intended incoming glass lost its pre-merge morph")
// The count edge may be much closer than its price anchor. Do not prewarm
// separate families into one visible neck before their membership agrees.
let anchors = [item("a", 0, 0), item("b", 126, 0)]
let bareFrames = Dictionary(uniqueKeysWithValues: anchors.map { ($0.id, [$0.frame]) })
let barePreview = ClusterLabGlassGrouping.previews(anchors: anchors, footprints: bareFrames)
assert(barePreview["a"] == barePreview["b"], "incoming solo price lost native prewarming")
var withCount = bareFrames
withCount["a"]!.append(CGRect(x: 52, y: -16, width: 44, height: 32))
let countPreview = ClusterLabGlassGrouping.previews(anchors: anchors, footprints: withCount)
assert(countPreview["a"] != countPreview["b"], "count bridged unrelated logical parents")
// Share the native container before visible horizontal contact, while keeping
// physical connection reporting and vertical behavior at their original reach.
let approaching = [LabGlassItem(id: "parent", frame: item("parent", 0, 0).frame, anchorPriority: 10),
                   item("incoming", 126, 0)]
let oldEffects = ["parent": 3, "incoming": 0]
let prepared = ClusterLabGlassGrouping.layout(approaching, previous: oldEffects, preparation: true)
assert(prepared.groups["parent"] == 3 && prepared.groups["incoming"] == 3)
let physical = ClusterLabGlassGrouping.layout(approaching, previous: prepared.groups)
assert(physical.connections["parent"] != physical.connections["incoming"])
// Multiple count movers must never outvote a settled price's native material.
let crowd = [LabGlassItem(id: "parent", frame: item("parent", 0, 0).frame, anchorPriority: 10)] +
  (0..<4).map { item("child-" + String($0), 50 + CGFloat($0), 0) }
let prior = Dictionary(uniqueKeysWithValues: crowd.map { ($0.id, $0.id == "parent" ? 3 : 0) })
assert(Set(ClusterLabGlassGrouping.layout(crowd, previous: prior, preparation: true).groups.values) == [3])
let preparedVertical = ClusterLabGlassGrouping.layout([item("a", 0, 0), item("b", 0, 36)], previous: [:], preparation: true)
assert(preparedVertical.groups["a"] != preparedVertical.groups["b"])
let pooled = (0..<1000).flatMap { cluster(String($0), CGFloat($0) * 400, 0) }
assert(Set(grouped(pooled).values).count == 1)
let distant = (0..<1000).map { item(String($0), CGFloat($0) * 400, 0) }
assert(Set(grouped(distant).values).count == 1)
let separated = ClusterLabGlassGrouping.layout(distant, previous: [:])
assert(Set(separated.connections.values).count == 1000)
let touching = ClusterLabGlassGrouping.layout([item("a", 0, 0), item("b", 110, 0), item("c", 600, 0)], previous: [:])
assert(touching.connections["a"] == touching.connections["b"])
assert(touching.connections["a"] != touching.connections["c"])
// Same scene must have the same native paint order after arbitrary prior pools.
let paintItems = cluster("a", 0, 0) + cluster("b", 0, 42) + cluster("c", 160, 85)
func paintOrder(_ prior: [String: Int]) -> [String: Int] {
  let layout = ClusterLabGlassGrouping.layout(paintItems, previous: prior, preparation: true)
  return layout.groups.mapValues { layout.layers[$0]! }
}
let baselinePaint = paintOrder([:])
for seed in 0..<30 {
  let prior = Dictionary(uniqueKeysWithValues: paintItems.enumerated().map { ($1.id, ($0 * 7 + seed) % 5) })
  assert(paintOrder(prior) == baselinePaint, "zoom history changed native shadow order")
}
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
