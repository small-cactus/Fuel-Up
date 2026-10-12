import Foundation
import UIKit

@MainActor enum InstallationPushHandler {
  static func handle(_ userInfo: [AnyHashable: Any], completion: @escaping (UIBackgroundFetchResult) -> Void) {
    guard let requestID = userInfo["requestId"] as? String, UUID(uuidString: requestID) != nil,
      let installationID = userInfo["installationId"] as? String,
      let identity = try? InstallationIdentity.load(), installationID.lowercased() == identity.id.lowercased(),
      let aps = userInfo["aps"] as? [String: Any], aps["content-available"] as? Int == 1 else {
      completion(.noData); return
    }
    var finished = false
    var work: Task<Void, Never>?
    let timeout = Task { @MainActor in
      do { try await Task.sleep(for: .seconds(25)) } catch { return }
      guard !finished else { return }
      finished = true; work?.cancel()
      // Existing background URLSession uploads remain durable and may finish
      // later. Do not acknowledge command completion merely on push receipt.
      completion(.failed)
    }
    work = Task { @MainActor in
      let synced = await InstallationSync.shared.sync(requestID: requestID)
      guard !finished else { return }
      finished = true; timeout.cancel()
      completion(synced ? .newData : .noData)
    }
  }
}
