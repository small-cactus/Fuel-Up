import Foundation
import CoreMotion
import CoreLocation
import CryptoKit

// Sparse historical queries, not a continuous accelerometer/pedometer stream.
// The existing durable departure/gap event is the work queue across relaunches.
@MainActor final class DrivingResearchCrossChecks {
  private let pedometer=CMPedometer()
  private let defaults:UserDefaults
  private let timeoutNanoseconds:UInt64
  init(defaults:UserDefaults = .standard,timeoutNanoseconds:UInt64=20_000_000_000) {
    self.defaults=defaults;self.timeoutNanoseconds=timeoutNanoseconds
  }
  private var generation=UUID()
  private var queryID:UUID?
  private var deadline:Task<Void,Never>?
  private var active=false
  private var querying=false
  private var store:DrivingResearchStore?
  private var emit:((String,[String:Any])->Bool)?
  private(set) var collectingSince:Double=0
  private static let sinceKey="research.crossChecksSince"
  private static let dedupKey="research.systemVisitKeys"

  func start(store:DrivingResearchStore, emit:@escaping (String,[String:Any])->Bool) {
    self.store=store;self.emit=emit
    if !active {
      active=true;generation=UUID()
      collectingSince=(defaults.object(forKey:Self.sinceKey) as? Double) ?? Date().timeIntervalSince1970
      defaults.set(collectingSince,forKey:Self.sinceKey)
    }
    drain()
  }
  func stop() {
    active=false;querying=false;generation=UUID();emit=nil
    queryID=nil;deadline?.cancel();deadline=nil
    defaults.removeObject(forKey:Self.sinceKey)
  }
  func erase() {stop();defaults.removeObject(forKey:Self.dedupKey);store=nil}

  func drain() {
    guard active,!querying,let store,let emit else{return}
    let events:[ResearchEvent]
    do {events=try store.pendingPedometerVisits(since:collectingSince)}
    catch {_=emit("diagnostic",["crossCheckError":"pending_read_failed"]);return}
    guard let event=events.first,
          let data=event.payload.data(using:.utf8),
          let p=(try? JSONSerialization.jsonObject(with:data)) as? [String:Any],
          let visitID=p["visitId"] as? String, let stationID=p["stationId"] as? String,
          let start=p["startedAt"] as? Double,let end=p["lastInsideAt"] as? Double else{return}
    let now=Date().timeIntervalSince1970
    var fields:[String:Any]=["visitId":visitID,"stationId":stationID,"source":"apple_pedometer",
      "terminalEvent":event.kind,"observedStartAt":start,"observedEndAt":end]
    func unavailable(_ reason:String) {
      fields["status"]=reason
      if emit("visit_pedometer",fields) {Task {self.drain()}}
    }
    guard let window=ResearchPedometerWindow(visitStart:start,visitEnd:end,collectingSince:collectingSince,now:now) else {unavailable("invalid_window");return}
    fields["startAt"]=window.start;fields["endAt"]=window.end;fields["truncated"]=window.truncated
    guard window.start>=now-7*86400 else{unavailable("history_expired");return}
    guard CMPedometer.isStepCountingAvailable() else{unavailable("unavailable");return}
    guard CMPedometer.authorizationStatus() == .authorized else{unavailable("not_authorized");return}
    querying=true
    let ticket=generation
    let requestID=UUID();queryID=requestID
    deadline=Task { [weak self] in
      guard let self else{return}
      do {try await Task.sleep(nanoseconds:self.timeoutNanoseconds)} catch {return}
      var result=fields;result["status"]="query_failed";result["timedOut"]=true
      self.finish(result,ticket:ticket,requestID:requestID)
    }
    pedometer.queryPedometerData(from:Date(timeIntervalSince1970:window.start),to:Date(timeIntervalSince1970:window.end)) { [weak self] value,error in
      Task { @MainActor in
        guard let self,self.active,self.generation==ticket,self.queryID==requestID else{return}
        var result=fields
        if let value,error == nil {
          result["status"]="available";result["steps"]=value.numberOfSteps.intValue
          result["dataStartAt"]=value.startDate.timeIntervalSince1970
          result["dataEndAt"]=value.endDate.timeIntervalSince1970
          if CMPedometer.isDistanceAvailable(),let distance=value.distance,distance.doubleValue.isFinite,distance.doubleValue>=0 {result["distanceMeters"]=distance.doubleValue}
        } else {
          result["status"]="query_failed"
          if let error {result["errorCode"]=(error as NSError).code}
        }
        self.finish(result,ticket:ticket,requestID:requestID)
      }
    }
  }

  private func finish(_ result:[String:Any],ticket:UUID,requestID:UUID) {
    guard active,generation==ticket,queryID==requestID else{return}
    querying=false;queryID=nil;deadline?.cancel();deadline=nil
    if emit?("visit_pedometer",result) == true {drain()}
  }

  func visit(_ visit:CLVisit,stations:[ResearchStation]) {
    guard active,let emit else{return}
    let arrival=visit.arrivalDate == .distantPast ? nil : visit.arrivalDate.timeIntervalSince1970
    let departure=visit.departureDate == .distantFuture ? nil : visit.departureDate.timeIntervalSince1970
    guard let fields=ResearchSystemVisitPolicy.payload(latitude:visit.coordinate.latitude,longitude:visit.coordinate.longitude,
      accuracy:visit.horizontalAccuracy,arrival:arrival,departure:departure,now:Date().timeIntervalSince1970,
      collectingSince:collectingSince,stations:stations),
      let data=try? JSONSerialization.data(withJSONObject:fields,options:.sortedKeys) else{return}
    let key=SHA256.hash(data:data).map {String(format:"%02x",$0)}.joined()
    var keys=defaults.stringArray(forKey:Self.dedupKey) ?? []
    guard !keys.contains(key) else{return}
    if emit("system_visit",fields) {
      keys.append(key);defaults.set(Array(keys.suffix(128)),forKey:Self.dedupKey)
    }
  }
}
