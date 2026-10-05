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

  var title: String {ResearchConfirmation.notificationTitle(candidate:candidate,stationName:stationName)}
  var summary: String {
    if let label {return "\(ResearchConfirmation.title(for:label)) · \(dirty == true ? "Waiting to sync" : "Answer synced")"}
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
  private func save(_ tests:[ResearchNotificationTest]) throws {
    try FileManager.default.createDirectory(at:url.deletingLastPathComponent(),withIntermediateDirectories:true)
    try JSONEncoder().encode(tests).write(to:url,options:.atomic)
  }
  @discardableResult func reconcile(_ remote:[ResearchNotificationTest],now:Double=Date().timeIntervalSince1970) throws -> [String] {
    lock.lock();defer{lock.unlock()}
    let local=try all(),active=remote.filter{$0.expiresAt>now}
    let ids=Set(active.map(\.id)),removed=local.filter{!ids.contains($0.id)}.map(\.id)
    try save(active.map {test in local.first{$0.id==test.id} ?? test})
    return removed
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
    lock.lock();defer{lock.unlock()};try save(all().filter{$0.id != id})
  }
  func erase() throws {lock.lock();defer{lock.unlock()};try save([])}
}
