import Foundation

class Exception: Error { init() {} }
final class GenericException: Exception { init(_ message: String) { super.init() } }
final class MotionActivityUnavailableException: Exception {}
final class Promise {
  private let done: (Any?) -> Void
  init(_ done: @escaping (Any?) -> Void) { self.done = done }
  func resolve(_ value: Any?) { done(value) }
  func reject(_ error: Error) { done(nil) }
}
final class TestFunction {
  let name: String
  let body: Any
  var queue = DispatchQueue(label: "test.expo.default")
  init(_ name: String, _ body: Any) { self.name = name; self.body = body }
  func runOnQueue(_ queue: DispatchQueue) -> Self { self.queue = queue; return self }
}
func AsyncFunction<R>(_ name: String, @_implicitSelfCapture _ body: @escaping () -> R) -> TestFunction { TestFunction(name, body) }
func AsyncFunction<A,R>(_ name: String, @_implicitSelfCapture _ body: @escaping (A) -> R) -> TestFunction { TestFunction(name, body) }
func AsyncFunction<A,B,R>(_ name: String, @_implicitSelfCapture _ body: @escaping (A,B) -> R) -> TestFunction { TestFunction(name, body) }
typealias ModuleDefinition = [TestFunction]
@resultBuilder enum ModuleBuilder {
  static func buildBlock(_ items: TestFunction...) -> ModuleDefinition { items }
}
protocol Module { @ModuleBuilder func definition() -> ModuleDefinition }
extension Module {
  func sendEvent(_ name: String, _ payload: [String: Any?]) { Probe.receive(payload) }
}
// All fake-framework shared state is locked, so sanitizer failures identify the
// production bridge rather than the fixtures that drive it.
enum Probe {
  static let lock = NSLock()
  static var events = 0
  static var offMain = 0
  static func receive(_ payload: [String: Any?]) {
    precondition((payload["confidence"] as? String) == "high")
    lock.lock(); defer {lock.unlock()}
    events += 1
    if !Thread.isMainThread {offMain += 1}
  }
}
enum CMAuthorizationStatus { case authorized, denied, restricted, notDetermined }
enum Confidence { case low, medium, high }
struct CMMotionActivity {
  var automotive = true, stationary = false, walking = false, running = false, cycling = false, unknown = false
  var confidence = Confidence.high
  var startDate = Date()
}
final class CMMotionActivityManager {
  typealias Callback = (CMMotionActivity?) -> Void
  static let lock = NSLock()
  static var streams: [(OperationQueue, Callback)] = []
  static var starts = 0
  static var authorization = CMAuthorizationStatus.authorized
  static var historyEmpty = false
  static func isActivityAvailable() -> Bool { true }
  static func authorizationStatus() -> CMAuthorizationStatus {
    lock.lock(); defer {lock.unlock()}; return authorization
  }
  static func setAuthorization(_ value: CMAuthorizationStatus) {
    lock.lock(); defer {lock.unlock()}; authorization = value
  }
  static func setHistoryEmpty(_ value: Bool) {
    lock.lock(); defer {lock.unlock()}; historyEmpty = value
  }
  func startActivityUpdates(to queue: OperationQueue, withHandler callback: @escaping Callback) {
    Self.lock.lock(); defer {Self.lock.unlock()}
    Self.starts += 1; Self.streams.append((queue, callback))
  }
  func stopActivityUpdates() {} // Queued callbacks can still arrive after stop.
  static func emit(stream: Int? = nil) {
    lock.lock(); let target = streams[stream ?? (streams.count - 1)]; lock.unlock()
    target.0.addOperation { target.1(CMMotionActivity()) }
  }
  func queryActivityStarting(from: Date, to: Date, to queue: OperationQueue,
                             withHandler callback: @escaping ([CMMotionActivity]?, Error?) -> Void) {
    Self.lock.lock(); let empty = Self.historyEmpty; Self.lock.unlock()
    queue.addOperation { callback(empty ? [] : [CMMotionActivity()], nil) }
  }
}
