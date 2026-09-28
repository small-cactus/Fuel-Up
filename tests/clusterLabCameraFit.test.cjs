const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

test('camera fit maximizes separation while fitting every price and count across phone sizes', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'fuelup-camera-fit-'));
    try {
        const main = path.join(directory, 'main.swift');
        writeFileSync(main, `import Foundation
import CoreGraphics
func point(_ id: Int, _ x: CGFloat, _ y: CGFloat) -> LabProjectedStation {
  LabProjectedStation(id: String(id), price: Double(id), point: CGPoint(x: x, y: y))
}
func extent(_ stations: [LabProjectedStation], _ scale: CGFloat) -> CGRect {
  let projected = stations.map { LabProjectedStation(id: $0.id, price: $0.price,
    point: CGPoint(x: $0.point.x * scale, y: $0.point.y * scale)) }
  let owners = ClusterLabGeometry.owners(projected, previous: [:])
  let counts = Dictionary(grouping: owners.values, by: { $0 }).mapValues(\\.count)
  let byId = Dictionary(uniqueKeysWithValues: projected.map { ($0.id, $0.point) })
  var stretches: [String: CGFloat] = [:]
  for p in projected {
    guard let ownerId = owners[p.id], ownerId != p.id, let owner = byId[ownerId] else { continue }
    stretches[ownerId] = max(stretches[ownerId] ?? 0, ClusterLabGeometry.badgeStretch(separation:
      CGPoint(x: p.point.x - owner.x, y: p.point.y - owner.y)))
  }
  return projected.reduce(CGRect.null) { bounds, p in
    bounds.union(CGRect(x: p.point.x - 42, y: p.point.y - 16,
      width: (counts[p.id] ?? 0) > 1 ? 120 + (stretches[p.id] ?? 0) : 84, height: 32))
  }
}
var fixtures = [[point(0, 0, 0)], [point(0, 0, 0), point(1, 0, 0)],
  [point(0, 0, 0), point(1, 0, 900)], [point(0, 0, 0), point(1, 1000, 0)],
  [point(0, 1000, 20), point(1, 1020, 0), point(2, 0, 0)],
  [point(0, 300, 0), point(1, 240, 0), point(2, 180, 0), point(3, 0, 300)],
  [point(0, 0, 0), point(1, 0.00001, 0)]]
var seed: UInt64 = 13
func random() -> CGFloat {
  seed = seed &* 6364136223846793005 &+ 1
  return CGFloat((seed >> 32) % 10000) / 10
}
for _ in 0..<100 { fixtures.append((0..<15).map { point($0, random(), random()) }) }
for size in [CGSize(width: 320, height: 568), CGSize(width: 375, height: 812),
             CGSize(width: 440, height: 956), CGSize(width: 812, height: 375)] {
  let usable = CGRect(x: 17, y: 76, width: size.width - 34, height: size.height - 178)
  assert(ClusterLabCameraFit.rect(for: [], viewport: size, usable: usable, maximumScale: 2) == nil)
  for stations in fixtures {
    let fit = ClusterLabCameraFit.rect(for: stations, viewport: size, usable: usable, maximumScale: 2)!
    let scale = size.width / fit.width
    let occupied = extent(stations, scale).offsetBy(dx: -fit.minX * scale, dy: -fit.minY * scale)
    assert(usable.insetBy(dx: -0.00001, dy: -0.00001).contains(occupied), "pill clipped: \\(occupied) in \\(usable)")
    assert(abs(fit.width / fit.height - size.width / size.height) < 0.000001)
    assert(scale <= 2 && scale > 0)
    // Independently sample tighter camera scales, including cluster boundaries.
    // None may fit: otherwise the chosen camera groups more than necessary.
    for ratio in stride(from: CGFloat(1.001), through: 2, by: 0.003) where scale * ratio <= 2 {
      let larger = extent(stations, scale * ratio)
      assert(larger.width > usable.width || larger.height > usable.height, "missed a tighter feasible fit")
    }
    let reverse = ClusterLabCameraFit.rect(for: Array(stations.reversed()), viewport: size, usable: usable, maximumScale: 2)!
    assert(abs(reverse.minX - fit.minX) < 0.000001 && abs(reverse.width - fit.width) < 0.000001)
  }
}
print("camera fit passed")
`);
        const binary = path.join(directory, 'fit-test');
        execFileSync('swiftc', ['modules/fuel-up-map-kit-routing/ios/ClusterLab/ClusterLabGeometry.swift',
            'modules/fuel-up-map-kit-routing/ios/ClusterLab/ClusterLabCameraFit.swift', main, '-o', binary]);
        assert.match(execFileSync(binary, { encoding: 'utf8' }), /camera fit passed/);
    } finally { rmSync(directory, { recursive: true, force: true }); }
});
