import Foundation
import SQLite3
import CryptoKit

// Real legacy SQLite outbox, then the production initializer's migration.
// Timings are a local synthetic read benchmark, not device frame measurements.
@main struct ResearchStoreIndexTests {
  static let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
  static func execute(_ db: OpaquePointer, _ sql: String) {
    precondition(sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK, String(cString: sqlite3_errmsg(db)))
  }
  static func statement(_ db: OpaquePointer, _ sql: String) -> OpaquePointer {
    var result: OpaquePointer?
    precondition(sqlite3_prepare_v2(db, sql, -1, &result, nil) == SQLITE_OK)
    return result!
  }
  static func plan(_ db: OpaquePointer, _ sql: String) -> [String] {
    let s = statement(db, "EXPLAIN QUERY PLAN " + sql)
    defer { sqlite3_finalize(s) }
    var result: [String] = []
    while sqlite3_step(s) == SQLITE_ROW { result.append(String(cString: sqlite3_column_text(s, 3))) }
    return result
  }
  static func rows(_ db: OpaquePointer, _ sql: String) throws -> [ResearchEvent] {
    let s = statement(db, sql)
    defer { sqlite3_finalize(s) }
    var result: [ResearchEvent] = []
    while sqlite3_step(s) == SQLITE_ROW {
      result.append(try JSONDecoder().decode(ResearchEvent.self,
        from: Data(bytes: sqlite3_column_blob(s, 0), count: Int(sqlite3_column_bytes(s, 0)))))
    }
    return result
  }
  static func fingerprint(_ db: OpaquePointer) -> String {
    let s = statement(db, "SELECT id,kind,recorded,body,uploaded FROM events ORDER BY id")
    defer { sqlite3_finalize(s) }
    var hash = SHA256()
    while sqlite3_step(s) == SQLITE_ROW {
      for column: Int32 in 0..<5 {
        let length = Int(sqlite3_column_bytes(s, column))
        hash.update(data: Data("\(column):\(length):".utf8))
        if length > 0 { hash.update(data: Data(bytes: sqlite3_column_blob(s, column), count: length)) }
      }
    }
    return hash.finalize().map { String(format: "%02x", $0) }.joined()
  }
  static func measure(_ read: () throws -> [ResearchEvent]) rethrows -> Double {
    _ = try read() // Both sides get a warm read; creation/migration isn't timed.
    var milliseconds: [Double] = []
    for _ in 0..<9 {
      let start = ProcessInfo.processInfo.systemUptime
      let result = try read()
      precondition(result.count == 12)
      milliseconds.append((ProcessInfo.processInfo.systemUptime - start) * 1000)
    }
    return milliseconds.sorted()[4]
  }
  static func main() throws {
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: folder) }
    var connection: OpaquePointer?
    precondition(sqlite3_open(folder.appendingPathComponent("research.sqlite").path, &connection) == SQLITE_OK)
    let db = connection!
    defer { sqlite3_close(db) }
    execute(db, """
      PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE events(id TEXT PRIMARY KEY,kind TEXT NOT NULL,recorded REAL NOT NULL,body BLOB NOT NULL,uploaded INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX pending ON events(uploaded,recorded);
      CREATE INDEX event_kind_time ON events(kind,recorded);
      BEGIN IMMEDIATE;
      """)
    let insert = statement(db, "INSERT INTO events VALUES(?,?,?,?,?)")
    let count = 100_000
    var expected: [(id: String, time: Double, pending: Bool)] = []
    let payload = String(repeating: "synthetic", count: 80)
    for i in 0..<count {
      let time = Double((i * 7919) % count) // Unique, deliberately not insertion order.
      let event = try ResearchEvent(kind: i % 2 == 0 ? "diagnostic" : "location",
                                    payload: ["synthetic": payload, "ordinal": i], now: time)
      let data = try JSONEncoder().encode(event)
      let pending = i % 4 == 0
      expected.append((event.id, time, pending))
      sqlite3_bind_text(insert, 1, event.id, -1, transient)
      sqlite3_bind_text(insert, 2, event.kind, -1, transient)
      sqlite3_bind_double(insert, 3, time)
      _ = data.withUnsafeBytes { sqlite3_bind_blob(insert, 4, $0.baseAddress, Int32(data.count), transient) }
      sqlite3_bind_int(insert, 5, pending ? 0 : 1)
      precondition(sqlite3_step(insert) == SQLITE_DONE)
      sqlite3_reset(insert); sqlite3_clear_bindings(insert)
    }
    sqlite3_finalize(insert); execute(db, "COMMIT")
    let query = "SELECT body FROM events ORDER BY recorded DESC LIMIT 12"
    let beforePlan = plan(db, query)
    precondition(beforePlan.contains { $0.contains("USE TEMP B-TREE") })
    let beforeHash = fingerprint(db)
    let beforeMS = try measure { try rows(db, query) }

    let store = try DrivingResearchStore(directory: folder)
    // Refresh the fixture connection's schema after the production connection
    // performs DDL. SQLite reparses ordinary statements on their first step.
    _ = try rows(db, query)
    let afterPlan = plan(db, query)
    precondition(afterPlan.contains { $0.contains("event_recorded_time") }, afterPlan.joined(separator: "; "))
    precondition(!afterPlan.contains { $0.contains("TEMP B-TREE") })
    precondition(beforeHash == fingerprint(db), "Migration must preserve every raw field and upload flag")
    let actual = try store.events(limit: 12)
    precondition(actual.map(\.id) == expected.sorted { $0.time > $1.time }.prefix(12).map(\.id))
    let pending = try store.events(pending: true, limit: 12)
    precondition(pending.map(\.id) == expected.filter(\.pending).sorted { $0.time < $1.time }.prefix(12).map(\.id))
    let counts = try store.counts()
    precondition(counts.total == count && counts.pending == count / 4)
    let afterMS = try measure { try store.events(limit: 12) }
    let reopened = try DrivingResearchStore(directory: folder)
    let reopenedEvents = try reopened.events(limit: 12)
    precondition(reopenedEvents.map(\.id) == actual.map(\.id), "Migration must be idempotent")
    precondition(beforeHash == fingerprint(db))
    // The production initializer keeps WAL + FULL; also verify migration did
    // not change the existing connection's durability configuration.
    let sync = statement(db, "PRAGMA synchronous")
    precondition(sqlite3_step(sync) == SQLITE_ROW && sqlite3_column_int(sync, 0) == 2)
    sqlite3_finalize(sync)
    let summary: [String: Any] = ["rows": count, "warmReadRepetitions": 9,
      "beforePlan": beforePlan, "afterPlan": afterPlan,
      "beforeMedianMilliseconds": beforeMS, "afterMedianMilliseconds": afterMS,
      "scope": "Local macOS synthetic recent-12 read; no device FPS claim",
      "preservedRawFingerprint": beforeHash]
    print(String(decoding: try JSONSerialization.data(withJSONObject: summary, options: [.prettyPrinted, .sortedKeys]), as: UTF8.self))
    print("PASS: populated legacy migration, immutable rows, recent/pending ordering, indexed query plan, reopen")
  }
}
