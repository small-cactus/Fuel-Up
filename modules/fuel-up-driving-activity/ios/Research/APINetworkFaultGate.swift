import Foundation

// Only the developer switch and transport know about dropped responses. The
// request's ordinary deadline/cancellation still releases every continuation.
@MainActor final class APINetworkFaultGate {
  static let shared = APINetworkFaultGate()
  private var enabled = false
  private var waiting: [UUID: CheckedContinuation<Void, Error>] = [:]
  func setEnabled(_ value: Bool) {
    enabled = value
    if !value {
      let pending = Array(waiting.values)
      waiting.removeAll()
      for continuation in pending { continuation.resume() }
    }
  }
  func waitForDelivery(until deadline: Date) async throws {
    try Task.checkCancellation()
    guard deadline > Date() else { throw URLError(.timedOut) }
    guard enabled else { return }
    let id = UUID()
    let timeout = Task {
      do { try await Task.sleep(for: .seconds(max(0, deadline.timeIntervalSinceNow))) }
      catch { return }
      waiting.removeValue(forKey: id)?.resume(throwing: URLError(.timedOut))
    }
    defer { timeout.cancel() }
    try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
        if Task.isCancelled { continuation.resume(throwing: CancellationError()) }
        else { waiting[id] = continuation }
      }
    } onCancel: {
      Task { @MainActor in
        self.waiting.removeValue(forKey: id)?.resume(throwing: CancellationError())
      }
    }
  }
}
