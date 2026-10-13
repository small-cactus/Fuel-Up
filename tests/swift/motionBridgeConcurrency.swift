@main struct Run {
  static func invoke(_ name: String, _ definitions: ModuleDefinition) async -> Any? {
    let f = definitions.first {$0.name == name}!
    return await withCheckedContinuation { continuation in
      f.queue.async {
        let promise = Promise { continuation.resume(returning: $0) }
        if let body = f.body as? (Promise) -> Void { body(promise) }
        else if let body = f.body as? (Double?, Promise) -> Void { body(600_000, promise) }
        else { fatalError("Unexpected test signature") }
      }
    }
  }
  @MainActor static func settle() async {
    try? await Task.sleep(nanoseconds: 100_000_000)
  }
  @MainActor static func main() async {
    let module = FuelUpDrivingActivityModule(), definitions = module.definition()
    _ = await invoke("startActivityUpdatesAsync", definitions)
    _ = await invoke("startActivityUpdatesAsync", definitions)
    precondition(CMMotionActivityManager.starts == 1, "Repeated starts coalesce")
    // Live callbacks contend with history replacements and empty-history reads.
    await withTaskGroup(of: Void.self) { group in
      for _ in 0..<1000 {
        group.addTask {
          CMMotionActivityManager.emit()
          let result = await invoke("getLatestActivityAsync", definitions) as? [String: Any]
          precondition(result?["confidence"] as? String == "high")
        }
      }
    }
    await settle()
    precondition(Probe.events == 1000, "Every live update is emitted")
    precondition(Probe.offMain == 0, "Event conversion stays on the main queue")
    CMMotionActivityManager.setHistoryEmpty(true)
    let cached = await invoke("getLatestActivityAsync", definitions) as? [String: Any]
    precondition(cached?["confidence"] as? String == "high", "Empty history retains cache")
    _ = await invoke("stopActivityUpdatesAsync", definitions)
    let count = Probe.events
    CMMotionActivityManager.emit(stream: 0); await settle()
    precondition(Probe.events == count, "Stopped callbacks must not emit")
    _ = await invoke("startActivityUpdatesAsync", definitions)
    CMMotionActivityManager.emit(stream: 0); await settle()
    precondition(Probe.events == count, "Old generation must not emit after restart")
    CMMotionActivityManager.emit(); await settle()
    precondition(Probe.events == count + 1, "New stream emits normally")
    _ = await invoke("stopActivityUpdatesAsync", definitions)
    CMMotionActivityManager.setAuthorization(.notDetermined)
    async let authorization = invoke("requestAuthorizationAsync", definitions)
    await settle()
    CMMotionActivityManager.setAuthorization(.authorized)
    CMMotionActivityManager.emit()
    let value = await authorization as? [String: String]
    precondition(value?["authorizationStatus"] == "authorized")
    await settle() // Pending polling must not settle the same promise twice.
    print("PASS 1000 overlapping live/history updates; cached reads; start/stop generations; authorization settlement; Thread Sanitizer clean")
  }
}
