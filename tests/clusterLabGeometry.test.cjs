const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

test('native clustering preserves identities, boundary hysteresis, and bounded motion', () => {
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
let boundary = [station("a", 3, 0), station("b", 4, 95)]
assert(ClusterLabGeometry.owners(boundary, previous: merged)["b"] == "a")
assert(ClusterLabGeometry.owners(boundary, previous: [:])["b"] == "b")
assert(ClusterLabGeometry.owners(separate, previous: merged)["b"] == "b")
assert(ClusterLabGeometry.owners([station("b", 3, 0), station("a", 3, 0)], previous: [:])["b"] == "a")
assert(ClusterLabGeometry.owners([station("a", 3, -104), station("b", 4, -21)], previous: [:])["b"] == "a")
for distance in stride(from: 0.1, through: 1000, by: 0.5) {
  for dt in [1.0/120, 1.0/60, 0.1] {
    let fraction = ClusterLabGeometry.fraction(distance: distance, deltaTime: dt, reducedMotion: false)
    assert(fraction > 0 && fraction <= 1)
    assert(distance * fraction <= 2.000001)
  }
}
assert(ClusterLabGeometry.fraction(distance: 100, deltaTime: 1.0/60, reducedMotion: true) == 1)
print("native geometry passed")
`);
        const binary = path.join(directory, 'geometry-test');
        execFileSync('swiftc', ['modules/fuel-up-map-kit-routing/ios/ClusterLab/ClusterLabGeometry.swift', main, '-o', binary]);
        assert.match(execFileSync(binary, { encoding: 'utf8' }), /native geometry passed/);
    } finally { rmSync(directory, { recursive: true, force: true }); }
});
