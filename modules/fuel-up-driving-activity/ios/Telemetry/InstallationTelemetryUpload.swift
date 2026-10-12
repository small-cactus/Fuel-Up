import Foundation
import UIKit

@MainActor final class InstallationTelemetryUpload: NSObject, URLSessionDataDelegate {
  static let identifier = "com.anthonyh.fuelup.installation-upload"
  private let store: DrivingResearchStore
  private let identity: InstallationIdentity
  private let file: URL
  private var session: URLSession!
  private var ready = false
  private var busy = false
  private var responseData = Data()
  private var scheduled: Task<Void, Never>?
  private var retryAt = Date.distantPast
  private var failures = 0
  var completion: (() -> Void)?

  init(store: DrivingResearchStore, identity: InstallationIdentity, directory: URL) {
    self.store = store; self.identity = identity; file = directory.appendingPathComponent("upload.json")
    super.init()
    let config = URLSessionConfiguration.background(withIdentifier: Self.identifier)
    config.isDiscretionary = false; config.sessionSendsLaunchEvents = true
    config.allowsCellularAccess = true; config.allowsExpensiveNetworkAccess = true
    config.allowsConstrainedNetworkAccess = true; config.waitsForConnectivity = true
    config.timeoutIntervalForRequest = 30; config.timeoutIntervalForResource = 24 * 3600
    session = URLSession(configuration: config, delegate: self, delegateQueue: .main)
    session.getAllTasks { [weak self] tasks in
      Task { @MainActor in
        guard let self else { return }
        self.busy = !tasks.isEmpty; self.ready = true
        if !self.busy { self.schedule() }
      }
    }
  }
  func schedule() {
    guard scheduled == nil else { return }
    scheduled = Task { [weak self] in
      do { try await Task.sleep(nanoseconds: 2_000_000_000) } catch { return }
      self?.scheduled = nil; self?.flush()
    }
  }
  func flush() {
    guard ready, !busy else { return }
    if retryAt > Date() {
      guard scheduled == nil, UIApplication.shared.applicationState == .active else { return }
      let delay = retryAt.timeIntervalSinceNow
      scheduled = Task { [weak self] in
        do { try await Task.sleep(nanoseconds: UInt64(max(1, delay) * 1_000_000_000)) } catch { return }
        self?.scheduled = nil; self?.flush()
      }
      return
    }
    do {
      let events = try store.events(pending: true, limit: 50)
      guard !events.isEmpty else { return }
      let values = try JSONSerialization.jsonObject(with: JSONEncoder().encode(events))
      let body: [String: Any] = ["installationId": identity.id, "profile": InstallationProfile.snapshot(), "events": values]
      try JSONSerialization.data(withJSONObject: body).write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
      var request = URLRequest(url: URL(string: "https://vjindchxfebaltbslqwc.supabase.co/functions/v1/installation-telemetry")!)
      request.httpMethod = "POST"; request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.setValue(identity.token, forHTTPHeaderField: "x-installation-token")
      request.allowsCellularAccess = true
      busy = true; responseData = Data()
      session.uploadTask(with: request, fromFile: file).resume()
    } catch { retry() }
  }
  private func retry() {
    failures = min(failures + 1, 8)
    retryAt = Date().addingTimeInterval(min(3600, pow(2, Double(failures)) * 5))
    schedule()
  }
  nonisolated func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    Task { @MainActor in if self.responseData.count + data.count <= 32000 { self.responseData.append(data) } }
  }
  nonisolated func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    Task { @MainActor in
      self.busy = false
      do {
        guard error == nil, (task.response as? HTTPURLResponse)?.statusCode == 200,
          let result = try JSONSerialization.jsonObject(with: self.responseData) as? [String: Any],
          let ids = result["ids"] as? [String], !ids.isEmpty,
          let sent = try JSONSerialization.jsonObject(with: Data(contentsOf: self.file)) as? [String: Any],
          let events = sent["events"] as? [[String: Any]],
          Set(ids) == Set(events.compactMap { $0["id"] as? String }) else { throw URLError(.badServerResponse) }
        try self.store.acknowledge(ids); try? FileManager.default.removeItem(at: self.file)
        self.failures = 0; self.retryAt = .distantPast
        self.schedule()
      } catch { self.retry() }
    }
  }
  nonisolated func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
    Task { @MainActor in let complete = self.completion; self.completion = nil; complete?() }
  }
}
