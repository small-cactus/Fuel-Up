import Foundation
import UIKit
import Combine

// One persistent drain intent spans batches, interruptions and process restarts.
@MainActor
final class DrivingResearchSync: ObservableObject {
  static let shared = DrivingResearchSync()
  @Published var syncing = false
  @Published var message: String?
  private var store: DrivingResearchStore?
  private let transport = DrivingResearchTransport()
  private var upload: Task<Void,Never>?
  private var control: Task<Void,Never>?
  private var retry: Task<Void,Never>?
  private var networkKnown = false
  private var online = false
  private var wifi = false
  private var automatic = false
  private var mode: String? = UserDefaults.standard.string(forKey:"research.syncMode")
  private var remoteID: String? = UserDefaults.standard.string(forKey:"research.remoteSyncID")
  private var completionID: String? = UserDefaults.standard.string(forKey:"research.completedSyncID")
  private var nextAttempt = Date.distantPast
  private var failures = 0
  private var lastControl = Date.distantPast
  var onChange: (() -> Void)?

  func configure(_ store: DrivingResearchStore) {self.store=store}
  private var consented: Bool {UserDefaults.standard.bool(forKey:DrivingResearchCollector.consentKey)}
  private func persist() {
    UserDefaults.standard.set(mode,forKey:"research.syncMode")
    UserDefaults.standard.set(remoteID,forKey:"research.remoteSyncID")
    UserDefaults.standard.set(completionID,forKey:"research.completedSyncID")
  }
  func wake(online:Bool,wifi:Bool,automatic:Bool) {
    networkKnown=true;self.online=online;self.wifi=wifi;self.automatic=automatic
    guard consented,let store else{return}
    if automatic,mode==nil,ResearchTransferPolicy.canUpload(online:true,wifi:true,pending:(try? store.counts().pending) ?? 0) {mode="wifi";persist()}
    start()
    if automatic {checkControl()}
  }
  func syncAll() {
    guard consented else{return}
    mode="all";persist();nextAttempt = .distantPast
    DrivingResearchBackground.schedule()
    message=online ? "Syncing…" : "Sync queued · waiting for a connection"
    start()
  }
  func pause() {
    automatic=false;upload?.cancel();control?.cancel();retry?.cancel()
    mode=nil;persist();message=nil
    DrivingResearchBackground.cancel()
  }
  func erase() {
    pause();remoteID=nil;completionID=nil;persist()
    UserDefaults.standard.removeObject(forKey:"research.lastCountReport")
  }
  func expire() {upload?.cancel();control?.cancel()}
  func backgroundWork() async {
    for _ in 0..<30 where !networkKnown && !Task.isCancelled {try? await Task.sleep(for:.milliseconds(100))}
    guard !Task.isCancelled else{return}
    lastControl = .distantPast
    checkControl()
    if let control {await control.value}
    start()
    if let upload {await upload.value}
  }
  private var allowed: Bool {ResearchTransferPolicy.canUpload(online:online,wifi:wifi && automatic,pending:0,draining:mode=="wifi",manual:mode=="all")}
  private func start() {
    guard consented,allowed,upload==nil,Date()>=nextAttempt,let store else{return}
    syncing=true
    upload=Task {
      var background:UIBackgroundTaskIdentifier = .invalid
      background=UIApplication.shared.beginBackgroundTask(withName:"Sync all research") { [weak self] in self?.upload?.cancel() }
      defer {
        if background != .invalid {UIApplication.shared.endBackgroundTask(background)}
        upload=nil;syncing=false;onChange?()
      }
      do {
        let identity=try ResearchIdentity.load()
        while consented,allowed {
          try Task.checkCancellation()
          var events=try store.events(pending:true,limit:1000)
          if events.isEmpty {
            if let remoteID {completionID=remoteID;self.remoteID=nil}
            mode=nil;persist();message="All data synced";failures=0
            checkControl(force:true);break
          }
          // Bound each request's bytes, not the amount this operation will sync.
          var encoded=try JSONEncoder().encode(events)
          while encoded.count>850_000,events.count>1 {
            events=Array(events.prefix(max(1,events.count/2)));encoded=try JSONEncoder().encode(events)
          }
          let response=try await transport.send("upload",identity:identity,fields:["events":try JSONSerialization.jsonObject(with:encoded)],wifiOnly:mode != "all")
          try Task.checkCancellation()
          guard let ids=response["ids"] as? [String],Set(ids)==Set(events.map(\.id)),response["accepted"] as? Int==events.count else {throw URLError(.cannotParseResponse)}
          try store.acknowledge(ids)
          UserDefaults.standard.set(Date(),forKey:"research.lastUpload")
          message="Syncing…";failures=0;onChange?()
        }
      } catch is CancellationError {
        // Keep the drain intent. A later native wake resumes unacknowledged IDs.
      } catch {
        failures+=1
        let delay=min(900,30*pow(2,Double(min(failures,5))))
        nextAttempt=Date().addingTimeInterval(delay)
        message="Sync queued · retrying when connected"
        retry?.cancel();retry=Task {try? await Task.sleep(for:.seconds(delay));if !Task.isCancelled {start()}}
      }
      if mode != nil {DrivingResearchBackground.schedule()}
    }
  }
  private func checkControl(force:Bool=false) {
    guard consented,online,control==nil,let store,force || (automatic && Date().timeIntervalSince(lastControl)>=900) else{return}
    lastControl=Date()
    control=Task {
      defer {control=nil}
      do {
        let identity=try ResearchIdentity.load()
        var fields:[String:Any]=[:]
        let lastReport=UserDefaults.standard.object(forKey:"research.lastCountReport") as? Date ?? .distantPast
        let report=ResearchTransferPolicy.countReportDue(now:Date().timeIntervalSince1970,lastReport:lastReport.timeIntervalSince1970)
        if report {let counts=try store.counts();fields["total"]=counts.total;fields["pending"]=counts.pending}
        let completing=completionID
        if let completing {fields["completedRequestId"]=completing}
        let response=try await transport.send("control",identity:identity,fields:fields)
        try Task.checkCancellation()
        guard consented else{return}
        if report {UserDefaults.standard.set(Date(),forKey:"research.lastCountReport")}
        if completing==completionID {completionID=nil}
        if automatic,let id=response["syncRequestId"] as? String {remoteID=id;mode="all"}
        persist();start()
      } catch { /* Durable requests and the count timestamp retry on a later wake. */ }
    }
  }
}
