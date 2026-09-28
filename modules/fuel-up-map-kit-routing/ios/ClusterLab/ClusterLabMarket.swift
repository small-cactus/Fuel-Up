import Foundation

struct LabMarketQuote {
  let id: String
  let latitude: Double
  let longitude: Double
  let price: Double
}

struct LabMarketAssessment {
  let median: Double?
  let peerCount: Int
  // Positive is a saving, negative is a premium; magnitude controls saturation.
  let score: Double
  static let unknown = LabMarketAssessment(median: nil, peerCount: 0, score: 0)
}

enum ClusterLabMarket {
  static let radiusMeters = 8_046.72 // Five miles, independent of map zoom.
  static let minimumPeers = 3
  static let maximumPeers = 12

  // Called only when the selected-fuel station snapshot changes, never on a
  // camera frame. Each station is compared with other stations, not itself.
  static func assess(_ quotes: [LabMarketQuote]) -> [String: LabMarketAssessment] {
    let valid = quotes.filter {
      $0.price.isFinite && $0.price > 0 && $0.latitude.isFinite && $0.longitude.isFinite &&
      abs($0.latitude) <= 90 && abs($0.longitude) <= 180
    }
    let unique = Dictionary(valid.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    return unique.mapValues { quote in
      let peers = unique.values.compactMap { other -> (LabMarketQuote, Double)? in
        guard other.id != quote.id else { return nil }
        let distance = distanceMeters(quote, other)
        return distance <= radiusMeters ? (other, distance) : nil
      }.sorted { $0.1 == $1.1 ? $0.0.id < $1.0.id : $0.1 < $1.1 }
        .prefix(maximumPeers).map { $0.0.price }.sorted()
      guard peers.count >= minimumPeers else { return .unknown }
      let middle = peers.count / 2
      let median = peers.count.isMultiple(of: 2) ? (peers[middle - 1] + peers[middle]) / 2 : peers[middle]
      let saving = median - quote.price
      // Keep pennies of noise neutral. Full color means a meaningful local
      // difference (8%, at least 15 cents), not merely being first or last.
      let deadband = max(0.02, median * 0.005)
      let fullScale = max(0.15, median * 0.08)
      let magnitude = min(1, max(0, (abs(saving) - deadband) / (fullScale - deadband)))
      return LabMarketAssessment(median: median, peerCount: peers.count,
                                 score: magnitude * (saving >= 0 ? 1 : -1))
    }
  }

  private static func distanceMeters(_ a: LabMarketQuote, _ b: LabMarketQuote) -> Double {
    let radians = Double.pi / 180
    let dLatitude = (b.latitude - a.latitude) * radians
    let dLongitude = (b.longitude - a.longitude) * radians
    let h = pow(sin(dLatitude / 2), 2) + cos(a.latitude * radians) * cos(b.latitude * radians) * pow(sin(dLongitude / 2), 2)
    return 6_371_000 * 2 * asin(sqrt(min(1, max(0, h))))
  }
}
