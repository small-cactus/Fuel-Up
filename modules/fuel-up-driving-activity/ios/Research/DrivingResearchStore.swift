import Foundation
import SQLite3

// Serial durable outbox; IDs survive retries. Never discard unacknowledged data.
final class DrivingResearchStore {
  private var db: OpaquePointer?
  private let queue = DispatchQueue(label: "fuelup.research.storage", qos: .utility)
  private let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
  private(set) var url: URL
  init(directory: URL) throws {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    var folder = directory; var values = URLResourceValues(); values.isExcludedFromBackup = true
    try folder.setResourceValues(values)
    url = directory.appendingPathComponent("research.sqlite")
    guard sqlite3_open(url.path, &db) == SQLITE_OK else { throw failure() }
    try execute("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, kind TEXT NOT NULL, recorded REAL NOT NULL, body BLOB NOT NULL, uploaded INTEGER NOT NULL DEFAULT 0); CREATE INDEX IF NOT EXISTS pending ON events(uploaded,recorded);")
    #if os(iOS)
    try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: directory.path)
    for suffix in ["", "-wal", "-shm"] where FileManager.default.fileExists(atPath: url.path + suffix) {
      try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: url.path + suffix)
    }
    #endif
  }
  deinit { sqlite3_close(db) }
  private func failure() -> NSError { NSError(domain: "ResearchStorage", code: Int(sqlite3_errcode(db)), userInfo: [NSLocalizedDescriptionKey: "Research storage is unavailable. Collection is paused."]) }
  private func execute(_ sql: String) throws { guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw failure() } }
  private func statement(_ sql: String) throws -> OpaquePointer {
    var s: OpaquePointer?; guard sqlite3_prepare_v2(db,sql,-1,&s,nil) == SQLITE_OK, let s else { throw failure() }; return s
  }
  func append(_ event: ResearchEvent) throws {
    try queue.sync {
      // Stop rather than silently lose raw records if uploads cannot keep up.
      let count = try scalar("SELECT count(*) FROM events WHERE uploaded=0")
      guard count < 100_000 else { throw NSError(domain:"ResearchStorage",code:2,userInfo:[NSLocalizedDescriptionKey:"Offline queue is full. Sync before resuming collection."]) }
      let data = try JSONEncoder().encode(event), s = try statement("INSERT INTO events VALUES(?,?,?,?,0)")
      defer { sqlite3_finalize(s) }
      sqlite3_bind_text(s,1,event.id,-1,transient); sqlite3_bind_text(s,2,event.kind,-1,transient); sqlite3_bind_double(s,3,event.recordedAt)
      _ = data.withUnsafeBytes { sqlite3_bind_blob(s,4,$0.baseAddress,Int32(data.count),transient) }
      guard sqlite3_step(s) == SQLITE_DONE else { throw failure() }
    }
  }
  private func scalar(_ sql: String) throws -> Int {
    let s=try statement(sql); defer {sqlite3_finalize(s)}
    guard sqlite3_step(s) == SQLITE_ROW else {throw failure()}; return Int(sqlite3_column_int64(s,0))
  }
  func counts() throws -> (pending:Int,total:Int) {
    try queue.sync {(try scalar("SELECT count(*) FROM events WHERE uploaded=0"),try scalar("SELECT count(*) FROM events"))}
  }
  func events(pending: Bool = false, limit: Int = 200) throws -> [ResearchEvent] {
    try queue.sync {
      let s = try statement("SELECT body FROM events \(pending ? "WHERE uploaded=0" : "") ORDER BY recorded \(pending ? "ASC" : "DESC") LIMIT \(min(1000,max(1,limit)))")
      defer {sqlite3_finalize(s)}; var result:[ResearchEvent]=[]
      while sqlite3_step(s) == SQLITE_ROW {
        let data=Data(bytes:sqlite3_column_blob(s,0),count:Int(sqlite3_column_bytes(s,0)))
        result.append(try JSONDecoder().decode(ResearchEvent.self,from:data))
      }
      return result
    }
  }
  func acknowledge(_ ids: [String]) throws {
    try queue.sync {
      try execute("BEGIN IMMEDIATE")
      do {
        for id in ids {
          let s=try statement("UPDATE events SET uploaded=1 WHERE id=?")
          sqlite3_bind_text(s,1,id,-1,transient)
          let code=sqlite3_step(s);sqlite3_finalize(s);guard code == SQLITE_DONE else {throw failure()}
        }
        // Keep one month locally for diagnostics, retaining all unsent records.
        try execute("DELETE FROM events WHERE uploaded=1 AND recorded < \(Date().timeIntervalSince1970-30*86400)")
        try execute("COMMIT")
      } catch {try? execute("ROLLBACK");throw error}
    }
  }
  func erase() throws {try queue.sync {try execute("DELETE FROM events; PRAGMA wal_checkpoint(TRUNCATE); VACUUM;")}}
}
