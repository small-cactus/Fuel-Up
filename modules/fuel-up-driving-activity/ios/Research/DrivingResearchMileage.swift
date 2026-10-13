import Foundation

// Independent of the live stop detector: delayed positions can measure historical
// travel but must never masquerade as the user's current position.
struct ResearchMileageState: Codable {
  var epoch=UUID().uuidString.lowercased()
  var collectingSince:Double
  var previous:ResearchFix?
  var meters=0.0
  var coveredSeconds=0.0
  var gapSeconds=0.0
  var gaps=0
  var acceptedSamples=0
  var delayedSamples=0
  var rejectedSamples=0
  var duplicateSamples=0
  var lastSampleAt:Double?
  var boundaryCount=0

  mutating func process(_ fix:ResearchFix) {
    guard fix.timestamp.isFinite,fix.receivedAt.isFinite,
          fix.timestamp>=collectingSince,fix.timestamp<=fix.receivedAt+5,
          fix.receivedAt-fix.timestamp<=86400,
          fix.latitude.isFinite,fix.longitude.isFinite,
          abs(fix.latitude)<=90,abs(fix.longitude)<=180,
          fix.accuracy.isFinite,fix.accuracy>=0,fix.accuracy<=40,
          fix.speed.isFinite,!fix.simulated else {rejectedSamples+=1;return}
    guard fix.timestamp>(lastSampleAt ?? -Double.infinity) else {duplicateSamples+=1;return}
    lastSampleAt=fix.timestamp
    acceptedSamples+=1
    if fix.receivedAt-fix.timestamp>30 {delayedSamples+=1}
    guard let prior=previous else {previous=fix;return}
    let seconds=fix.timestamp-prior.timestamp
    guard seconds>0 else {return}
    if seconds>120 {
      gaps+=1;gapSeconds+=seconds;previous=fix;return
    }
    let distance=ResearchFix.distance(prior.latitude,prior.longitude,fix.latitude,fix.longitude)
    // No guessed routes across gaps and no GPS teleports. Keep the last good
    // anchor after a spike so the return to the real road isn't counted either.
    guard distance/seconds<=70 else {rejectedSamples+=1;return}
    // Ignore stationary drift. Retain the anchor until movement exceeds noise.
    let noiseFloor=max(3,(prior.accuracy+fix.accuracy)*0.25)
    guard max(prior.speed,fix.speed)>=2.5,distance>=noiseFloor else {
      if max(prior.speed,fix.speed)<2.5 {previous=fix;coveredSeconds+=seconds}
      return
    }
    meters+=distance;coveredSeconds+=seconds;previous=fix
  }

  mutating func boundary(at time:Double) {
    // Preserve lifetime totals but never bridge a pause or permission outage.
    previous=nil;lastSampleAt=nil;collectingSince=time;boundaryCount+=1
  }

  var payload:[String:Any] {
    var result:[String:Any]=["version":1,"epoch":epoch,"capturedMeters":meters,
      "coveredSeconds":coveredSeconds,"unmeasuredGapSeconds":gapSeconds,"gapCount":gaps,
      "acceptedSamples":acceptedSamples,"delayedSamples":delayedSamples,
      "rejectedSamples":rejectedSamples,"duplicateOrOutOfOrderSamples":duplicateSamples,
      "collectionBoundaryCount":boundaryCount,"collectingSince":collectingSince,
      "distanceType":"captured_gps_driving_segments","completeOdometer":false]
    if let lastSampleAt {result["lastSampleAt"]=lastSampleAt}
    return result
  }
}

final class DrivingResearchMileage {
  private let url:URL
  private(set) var state:ResearchMileageState
  init(directory:URL,now:Double=Date().timeIntervalSince1970) throws {
    url=directory.appendingPathComponent("mileage-v1.json")
    if FileManager.default.fileExists(atPath:url.path) {
      // A corrupt checkpoint must be visible, not silently reset to zero.
      state=try JSONDecoder().decode(ResearchMileageState.self,from:Data(contentsOf:url))
    } else {state=ResearchMileageState(collectingSince:now)}
  }
  func process(_ fixes:[ResearchFix]) throws {
    var next=state
    for fix in fixes.sorted(by:{$0.timestamp<$1.timestamp}) {next.process(fix)}
    try save(next)
  }
  func boundary(at time:Double=Date().timeIntervalSince1970) throws {
    var next=state;next.boundary(at:time);try save(next)
  }
  private func save(_ next:ResearchMileageState) throws {
    let data=try JSONEncoder().encode(next)
    #if os(iOS)
    try data.write(to:url,options:[.atomic,.completeFileProtectionUntilFirstUserAuthentication])
    #else
    try data.write(to:url,options:.atomic)
    #endif
    state=next
  }
  func erase() throws {
    if FileManager.default.fileExists(atPath:url.path) {try FileManager.default.removeItem(at:url)}
    state=ResearchMileageState(collectingSince:Date().timeIntervalSince1970)
  }
}

// Drive evidence holds through traffic lights. Motion reports of sustained
// stationary activity end the hold sooner; old callbacks cannot renew it.
enum ResearchDrivingMode {
  static func active(now:Double,lastDrive:Double,stationarySince:Double?)->Bool {
    guard now-lastDrive>=0,now-lastDrive<600 else {return false}
    if let stationarySince,now-stationarySince>=300 {return false}
    return true
  }
}
