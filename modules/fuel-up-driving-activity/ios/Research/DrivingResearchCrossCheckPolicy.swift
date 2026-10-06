import Foundation

// Missing measurements are omitted, never converted to zero or purchase labels.
struct ResearchPedometerWindow {
  let start: Double
  let end: Double
  let truncated: Bool
  init?(visitStart: Double, visitEnd: Double, collectingSince: Double, now: Double) {
    guard [visitStart,visitEnd,collectingSince,now].allSatisfy({$0.isFinite}),
          visitStart >= 0, visitEnd > visitStart, visitEnd <= now,
          visitEnd > collectingSince else { return nil }
    end = visitEnd
    start = max(visitStart,collectingSince,visitEnd-1200)
    truncated = start != visitStart
  }
}

enum ResearchSystemVisitPolicy {
  static func payload(latitude: Double, longitude: Double, accuracy: Double,
                      arrival: Double?, departure: Double?, now: Double,
                      collectingSince: Double, stations: [ResearchStation]) -> [String:Any]? {
    guard latitude.isFinite,longitude.isFinite,accuracy.isFinite,
          abs(latitude)<=90,abs(longitude)<=180,accuracy>=0,accuracy<=100,
          arrival != nil || departure != nil else {return nil}
    let times=[arrival,departure].compactMap{$0}
    guard times.allSatisfy({$0.isFinite && $0>=collectingSince && $0<=now}),
          arrival == nil || departure == nil || departure! >= arrival! else {return nil}
    let nearby=stations.map {($0.id,ResearchFix.distance(latitude,longitude,$0.latitude,$0.longitude))}
      .filter {$0.1<=150}.sorted {$0.1<$1.1}
    guard !nearby.isEmpty else {return nil}
    var result:[String:Any]=["source":"apple_visit","latitude":latitude,"longitude":longitude,
      "accuracy":accuracy,"stationCandidates":nearby.prefix(5).map {["stationId":$0.0,"distanceMeters":$0.1] as [String:Any]},
      "fuelPurchaseConfirmed":false]
    if let arrival {result["arrivalAt"]=arrival}
    if let departure {result["departureAt"]=departure}
    return result
  }
}
