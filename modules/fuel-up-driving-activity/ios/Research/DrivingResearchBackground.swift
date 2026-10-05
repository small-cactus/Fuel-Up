import BackgroundTasks
import UIKit

@MainActor
enum DrivingResearchBackground {
  static let identifier="com.anthonyh.fuelup.research-sync"
  static func register() {
    BGTaskScheduler.shared.register(forTaskWithIdentifier:identifier,using:.main) { task in
      Task { @MainActor in
        let collector=DrivingResearchCollector.shared
        guard collector.consented,collector.enabled || UserDefaults.standard.string(forKey:"research.syncMode") != nil else {task.setTaskCompleted(success:true);return}
        schedule();collector.prepare();collector.resume(reason:"background_sync")
        let work=Task { @MainActor in
          await DrivingResearchSync.shared.backgroundWork()
          task.setTaskCompleted(success:!Task.isCancelled)
        }
        task.expirationHandler={ work.cancel();Task { @MainActor in DrivingResearchSync.shared.expire() } }
      }
    }
  }
  static func schedule() {
    guard UserDefaults.standard.bool(forKey:DrivingResearchCollector.consentKey),UserDefaults.standard.bool(forKey:DrivingResearchCollector.enabledKey) || UserDefaults.standard.string(forKey:"research.syncMode") != nil else{return}
    let request=BGProcessingTaskRequest(identifier:identifier)
    request.requiresNetworkConnectivity=true
    request.requiresExternalPower=false
    request.earliestBeginDate=Date().addingTimeInterval(15*60)
    // Keep an existing request's earlier date rather than postponing each fix.
    BGTaskScheduler.shared.getPendingTaskRequests { requests in
      guard !requests.contains(where:{$0.identifier==identifier}) else{return}
      try? BGTaskScheduler.shared.submit(request)
    }
  }
  static func cancel() {BGTaskScheduler.shared.cancel(taskRequestWithIdentifier:identifier)}
}
