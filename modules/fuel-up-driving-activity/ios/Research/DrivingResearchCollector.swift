import Foundation
import CoreLocation
import CoreMotion
import UIKit
import Combine
import Network

@MainActor
final class DrivingResearchCollector: NSObject, ObservableObject, @preconcurrency CLLocationManagerDelegate {
  static let shared = DrivingResearchCollector()
  static let enabledKey="fuelup.driving-research.enabled.v1"
  nonisolated static let consentKey="fuelup.driving-research.consent.v1"
  @Published var enabled=UserDefaults.standard.bool(forKey:enabledKey)
  @Published var status="Not collecting"
  @Published var issue:String?
  @Published var pending=0
  @Published var total=0
  @Published var lastUpload:Date?=UserDefaults.standard.object(forKey:"research.lastUpload") as? Date
  @Published var lastFix:ResearchFix?
  @Published var motion="Unknown"
  @Published var stationCount=0
  @Published var fenceCount=0
  @Published var lastCatalog:Date?
  @Published var recent:[ResearchEvent]=[]
  @Published var visits:[ResearchVisit]=[]
  @Published var busy=false
  @Published var permissionRevision=0
  @Published var participant="Not enrolled"
  @Published var notificationPermission="Checking"
  @Published var visitLabels:[String:String]=[:]
  @Published var notifiedVisitIDs=Set<String>()
  @Published var departureTimes:[String:Double]=[:]
  @Published var confirmationVisit:ResearchVisit?
  private var promptedVisitIDs=Set<String>()
  @Published var uploadSchedule="Checking connection"
  let manager=CLLocationManager()
  let activity=CMMotionActivityManager()
  private var store:DrivingResearchStore?
  private let transport=DrivingResearchTransport()
  private var identity:ResearchIdentity?
  private var stations:[ResearchStation]=[]
  private var detector=ResearchVisitDetector()
  private var lastMotionCheck=Date.distantPast
  private var lastDrive=Date.distantPast
  private var lastPersistedFix:Double=0
  private var lastMotionTimestamp:Double=0
  private var lastCatalogAttempt=Date.distantPast
  private var catalogCenter:ResearchFix?
  private var catalogBusy=false
  private var configured=false
  private var running=false
  private var lastMode=""
  private var sessionID=UUID().uuidString.lowercased()
  private var lastQualityErrorAt=Date.distantPast
  private var permissionSetup=false
  private let networkMonitor=NWPathMonitor()
  private var networkAvailable=false
  private var wifiNetwork=false
  private var expensiveNetwork=true
  private var constrainedNetwork=false
  private var lastUploadAttempt=UserDefaults.standard.object(forKey:"research.lastUploadAttempt") as? Date

  private override init() {
    super.init(); manager.delegate=self
    manager.showsBackgroundLocationIndicator=false
    manager.activityType = .automotiveNavigation
    manager.allowsBackgroundLocationUpdates=true
  }
  var locationPermission:String {
    switch manager.authorizationStatus {
    case .authorizedAlways:return "Always"
    case .authorizedWhenInUse:return "While Using"
    case .denied:return "Denied"
    case .restricted:return "Restricted"
    default:return "Not requested"
    }
  }
  var precise:Bool {manager.accuracyAuthorization == .fullAccuracy}
  var motionPermission:String {
    guard CMMotionActivityManager.isActivityAvailable() else {return "Unavailable"}
    switch CMMotionActivityManager.authorizationStatus() {
    case .authorized:return "Allowed"
    case .denied:return "Denied"
    case .restricted:return "Restricted"
    default:return "Not requested"
    }
  }
  var ready:Bool {CLLocationManager.locationServicesEnabled() && manager.authorizationStatus == .authorizedAlways && precise && CMMotionActivityManager.authorizationStatus() == .authorized}
  var consented:Bool {UserDefaults.standard.bool(forKey:Self.consentKey)}

