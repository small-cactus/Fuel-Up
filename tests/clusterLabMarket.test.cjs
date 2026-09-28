const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

test('native market tints highlight one cheapest station and grade every alternative red', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'fuelup-market-'));
    try {
        const main = path.join(directory, 'main.swift');
        writeFileSync(main, String.raw`import Foundation
func quote(_ id: String, _ price: Double, _ lat: Double = 27.95, _ lon: Double = -82.45) -> LabMarketQuote {
  LabMarketQuote(id: id, latitude: lat, longitude: lon, price: price)
}
let quotes = [quote("best", 2.8), quote("low", 3.1), quote("median", 3.2), quote("high", 3.3), quote("worst", 3.6)]
let result = ClusterLabMarket.assess(quotes)
assert(result["best"]!.score == 1)
assert(result["worst"]!.score == -1)
assert(result.values.filter { $0.score > 0 }.count == 1)
assert(result["median"]!.score < 0)
assert(abs(result["best"]!.median! - 3.25) < 0.000001)
assert(result["best"]!.peerCount == 4)
assert(result["low"]!.score < 0 && result["high"]!.score <= result["low"]!.score)
let gradient = ClusterLabMarket.assess([quote("a", 3), quote("b", 3.02), quote("c", 3.05), quote("d", 3.10)])
assert(gradient["b"]!.score < 0 && gradient["c"]!.score < gradient["b"]!.score)
assert(gradient["d"]!.score < gradient["c"]!.score)
let sparse = ClusterLabMarket.assess(Array(quotes.prefix(3)))
assert(sparse.values.allSatisfy { $0.median == nil })
assert(sparse["best"]!.score > 0 && sparse["low"]!.score < 0)
let withFar = ClusterLabMarket.assess(quotes + [quote("far", 10, 28.05)])
for q in quotes { assert(withFar[q.id]!.score == result[q.id]!.score) }
assert(withFar["far"]!.score == -1)
let noise = ClusterLabMarket.assess([quote("a", 3.20), quote("b", 3.21), quote("c", 3.19), quote("d", 3.20)])
assert(noise["c"]!.score > 0 && noise["c"]!.score <= 0.05)
assert(noise.values.filter { $0.score < 0 }.count == 3)
let tied = [quote("a", 3.2), quote("b", 3.2), quote("c", 3.2)]
for input in [tied, Array(tied.reversed())] {
  let colors = ClusterLabMarket.assess(input)
  assert(colors["a"]!.score == 0.05 && colors["b"]!.score == -0.05 && colors["c"]!.score == -0.05)
}
assert(ClusterLabMarket.assess([quote("only", 3.2)])["only"]!.score == 0.05)
assert(ClusterLabMarket.assess([]).isEmpty)
let duplicates = ClusterLabMarket.assess(quotes + [quotes[0]])
assert(duplicates["best"]!.peerCount == 4)
let invalid = ClusterLabMarket.assess(quotes + [quote("nan", .nan), quote("bad", -1), quote("lat", 3, 100)])
assert(invalid.count == 5 && invalid["best"]!.score == result["best"]!.score)
// One extreme report cannot drag a neighborhood median away from its peers.
let robust = ClusterLabMarket.assess([quote("a", 3.2), quote("b", 3.2), quote("c", 3.2), quote("d", 3.2), quote("outlier", 30)])
assert(robust["a"]!.score == 0.05 && robust["outlier"]!.score == -1)
assert(robust["b"]!.median == 3.2 && robust["b"]!.score < 0)
// Limit a dense market to its closest 12 peers, never to the 12 cheapest.
let nearby = (0..<12).map { quote("n-\($0)", 3.2, 27.95 + Double($0) * 0.0001) }
let distant = (0..<20).map { quote("d-\($0)", 2.0, 27.98 + Double($0) * 0.0001) }
let bounded = ClusterLabMarket.assess([quote("target", 3.2)] + nearby + distant)
assert(bounded["target"]!.peerCount == 12 && bounded["target"]!.median == 3.2)
assert(bounded["target"]!.score == -0.05, "A distant bargain must not saturate an average local price")
assert(abs(result["median"]!.score) <= 0.05, "Typical prices should be pastel")
assert(abs(result["high"]!.score) > abs(result["median"]!.score))
assert(abs(result["worst"]!.score) > abs(result["high"]!.score))
var previous: Double = 2
for price in stride(from: 2.5, through: 4, by: 0.01) {
  let value = ClusterLabMarket.assess([quote("target", price)] + nearby)["target"]!.score
  assert(value <= previous + 0.000001 && value >= -1 && value <= 1)
  previous = value
}
let reordered = ClusterLabMarket.assess(Array(quotes.reversed()))
for q in quotes { assert(reordered[q.id]!.score == result[q.id]!.score) }
print("native market passed")
`);
        const binary = path.join(directory, 'market-test');
        execFileSync('swiftc', ['modules/fuel-up-map-kit-routing/ios/ClusterLab/ClusterLabMarket.swift', main, '-o', binary]);
        assert.match(execFileSync(binary, { encoding: 'utf8' }), /native market passed/);
    } finally { rmSync(directory, { recursive: true, force: true }); }
});
