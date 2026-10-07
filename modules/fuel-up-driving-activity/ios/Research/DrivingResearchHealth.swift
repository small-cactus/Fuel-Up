import Foundation
import Combine

struct ResearchTrackingIssue: Equatable {
  let id:String
  let message:String
}

/// An unresolved problem alerts once, including across launches. Once it is
/// observed healthy again, a recurrence is a new incident.
struct ResearchHealthAlertState: Codable {
  var reported=Set<String>()
  mutating func pending(_ issues:[ResearchTrackingIssue])->[ResearchTrackingIssue] {
    reported.formIntersection(issues.map(\.id))
    return issues.filter{!reported.contains($0.id)}
  }
  mutating func acknowledge(_ issues:[ResearchTrackingIssue]) {
    reported.formUnion(issues.map(\.id))
  }
}

@MainActor
final class DrivingResearchHealth: ObservableObject {
  static let shared=DrivingResearchHealth()
  @Published private(set) var message:String?
  private let key="research.healthAlerts.v1"
  private var state:ResearchHealthAlertState
  private var issues:[ResearchTrackingIssue]=[]
  private var revision=0
  private var suspended=false
  private var task:Task<Void,Never>?

  private init() {
    state=UserDefaults.standard.data(forKey:key).flatMap{try? JSONDecoder().decode(ResearchHealthAlertState.self,from:$0)} ?? ResearchHealthAlertState()
  }
  func update(_ current:[ResearchTrackingIssue],enabled:Bool,settingUp:Bool) {
    // An explicit pause/deletion always clears alerts; an active setup should
    // finish before we diagnose permissions that the person is still granting.
    suspended=enabled && settingUp
    issues=enabled ? current : []
    message=issues.isEmpty || suspended ? nil : issues.map { NSLocalizedString($0.message, comment: "") }.joined(separator:" ")
    revision+=1
    guard task == nil else{return}
    task=Task {
      defer{task=nil}
      while true {
        let generation=revision
        if suspended {
          DrivingResearchNotifications.shared.clearTrackingHealth()
          break
        }
        if !state.reported.isSubset(of:Set(issues.map(\.id))) {
          DrivingResearchNotifications.shared.clearTrackingHealth()
        }
        let pending=state.pending(issues)
        persist()
        if issues.isEmpty {
          DrivingResearchNotifications.shared.clearTrackingHealth()
        } else if !pending.isEmpty {
          let sent=await DrivingResearchNotifications.shared.scheduleTrackingHealth(pending.map { NSLocalizedString($0.message, comment: "") }.joined(separator:" "))
          if sent,generation == revision {state.acknowledge(pending);persist()}
        }
        if generation == revision {break}
      }
    }
  }
  private func persist() {
    if let data=try? JSONEncoder().encode(state) {UserDefaults.standard.set(data,forKey:key)}
  }
}
