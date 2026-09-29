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
  let cheapestPrice: Double?
  // Sign selects the cheapest green station; magnitude is distance from market.
  let score: Double
  static let unknown = LabMarketAssessment(median: nil, peerCount: 0, cheapestPrice: nil, score: 0)
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
    // Inputs exclude estimates. Resolve equal prices by the same stable ID
    // ordering as cluster ownership, keeping exactly one green representative.
    guard let cheapest = unique.values.min(by: {
      $0.price == $1.price ? $0.id < $1.id : $0.price < $1.price
    }) else { return [:] }
    let snapshotPrices = unique.values.map(\.price).sorted()
    let snapshotMiddle = snapshotPrices.count / 2
    let snapshotMedian = snapshotPrices.count.isMultiple(of: 2) ?
      (snapshotPrices[snapshotMiddle - 1] + snapshotPrices[snapshotMiddle]) / 2 : snapshotPrices[snapshotMiddle]
    return unique.mapValues { quote in
      let peers = unique.values.compactMap { other -> (LabMarketQuote, Double)? in
        guard other.id != quote.id else { return nil }
        let distance = distanceMeters(quote, other)
        return distance <= radiusMeters ? (other, distance) : nil
      }.sorted { $0.1 == $1.1 ? $0.0.id < $1.0.id : $0.1 < $1.1 }
        .prefix(maximumPeers).map { $0.0.price }.sorted()
      let middle = peers.count / 2
      let median: Double? = peers.count >= minimumPeers ?
        (peers.count.isMultiple(of: 2) ? (peers[middle - 1] + peers[middle]) / 2 : peers[middle]) : nil
      // Median alternatives are clearly red. Below-market alternatives remain
      // softer, while premiums reach full red at the same market-relative spread.
      // The winner's green strengthens with its savings below that same market.
      let reference = median ?? snapshotMedian
      let isCheapest = quote.id == cheapest.id
      let difference = isCheapest ? reference - quote.price : quote.price - reference
      let fullScale = max(0.15, reference * 0.08)
      let magnitude = isCheapest ? min(1, max(0.05, difference / fullScale)) :
        min(1, max(0.18, 0.55 + 0.45 * difference / fullScale))
      return LabMarketAssessment(median: median, peerCount: peers.count,
                                 cheapestPrice: cheapest.price,
                                 score: isCheapest ? magnitude : -magnitude)
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
