import UserNotifications

// Test art is bundled locally: no image download or research data access.
final class NotificationService: UNNotificationServiceExtension {
  private var handler: ((UNNotificationContent) -> Void)?
  private var content: UNNotificationContent?

  override func didReceive(_ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
    handler = contentHandler
    content = request.content
    if request.content.categoryIdentifier == "fuelup.research.test.v1",
       let modified = request.content.mutableCopy() as? UNMutableNotificationContent,
       let source = Bundle.main.url(forResource: "fuelup-test-blue", withExtension: "png") {
      // The system moves attachments, so hand it a disposable copy of our asset.
      let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
      do {
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let image = folder.appendingPathComponent("fuelup-test-blue.png")
        try FileManager.default.copyItem(at: source, to: image)
        modified.attachments = [try UNNotificationAttachment(identifier: "fuelup-test-blue", url: image)]
        content = modified
      } catch { /* Deliver the actionable alert even if attachment preparation fails. */ }
    }
    finish()
  }

  override func serviceExtensionTimeWillExpire() { finish() }

  private func finish() {
    guard let handler, let content else { return }
    self.handler = nil
    handler(content)
  }
}