  func prepare() {
    guard !configured else {return}
    do {
      let folder=try FileManager.default.url(for:.applicationSupportDirectory,in:.userDomainMask,appropriateFor:nil,create:true).appendingPathComponent("DrivingResearch",isDirectory:true)
      store=try DrivingResearchStore(directory:folder)
      DrivingResearchSync.shared.configure(store!)
      DrivingResearchSync.shared.onChange = { [weak self] in self?.lastUpload=UserDefaults.standard.object(forKey:"research.lastUpload") as? Date;self?.refreshCounts() }
      if let data=UserDefaults.standard.data(forKey:"research.stations") {stations=(try? JSONDecoder().decode([ResearchStation].self,from:data)) ?? []}
      if let data=UserDefaults.standard.data(forKey:"research.catalogCenter") {catalogCenter=try? JSONDecoder().decode(ResearchFix.self,from:data)}
      lastCatalog=UserDefaults.standard.object(forKey:"research.lastCatalog") as? Date
      if consented && lastUploadAttempt == nil {
        lastUploadAttempt=Date();UserDefaults.standard.set(lastUploadAttempt,forKey:"research.lastUploadAttempt")
      }
      if let data=UserDefaults.standard.data(forKey:"research.visits") {visits=(try? JSONDecoder().decode([ResearchVisit].self,from:data)) ?? []}
      // Resume the same observed visit, but the detector marks gaps instead of
      // assuming the user remained there while the process was not running.
      if let data=UserDefaults.standard.data(forKey:"research.detector") {detector=(try? JSONDecoder().decode(ResearchVisitDetector.self,from:data)) ?? ResearchVisitDetector()}
      stationCount=stations.count;configured=true;refreshCounts();refreshConfirmations()
      networkMonitor.pathUpdateHandler = { [weak self] path in
        Task { @MainActor in
          guard let self else{return}
          self.networkAvailable=path.status == .satisfied
          self.wifiNetwork=path.usesInterfaceType(.wifi)
          self.expensiveNetwork=path.isExpensive
          self.constrainedNetwork=path.isConstrained
          self.sync()
        }
      }
      networkMonitor.start(queue:DispatchQueue(label:"fuelup.research.network"))
    } catch {issue=error.localizedDescription;status="Storage unavailable"}
  }
  func resume(reason:String) {
    permissionRevision+=1
    Task {notificationPermission=await DrivingResearchNotifications.shared.permission()}
    guard enabled,consented else {return}
    prepare();guard configured else{return}
    do {identity=try ResearchIdentity.load();participant=identity!.id} catch {issue=error.localizedDescription;return}
    guard ready else {
      stopSensors();status="Paused — finish permissions"
      record("permission",["location":locationPermission,"precise":precise,"motion":motionPermission]);return
    }
    if !running {
      running=true;sessionID=UUID().uuidString.lowercased()
      record("lifecycle",["reason":reason,"os":UIDevice.current.systemVersion,"version":Bundle.main.object(forInfoDictionaryKey:"CFBundleShortVersionString") as? String ?? "", "build":Bundle.main.object(forInfoDictionaryKey:"CFBundleVersion") as? String ?? "", "background":UIApplication.shared.applicationState != .active])
      manager.startMonitoringSignificantLocationChanges()
      manager.startUpdatingLocation()
      activity.startActivityUpdates(to:.main) { [weak self] value in
        guard let value else {return};Task { @MainActor in self?.handleMotion(value) }
      }
    }
    manager.requestLocation()
    applyMode();checkMotion();sync();DrivingResearchBackground.schedule()
  }
  func enable() async {
    guard !busy else {return};busy=true;defer{busy=false}
    prepare();guard configured else{return}
    do {
      let id=try ResearchIdentity.load();identity=id;participant=id.id
      _=try await transport.send("enroll",identity:id,fields:["consentVersion":1])
      UserDefaults.standard.set(true,forKey:Self.consentKey)
      enabled=true;UserDefaults.standard.set(true,forKey:Self.enabledKey)
      if lastUploadAttempt == nil {
        lastUploadAttempt=Date();UserDefaults.standard.set(lastUploadAttempt,forKey:"research.lastUploadAttempt")
      }
      record("consent",["version":1,"enabled":true,"purpose":"driving-and-station-visit-research"])
      issue=nil;requestPermissions()
    } catch {issue="Could not enroll. Check your connection and try again."}
  }
  // Explicit button only: prompts are never requested from a drive callback.
  func requestPermissions() {
    guard UIApplication.shared.applicationState == .active,consented else{return}
    permissionSetup=true
    switch manager.authorizationStatus {
    case .notDetermined:manager.requestWhenInUseAuthorization()
    case .authorizedWhenInUse:manager.requestAlwaysAuthorization()
    case .authorizedAlways:requestMotion()
    default:permissionSetup=false
    }
    status="Finish permissions, then collection starts automatically"
  }
  private func requestMotion() {
    permissionSetup=false
    if CMMotionActivityManager.authorizationStatus() == .notDetermined {
      activity.queryActivityStarting(from:Date().addingTimeInterval(-60),to:Date(),to:.main) { [weak self] _,_ in
        Task { @MainActor in self?.resume(reason:"permissions") }
      }
    } else {resume(reason:"permissions")}
  }
  func pause() {
    record("consent",["version":1,"enabled":false])
    enabled=false;UserDefaults.standard.set(false,forKey:Self.enabledKey)
    DrivingResearchNotifications.shared.cancelAll()
    stopSensors();DrivingResearchSync.shared.pause();status="Paused"
    if let visit=detector.active {record("visit_gap",visitPayload(visit))}
    detector=ResearchVisitDetector();saveDetector()
  }
  private func stopSensors() {
    manager.stopUpdatingLocation();manager.stopMonitoringSignificantLocationChanges();activity.stopActivityUpdates()
    for region in manager.monitoredRegions where region.identifier.hasPrefix("research:") {manager.stopMonitoring(for:region)}
    running=false;fenceCount=0;lastMode=""
  }
  func deleteData() async {
    guard !busy else{return};busy=true;defer{busy=false};pause()
    do {
      if consented {
        // A temporarily locked Keychain must not look like confirmed deletion.
        let id=try identity ?? ResearchIdentity.load()
        _=try await transport.send("delete",identity:id)
      }
      try store?.erase();try DrivingResearchTestNotifications.shared.erase();try ResearchIdentity.erase();DrivingResearchSync.shared.erase()
      for key in [Self.consentKey,"research.visits","research.stations","research.catalogCenter","research.lastCatalog","research.detector","research.lastUpload","research.lastUploadAttempt"] {UserDefaults.standard.removeObject(forKey:key)}
      identity=nil;participant="Not enrolled";visits=[];visitLabels=[:];notifiedVisitIDs=[];departureTimes=[:];promptedVisitIDs=[];confirmationVisit=nil;stations=[];stationCount=0;lastUpload=nil;lastUploadAttempt=nil;issue=nil;refreshCounts()
      catalogCenter=nil;lastCatalog=nil;lastFix=nil;motion="Unknown";lastDrive = .distantPast
      status="Research data deleted"
    } catch {issue="Deletion did not finish. Collection is paused; reconnect and try again. Local data is retained until deletion succeeds."}
  }
  private func applyMode() {
    let near=lastFix.map {fix in stations.contains {fix.distance(to:$0)<350}} ?? false
    let drive=Date().timeIntervalSince(lastDrive)<180
    let observingStop=detector.active.map { Date().timeIntervalSince1970 - $0.startedAt < 1200 } ?? false
    let mode=near && drive || observingStop ? "station" : drive ? "driving" : "monitoring"
    guard mode != lastMode else{return};lastMode=mode
    manager.desiredAccuracy = mode == "monitoring" ? kCLLocationAccuracyHundredMeters : kCLLocationAccuracyBest
    manager.distanceFilter = mode == "station" ? kCLDistanceFilterNone : mode == "driving" ? 15 : 150
    manager.pausesLocationUpdatesAutomatically = mode == "monitoring"
    manager.showsBackgroundLocationIndicator=false
    status=mode == "station" ? "Observing a possible station stop" : mode == "driving" ? "Recording drive" : "Ready — waiting for a drive"
    record("diagnostic",["mode":mode,"desiredAccuracy":manager.desiredAccuracy,"distanceFilter":manager.distanceFilter])
  }
  func locationManagerDidChangeAuthorization(_ manager:CLLocationManager) {
    permissionRevision+=1
    if permissionSetup,UIApplication.shared.applicationState == .active {
      if manager.authorizationStatus == .authorizedWhenInUse {manager.requestAlwaysAuthorization()}
      else if manager.authorizationStatus == .authorizedAlways {requestMotion()}
      else if manager.authorizationStatus == .denied || manager.authorizationStatus == .restricted {permissionSetup=false}
    }
    if configured {resume(reason:"authorization_changed")}
  }
  func locationManager(_ manager:CLLocationManager,didUpdateLocations locations:[CLLocation]) {
    guard enabled else{return}
    guard ready else{stopSensors();status="Paused — finish permissions";return}
    let now=Date().timeIntervalSince1970
    for location in locations.sorted(by:{$0.timestamp<$1.timestamp}) {
      let fix=ResearchFix(timestamp:location.timestamp.timeIntervalSince1970,receivedAt:now,latitude:location.coordinate.latitude,longitude:location.coordinate.longitude,accuracy:location.horizontalAccuracy,speed:location.speed,course:location.course,speedAccuracy:location.speedAccuracy,simulated:location.sourceInformation?.isSimulatedBySoftware ?? false,accessory:location.sourceInformation?.isProducedByAccessory ?? false)
      if fix.timestamp <= (lastFix?.timestamp ?? 0) {continue}
      lastFix=fix
      if fix.rejection == nil,fix.speed>=8 {lastDrive=Date(timeIntervalSince1970:fix.timestamp)}
      let minimumInterval=lastMode == "monitoring" ? 30.0 : 5.0
      if fix.timestamp-lastPersistedFix>=minimumInterval {
        lastPersistedFix=fix.timestamp
        var payload=(try? JSONSerialization.jsonObject(with:JSONEncoder().encode(fix))) as? [String:Any] ?? [:]
        payload["quality"]=fix.rejection ?? "accepted";payload["mode"]=lastMode
        record("location",payload)
      }
      let changes=detector.process(fix,stations:stations)
      for (kind,visit) in changes {
        var evidence=visitPayload(visit)
        if kind == "visit_departure" {evidence["departedAt"]=fix.timestamp}
        record(kind,evidence)
        if kind == "visit_candidate" || kind == "visit_departure" || kind == "visit_gap" {
          visits.removeAll{$0.id==visit.id};visits.insert(visit,at:0);visits=Array(visits.prefix(30))
          UserDefaults.standard.set(try? JSONEncoder().encode(visits),forKey:"research.visits")
        }
        if ResearchConfirmation.shouldPrompt(event:kind,visit:visit) {prompt(visit)}
      }
      if !changes.isEmpty {refreshConfirmations()}
      saveDetector()
      if now-fix.timestamp<30,fix.accuracy>=0,fix.accuracy<150,!fix.simulated {
        refreshStations(around:fix);refreshFences(around:fix)
      }
    }
    applyMode();checkMotion();sync()
  }
  private func handleMotion(_ value:CMMotionActivity) {
    guard enabled else{return}
    let timestamp=value.startDate.timeIntervalSince1970
    guard timestamp>lastMotionTimestamp else{return};lastMotionTimestamp=timestamp
    motion=value.automotive ? "Automotive" : value.walking ? "Walking" : value.stationary ? "Stationary" : "Other / uncertain"
    record("motion",["timestamp":timestamp,"automotive":value.automotive,"stationary":value.stationary,"walking":value.walking,"running":value.running,"cycling":value.cycling,"unknown":value.unknown,"confidence":value.confidence.rawValue])
    if value.automotive,value.confidence != .low,Date().timeIntervalSince(value.startDate)<180 {lastDrive=Date()}
    applyMode()
  }
  private func checkMotion() {
    guard Date().timeIntervalSince(lastMotionCheck)>30 else{return};lastMotionCheck=Date()
    activity.queryActivityStarting(from:Date().addingTimeInterval(-180),to:Date(),to:.main) { [weak self] values,_ in
      Task { @MainActor in for value in values ?? [] {self?.handleMotion(value)} }
    }
  }
  private func visitPayload(_ visit:ResearchVisit)->[String:Any] {
    ["visitId":visit.id,"stationId":visit.station.id,"stationName":visit.station.name,"startedAt":visit.startedAt,"lastInsideAt":visit.lastInsideAt,"samples":visit.samples,"candidate":visit.candidate,"ambiguousStationIds":visit.ambiguousIDs,"fuelPurchaseConfirmed":false]
  }
  private func saveDetector() {UserDefaults.standard.set(try? JSONEncoder().encode(detector),forKey:"research.detector")}
  func requestStopNotifications() async {
    guard consented,UIApplication.shared.applicationState == .active else{return}
    _=await DrivingResearchNotifications.shared.requestPermission()
    notificationPermission=await DrivingResearchNotifications.shared.permission()
  }
  func refreshConfirmations() {
    prepare()
    do {
      let state=ResearchConfirmation.state(try store?.confirmationRecords() ?? [])
      promptedVisitIDs=state.prompted;visitLabels=state.labels;notifiedVisitIDs=state.notified;departureTimes=state.departures;refreshCounts()
    } catch {issue=error.localizedDescription}
  }
  func openConfirmation(_ visit:ResearchVisit) {
    prepare();refreshConfirmations();confirmationVisit=visit
  }
  private func prompt(_ visit:ResearchVisit) {
    guard enabled,consented,!promptedVisitIDs.contains(visit.id),visitLabels[visit.id]==nil else{return}
    let fields:[String:Any]=["visitId":visit.id,"stationId":visit.station.id,"status":"created","confirmationState":"unconfirmed"]
    // Claim locally before scheduling: relaunches never repeat an unanswered prompt.
    guard record("visit_prompt",fields) else{return}
    promptedVisitIDs.insert(visit.id)
    Task {
      guard enabled,consented,visitLabels[visit.id]==nil else{return}
      let result=await DrivingResearchNotifications.shared.schedule(visit)
      if !enabled || !consented || visitLabels[visit.id] != nil {DrivingResearchNotifications.shared.remove(visit.id);return}
      var outcome=fields;outcome["status"]=result;record("visit_prompt",outcome);refreshConfirmations()
    }
  }
  @discardableResult func label(_ visit:ResearchVisit,_ label:String)->Bool {
    guard consented,let payload=ResearchConfirmation.payload(visit:visit,label:label,source:"app"),record("visit_label",payload) else{return false}
    DrivingResearchNotifications.shared.remove(visit.id);refreshConfirmations();sync();return true
  }
  func locationManager(_ manager:CLLocationManager,didFailWithError error:Error) {
    guard enabled else{return}
    if Date().timeIntervalSince(lastQualityErrorAt)>60 {lastQualityErrorAt=Date();record("diagnostic",["locationError":(error as NSError).code])}
  }
  func locationManagerDidPauseLocationUpdates(_ manager:CLLocationManager) {record("diagnostic",["locationPaused":true])}
  func locationManagerDidResumeLocationUpdates(_ manager:CLLocationManager) {record("diagnostic",["locationResumed":true])}
  func locationManager(_ manager:CLLocationManager,monitoringDidFailFor region:CLRegion?,withError error:Error) {
    issue="A station geofence could not be registered. Location recording continues."
    record("diagnostic",["geofenceError":(error as NSError).code,"region":region?.identifier ?? ""])
  }
  func locationManager(_ manager:CLLocationManager,didEnterRegion region:CLRegion) {boundary(region,"enter")}
  func locationManager(_ manager:CLLocationManager,didExitRegion region:CLRegion) {boundary(region,"exit")}
  func locationManager(_ manager:CLLocationManager,didDetermineState state:CLRegionState,for region:CLRegion) {boundary(region,"state_\(state.rawValue)")}
  private func boundary(_ region:CLRegion,_ transition:String) {
    guard enabled,ready,region.identifier.hasPrefix("research:") else{return}
    record("geofence",["region":region.identifier,"transition":transition])
    // Wake-up evidence only. A delayed boundary callback never proves fueling.
    manager.requestLocation();manager.startUpdatingLocation();checkMotion();sync()
  }
  @discardableResult private func record(_ kind:String,_ fields:[String:Any])->Bool {
    guard consented,let store else{return false}
    do {
      var payload=fields;payload["schemaVersion"]=1;payload["detectorVersion"]="station-stop-v1";payload["sessionId"]=sessionID
      try store.append(ResearchEvent(kind:kind,payload:payload));refreshCounts();sync();return true
    } catch {issue=error.localizedDescription;stopSensors();status="Paused — storage needs attention";return false}
  }
  func refreshCounts() {
    do {
      let counts=try store?.counts();pending=counts?.pending ?? 0;total=counts?.total ?? 0
      recent=(try store?.events(limit:12)) ?? []
    } catch {issue=error.localizedDescription}
  }
  func sync(force:Bool=false) {
    DrivingResearchSync.shared.wake(online:networkAvailable,wifi:wifiNetwork,automatic:enabled)
    if force {DrivingResearchSync.shared.syncAll()}
  }
  private func refreshStations(around fix:ResearchFix) {
    guard !catalogBusy,let identity,Date().timeIntervalSince(lastCatalogAttempt)>30 else{return}
    guard networkAvailable else{return}
    let moved=catalogCenter.map{ResearchFix.distance(fix.latitude,fix.longitude,$0.latitude,$0.longitude)} ?? .infinity
    guard ResearchTransferPolicy.needsCatalog(moved:moved,age:Date().timeIntervalSince(lastCatalog ?? .distantPast),constrained:constrainedNetwork) else{return}
    lastCatalogAttempt=Date();catalogBusy=true
    Task {
      defer{catalogBusy=false}
      do {
        let response=try await transport.send("stations",identity:identity,fields:["latitude":fix.latitude,"longitude":fix.longitude])
        guard enabled else{return}
        let data=try JSONSerialization.data(withJSONObject:response["stations"] ?? [])
        let fetched=try JSONDecoder().decode([ResearchStation].self,from:data)
        stations=fetched;stationCount=fetched.count;catalogCenter=fix;lastCatalog=Date()
        if issue?.hasPrefix("Station coverage") == true {issue=nil}
        UserDefaults.standard.set(data,forKey:"research.stations")
        UserDefaults.standard.set(try? JSONEncoder().encode(fix),forKey:"research.catalogCenter")
        UserDefaults.standard.set(lastCatalog,forKey:"research.lastCatalog")
        record("station_catalog",["count":stations.count,"latitude":fix.latitude,"longitude":fix.longitude,"stationIds":Array(stations.prefix(100).map(\.id))])
        refreshFences(around:fix);applyMode()
      } catch {issue="Station coverage refresh pending. Cached stations remain available."}
    }
  }
  private func refreshFences(around fix:ResearchFix) {
    guard CLLocationManager.isMonitoringAvailable(for:CLCircularRegion.self) else{return}
    let nearest=stations.sorted{fix.distance(to:$0)<fix.distance(to:$1)}.filter{fix.distance(to:$0)<10000}.prefix(18)
    let wanted=Set(nearest.map{"research:station:\($0.id)"})
    let current=manager.monitoredRegions
    for region in current where region.identifier.hasPrefix("research:station:") && !wanted.contains(region.identifier) {manager.stopMonitoring(for:region)}
    let existing=Set(current.map(\.identifier))
    // Reserve capacity for a coarse movement anchor and other app-owned regions.
    var available=max(0,19-manager.monitoredRegions.count)
    for station in nearest where !existing.contains("research:station:\(station.id)") && available>0 {
      let region=CLCircularRegion(center:CLLocationCoordinate2D(latitude:station.latitude,longitude:station.longitude),radius:250,identifier:"research:station:\(station.id)")
      region.notifyOnEntry=true;region.notifyOnExit=true;manager.startMonitoring(for:region);manager.requestState(for:region);available-=1
    }
    let anchor=current.first{$0.identifier=="research:movement"} as? CLCircularRegion
    if anchor == nil || ResearchFix.distance(fix.latitude,fix.longitude,anchor!.center.latitude,anchor!.center.longitude)>500 {
      if let anchor {manager.stopMonitoring(for:anchor)}
      if manager.monitoredRegions.count<20 {
        let region=CLCircularRegion(center:CLLocationCoordinate2D(latitude:fix.latitude,longitude:fix.longitude),radius:800,identifier:"research:movement")
        region.notifyOnEntry=false;region.notifyOnExit=true;manager.startMonitoring(for:region)
      }
    }
    fenceCount=manager.monitoredRegions.filter{$0.identifier.hasPrefix("research:")}.count
  }
}
