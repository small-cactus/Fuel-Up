import Foundation
import UIKit
import CoreLocation

// First-party product events have their own identity/outbox, independent of the
// optional driving study. Only explicitly instrumented, allowlisted fields enter.
@MainActor final class InstallationTelemetry: NSObject, CLLocationManagerDelegate {
  static let shared = InstallationTelemetry()
  private var store: DrivingResearchStore?
  private var identity: InstallationIdentity?
  var installationId: String? { identity?.id }
  private var uploader: InstallationTelemetryUpload?
  private var observer: NSObjectProtocol?
  private let location = CLLocationManager()
  private var session = UUID().uuidString.lowercased()
  private var screen = "launch"
  private var segment = UUID().uuidString.lowercased()
  private var screenStarted: TimeInterval?
  private var active = false
  private var heartbeat: Task<Void, Never>?
  private var permissionSignature: Data?
  private var permissionCheck: Task<Void, Never>?
  private var pendingPermissionReason: String?
  private var pendingPermissionScreen: String?
  private let defaults = UserDefaults.standard

  func start() {
    guard store == nil else { return }
    do {
      let directory = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
        appropriateFor: nil, create: true).appendingPathComponent("InstallationTelemetry", isDirectory: true)
      identity = try InstallationIdentity.load()
      store = try DrivingResearchStore(directory: directory)
      uploader = InstallationTelemetryUpload(store: store!, identity: identity!, directory: directory)
      location.delegate = self
      observer = NotificationCenter.default.addObserver(forName: Notification.Name("FuelUpInstallationTelemetry"), object: nil, queue: .main) { [weak self] note in
        guard let info = note.userInfo, let kind = info["kind"] as? String, let fields = info["fields"] as? [String: Any] else { return }
        Task { @MainActor in self?.track(kind, fields) }
      }
      record("app_launch", ["reason": "process_start"])
      if UIApplication.shared.applicationState == .active { foreground() }
      checkPermissions(reason: "launch")
    } catch { /* Retry initialization next foreground; never block onboarding. */ }
  }
  func foreground() {
    if store == nil { start() }
    guard store != nil, !active else { checkPermissions(reason: "active"); return }
    active = true; session = UUID().uuidString.lowercased()
    segment = UUID().uuidString.lowercased()
    record("app_foreground", [:]); screenStarted = ProcessInfo.processInfo.systemUptime
    record("screen_view", [:]); checkPermissions(reason: "foreground")
    heartbeat?.cancel()
    heartbeat = Task { [weak self] in
      while !Task.isCancelled {
        do { try await Task.sleep(nanoseconds: 30_000_000_000) } catch { return }
        guard let self, self.active else { return }
        // Cumulative observed dwell; analysts take max per screen segment, not sum.
        self.record("screen_heartbeat", self.duration())
      }
    }
    uploader?.flush()
  }
  func background() {
    guard active else { return }
    record("screen_exit", duration()); screenStarted = nil
    record("app_background", [:]); active = false; heartbeat?.cancel(); heartbeat = nil
    uploader?.flush()
  }
  func setScreen(_ name: String) {
    let next = String(name.prefix(80))
    guard next != screen else { return }
    if active { record("screen_exit", duration()) }
    let previous = screen; screen = next; segment = UUID().uuidString.lowercased()
    screenStarted = active ? ProcessInfo.processInfo.systemUptime : nil
    if active { record("screen_view", ["previousScreen": previous]) }
  }
  func track(_ kind: String, _ fields: [String: Any]) {
    if store == nil { start() }
    if kind == "screen_view", let name = fields["screen"] as? String { setScreen(name); return }
    if kind == "onboarding_step", let step = fields["step"] as? Int { setScreen("onboarding/\(step)") }
    record(kind, fields)
    if kind == "permission_request" {
      pendingPermissionReason = fields["permission"] as? String
      pendingPermissionScreen = screen
    }
    if kind == "permission_request" || kind == "research_consent" { checkPermissions(reason: kind) }
  }
  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) { checkPermissions(reason: "location_change") }
  func checkPermissions(reason: String) {
    permissionCheck?.cancel()
    let atScreen = pendingPermissionScreen ?? screen
    let request = pendingPermissionReason
    permissionCheck = Task { [weak self] in
      let values = await InstallationProfile.permissions()
      guard let self, !Task.isCancelled else { return }
      let signature = try? JSONSerialization.data(withJSONObject: values, options: .sortedKeys)
      if signature != self.permissionSignature {
        self.permissionSignature = signature
        var fields = values; fields["reason"] = reason; fields["screen"] = atScreen
        if let request { fields["permission"] = request }
        self.record("permission_snapshot", fields)
        self.pendingPermissionReason = nil; self.pendingPermissionScreen = nil
      }
    }
  }
  private func duration() -> [String: Any] {
    guard let started = screenStarted else { return [:] }
    return ["durationSeconds": max(0, ProcessInfo.processInfo.systemUptime - started), "durationIsObserved": true]
  }
  private func record(_ kind: String, _ fields: [String: Any]) {
    guard let store else { return }
    var payload = fields
    payload["schemaVersion"] = 1; payload["sessionId"] = session; payload["screenSegmentId"] = segment
    payload["build"] = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""
    if payload["screen"] == nil { payload["screen"] = screen }
    // All payloads are small structured facts, never full provider/UI objects.
    guard InstallationEventPolicy.accepts(kind, payload), JSONSerialization.isValidJSONObject(payload),
          let encoded = try? JSONSerialization.data(withJSONObject: payload), encoded.count <= 4096 else { return }
    do { try store.append(ResearchEvent(kind: kind, payload: payload)); uploader?.schedule() }
    catch { /* Durable unsent queue is preserved; UI continues even if storage is full. */ }
  }
  func handleBackgroundSession(_ identifier: String, completion: @escaping () -> Void) -> Bool {
    guard identifier == InstallationTelemetryUpload.identifier else { return false }
    if store == nil { start() }
    guard let uploader else { completion(); return true }
    uploader.completion = completion
    return true
  }
}
