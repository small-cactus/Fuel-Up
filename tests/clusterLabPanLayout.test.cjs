const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { readFileSync, writeFileSync, mkdtempSync, rmSync } = require('node:fs');
const path = require('node:path');
const { tmpdir } = require('node:os');

// Compile the production snapshot with camera-state stubs. The real UIKit
// transport is checked separately by the opt-in live pan probe/recorded flow.
test('settled pan reuse rejects zoom, changing membership, clearance and stale state', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fuelup-pan-layout-'));
    const base = path.resolve('modules/fuel-up-map-kit-routing/ios/ClusterLab');
    try {
        const source = readFileSync(path.join(base, 'ClusterLabMapAnchor.swift'), 'utf8');
        const snapshot = source.slice(source.indexOf('struct ClusterLabPanLayout {'));
        writeFileSync(path.join(dir, 'Snapshot.swift'), `import Foundation
import CoreGraphics
struct Insets: Equatable { var top: CGFloat = 0; var bottom: CGFloat = 0 }
extension CGRect { func inset(by i: Insets) -> CGRect { CGRect(x: minX, y: minY + i.top, width: width, height: height - i.top - i.bottom) } }
struct MKMapSize { var width: Double = 10000; var height: Double = 20000 }
struct MapRect { var size = MKMapSize() }
struct Camera { var pitch: Double = 0; var heading: Double = 0 }
final class MKMapView { var camera = Camera(); var visibleMapRect = MapRect(); var bounds = CGRect(x: 0, y: 0, width: 400, height: 800); var safeAreaInsets = Insets() }
enum UIAccessibility { static var isReduceMotionEnabled = false }
${snapshot}`);
        writeFileSync(path.join(dir, 'main.swift'), `import Foundation
import CoreGraphics
let map = MKMapView()
let points = ["a": CGPoint(x: 100,y: 100), "b": CGPoint(x: 110,y: 100), "c": CGPoint(x: 300,y: 500)]
let owners = ["a": "a", "b": "a", "c": "c"]
let contacts = ["a": CGFloat(0), "b": 0, "c": 0]
let layout = ClusterLabPanLayout(points: points, owners: owners, contacts: contacts,
  groupFrames: ["a": CGRect(x: 58,y: 84,width: 144,height: 32)], clearanceTargets: ["a": 0], dot: nil,
  bounds: map.bounds, safeBounds: map.bounds.insetBy(dx: 15,dy: 15), mapSize: map.visibleMapRect.size,
  heading: 0, selected: nil, dark: false, reducedMotion: false)
func translated(_ dx: CGFloat, _ dy: CGFloat = 0) -> [String: CGPoint] { points.mapValues { CGPoint(x: $0.x + dx,y: $0.y + dy) } }
func reuse(_ next: [String: CGPoint], _ own: [String: String] = owners, _ dot: CGPoint? = nil, _ selected: String? = nil, _ dark: Bool = false) -> CGPoint? {
  layout.translation(points: next, owners: own, contacts: contacts, dot: dot, map: map, selected: selected, dark: dark)
}
for x in stride(from: CGFloat(-1000), through: 1000, by: 7) { assert(reuse(translated(x, 20)) == CGPoint(x:x,y:20)) }
assert(reuse(translated(0)) == .zero) // No accumulated drift after reversals.
var bent = translated(20); bent["c"]!.x += 0.1; assert(reuse(bent) == nil)
var culled = translated(20); culled.removeValue(forKey:"b"); assert(reuse(culled) == nil)
assert(reuse(translated(20), ["a":"a", "b":"b", "c":"c"]) == nil)
assert(reuse(translated(20), owners, CGPoint(x:200,y:200)) == nil)
assert(reuse(translated(20), owners, nil, "a") == nil)
assert(reuse(translated(20), owners, nil, nil, true) == nil)
map.camera.heading = 1; assert(reuse(translated(20)) == nil); map.camera.heading = 0
map.camera.pitch = 1; assert(reuse(translated(20)) == nil); map.camera.pitch = 0
map.visibleMapRect.size.width *= 1.001; assert(reuse(translated(20)) == nil); map.visibleMapRect.size = MKMapSize()
map.safeAreaInsets.bottom = 30; assert(reuse(translated(20)) == nil); map.safeAreaInsets.bottom = 0
UIAccessibility.isReduceMotionEnabled = true; assert(reuse(translated(20)) == nil); UIAccessibility.isReduceMotionEnabled = false
// All stations at one coordinate still cannot reuse through a zoom.
let coincident = ["a": CGPoint(x:100,y:100),"b": CGPoint(x:100,y:100),"c": CGPoint(x:100,y:100)]
let same = ClusterLabPanLayout(points: coincident, owners: owners, contacts: contacts,
 groupFrames: [:], clearanceTargets: [:], dot:nil, bounds:map.bounds, safeBounds:map.bounds.insetBy(dx:15,dy:15),
 mapSize:map.visibleMapRect.size, heading:0, selected:nil,dark:false,reducedMotion:false)
map.visibleMapRect.size.height *= 1.1
assert(same.translation(points: coincident, owners:owners, contacts:contacts,dot:nil,map:map,selected:nil,dark:false) == nil)
// A location-overlapping group must recompute when the safe edge changes
// which direction can clear the dot, even with unchanged logical ownership.
map.visibleMapRect.size = MKMapSize()
let group = ["a": CGRect(x:58,y:84,width:84,height:32)]
let dot = CGPoint(x:100,y:100)
let safe = map.bounds.insetBy(dx:15,dy:15)
let offset = ClusterLabLocationClearance.targets(frames:group,dot:dot,bounds:safe)
let avoided = ClusterLabPanLayout(points:points,owners:owners,contacts:contacts,groupFrames:group,
 clearanceTargets:offset,dot:dot,bounds:map.bounds,safeBounds:safe,mapSize:map.visibleMapRect.size,
 heading:0,selected:nil,dark:false,reducedMotion:false)
assert(avoided.translation(points:translated(0,-95),owners:owners,contacts:contacts,
 dot:CGPoint(x:100,y:5),map:map,selected:nil,dark:false) == nil)
// The renderer can be settled while avoidance deliberately retains a tiny
// offset difference. Reuse compares raw targets, not that retained pose.
let solver = ClusterLabLocationClearance()
_ = solver.update(frames:group,dot:dot,bounds:safe,deltaTime:1,reducedMotion:false)
let shiftedDot = CGPoint(x:100,y:100.03)
let settled = solver.update(frames:group,dot:shiftedDot,bounds:safe,deltaTime:1,reducedMotion:false)
let raw = ClusterLabLocationClearance.targets(frames:group,dot:shiftedDot,bounds:safe)
assert(!settled.moving && abs(raw["a"]! - settled.offsets["a"]!) > 0.01)
let retained = ClusterLabPanLayout(points:points,owners:owners,contacts:contacts,groupFrames:group,
 clearanceTargets:raw,dot:shiftedDot,bounds:map.bounds,safeBounds:safe,mapSize:map.visibleMapRect.size,
 heading:0,selected:nil,dark:false,reducedMotion:false)
assert(retained.translation(points:points,owners:owners,contacts:contacts,dot:shiftedDot,
 map:map,selected:nil,dark:false) == .zero)
print("pan reuse guards passed")
`);
        execFileSync('swiftc', [path.join(base, 'ClusterLabLocationClearance.swift'), path.join(dir, 'Snapshot.swift'), path.join(dir, 'main.swift'), '-o', path.join(dir, 'test')]);
        assert.match(execFileSync(path.join(dir, 'test'), { encoding: 'utf8' }), /pan reuse guards passed/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});
