import Foundation
import UIKit

// App-usage transport only. Never touches research identity, consent or sensors.
@MainActor final class InstallationSync {
  static let shared = InstallationSync()
  private var token: String?
  private var registering = false
  private var lastRegistration = Date.distantPast
  private var lastControl = Date.distantPast
  private var syncing = false
  private let session: URLSession = {
    let config = URLSessionConfiguration.ephemeral
    config.timeoutIntervalForRequest = 10
    config.timeoutIntervalForResource = 12
    config.allowsCellularAccess = true
    return URLSession(configuration: config)
  }()

  func activate() {
    // Obtaining an APNs address does not request visible-alert authorization.
    if Date().timeIntervalSince(lastRegistration) >= 60 {
      lastRegistration = Date()
      UIApplication.shared.registerForRemoteNotifications()
      Task { await registerToken() }
    }
    // A cold background launch leaves command ownership to the push handler,
    // which holds the system completion callback until upload or expiry.
    if UIApplication.shared.applicationState == .active, Date().timeIntervalSince(lastControl) >= 900 {
      lastControl = Date()
      Task { _ = await sync(requestID: nil) }
    }
  }
  func registered(_ data: Data) {
    token = data.map { String(format: "%02x", $0) }.joined()
    Task { await registerToken() }
  }
  func failed() { lastRegistration = .distantPast }
  private func registerToken() async {
    guard !registering, let token, let environment = DrivingResearchPushRegistration.environment() else { return }
    registering = true
    defer { registering = false }
    do {
      _ = try await send("registerPush", fields: ["deviceToken": token, "environment": environment])
    } catch { lastRegistration = .distantPast }
    // If APNs rotated the address during this request, register the newest one.
    if self.token != token { Task { await registerToken() } }
  }
  private func send(_ action: String, fields: [String: Any] = [:]) async throws -> [String: Any] {
    try Task.checkCancellation()
    let identity = try InstallationIdentity.load()
    var body = fields
    body["action"] = action; body["installationId"] = identity.id
    var request = URLRequest(url: URL(string: "https://vjindchxfebaltbslqwc.supabase.co/functions/v1/installation-telemetry")!)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue(identity.token, forHTTPHeaderField: "x-installation-token")
    request.httpBody = try JSONSerialization.data(withJSONObject: body)
    let (data, response) = try await session.data(for: request)
    try Task.checkCancellation()
    guard (response as? HTTPURLResponse)?.statusCode == 200,
      let result = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw URLError(.badServerResponse) }
    return result
  }
  func sync(requestID: String?) async -> Bool {
    guard !syncing else { return false }
    syncing = true
    defer { syncing = false }
    do {
      let fields: [String: Any] = requestID.map { ["requestId": $0] } ?? [:]
      let control = try await send("control", fields: fields)
      guard let id = control["requestId"] as? String, UUID(uuidString: id) != nil else { return false }
      // The server authenticates this command to this installation. A push is
      // just a hint, and cannot fabricate another installation's request.
      guard await InstallationTelemetry.shared.drainForSync() else { return false }
      let complete = try await send("completeSync", fields: ["requestId": id])
      return complete["completed"] as? Bool == true
    } catch { return false }
  }
}
