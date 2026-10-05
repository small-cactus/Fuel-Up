import Foundation

// Test fixtures never enter ResearchEvent, the sensor outbox, or visit labels.
struct ResearchNotificationTest: Codable, Identifiable {
  let id: String
  let stationName: String
  let candidate: Bool
  let createdAt: Double
  let expiresAt: Double
  var status: String
  var label: String?
  var responseAt: Double?
  var dirty: Bool?
  var delivery: String?
  var pushStatus: String?

  var title: String {ResearchConfirmation.notificationTitle(candidate:candidate,stationName:stationName)}
  var summary: String {
    if let label {return "\(ResearchConfirmation.title(for:label)) · \(dirty == true ? "Waiting to sync" : "Answer synced")"}
    if delivery == "apns",status == "queued" {return pushStatus == "accepted" ? "Sent to Apple · Unconfirmed" : "Push delivery pending"}
    switch status {
    case "scheduled": return "Notification scheduled · Unconfirmed"
    case "permission_missing": return "Notifications need permission"
    case "schedule_failed": return "Notification could not be scheduled"
    case "dismissed": return "Dismissed · Unconfirmed"
    default: return "Waiting for notification"
    }
  }
}

// Synchronous atomic persistence lets the notification callback save an answer
// before its completion handler returns, even without the UI or internet.
final class DrivingResearchTestStore: @unchecked Sendable {
  static let shared = DrivingResearchTestStore(url: FileManager.default.urls(for:.applicationSupportDirectory,in:.userDomainMask)[0]
    .appendingPathComponent("DrivingResearchTests/notifications.json"))
  private let url: URL
  private let lock = NSRecursiveLock()
  init(url:URL) {self.url=url}
  func all() throws -> [ResearchNotificationTest] {
    lock.lock();defer{lock.unlock()}
    guard FileManager.default.fileExists(atPath:url.path) else{return []}
    return try JSONDecoder().decode([ResearchNotificationTest].self,from:Data(contentsOf:url))
  }
  private var removedURL:URL {url.appendingPathExtension("removed")}
  private func tombstones() throws -> [String:Double] {
    guard FileManager.default.fileExists(atPath:removedURL.path) else{return [:]}
    return try JSONDecoder().decode([String:Double].self,from:Data(contentsOf:removedURL))
  }
  private func rememberRemoval(_ tests:[ResearchNotificationTest],now:Double=Date().timeIntervalSince1970) throws {
    var removed=try tombstones().filter{$0.value>now}
    for test in tests where test.expiresAt>now {removed[test.id]=test.expiresAt}
    try FileManager.default.createDirectory(at:url.deletingLastPathComponent(),withIntermediateDirectories:true)
    try JSONEncoder().encode(removed).write(to:removedURL,options:.atomic)
  }
  private func save(_ tests:[ResearchNotificationTest]) throws {
    try FileManager.default.createDirectory(at:url.deletingLastPathComponent(),withIntermediateDirectories:true)
    try JSONEncoder().encode(tests).write(to:url,options:.atomic)
    var saved=url,values=URLResourceValues();values.isExcludedFromBackup=true
    try saved.setResourceValues(values)
    #if os(iOS)
    try FileManager.default.setAttributes([.protectionKey:FileProtectionType.completeUntilFirstUserAuthentication],ofItemAtPath:url.path)
    #endif
  }
  @discardableResult func reconcile(_ remote:[ResearchNotificationTest],now:Double=Date().timeIntervalSince1970) throws -> [String] {
    lock.lock();defer{lock.unlock()}
    let local=try all(),active=remote.filter{$0.expiresAt>now}
    let ids=Set(active.map(\.id)),removed=local.filter{!ids.contains($0.id)}.map(\.id)
    try rememberRemoval(local.filter{removed.contains($0.id)},now:now)
    try save(active.map {test in local.first{$0.id==test.id} ?? test})
    return removed
  }
  // A remote notification can arrive before the app has fetched its fixture.
  // Merge only that fixture; never replace other tests or overwrite an answer.
  @discardableResult func receivePush(_ test:ResearchNotificationTest,now:Double=Date().timeIntervalSince1970) throws -> Bool {
    guard UUID(uuidString:test.id) != nil,test.delivery == "apns",test.expiresAt>now,
      test.createdAt<=now+300,test.expiresAt>test.createdAt,test.stationName.count<=80 else{return false}
    lock.lock();defer{lock.unlock()}
    guard (try tombstones()[test.id] ?? 0)<=now else{return false}
    var tests=try all()
    if tests.contains(where:{$0.id==test.id}) {return true}
    var received=test;received.status="scheduled";received.dirty=true
    tests.append(received);try save(tests);return true
  }
  @discardableResult func update(_ id:String,_ change:(inout ResearchNotificationTest)->Void) throws -> Bool {
    lock.lock();defer{lock.unlock()}
    var tests=try all()
    guard let index=tests.firstIndex(where:{$0.id==id}) else{return false}
    change(&tests[index]);try save(tests);return true
  }
  @discardableResult func answer(_ id:String,label:String?,now:Double=Date().timeIntervalSince1970) throws -> Bool {
    guard label == nil || ResearchConfirmation.label(for:label!) != nil || ["wrong_station","unsure"].contains(label!) else{return false}
    lock.lock();defer{lock.unlock()}
    guard let test=try all().first(where:{$0.id==id}),test.expiresAt>now else{return false}
    // Dismissing an old banner must not erase an explicit answer.
    if label == nil && test.label != nil {return false}
    return try update(id) {$0.label=label;$0.status=label == nil ? "dismissed" : "answered";$0.responseAt=now;$0.dirty=true}
  }
  func acknowledge(_ sent:ResearchNotificationTest) throws {
    try update(sent.id) {current in
      if current.status==sent.status && current.label==sent.label && current.responseAt==sent.responseAt {current.dirty=false}
    }
  }
  func remove(_ id:String) throws {
    lock.lock();defer{lock.unlock()}
    let tests=try all();try rememberRemoval(tests.filter{$0.id==id});try save(tests.filter{$0.id != id})
  }
  func erase() throws {lock.lock();defer{lock.unlock()};try rememberRemoval(all());try save([])}
}
