import ExpoModulesCore
import SwiftUI

final class DrivingResearchInsets: ObservableObject {
  @Published var top: CGFloat = 0
  @Published var bottom: CGFloat = 0
}

final class DrivingResearchView: ExpoView {
  private var host:UIHostingController<DrivingResearchScreen>?
  private let contentInsets = DrivingResearchInsets()
  required init(appContext:AppContext?=nil) {
    super.init(appContext:appContext)
    let controller=UIHostingController(rootView:DrivingResearchScreen(contentInsets: contentInsets))
    if #available(iOS 16.4,*) {controller.safeAreaRegions=[]}
    controller.view.backgroundColor = .clear;host=controller;addSubview(controller.view)
  }
  func setDark(_ dark:Bool) {host?.overrideUserInterfaceStyle=dark ? .dark : .light}
  func setTopInset(_ value: Double) {contentInsets.top = max(0, value)}
  func setBottomInset(_ value: Double) {contentInsets.bottom = max(0, value)}
  override func layoutSubviews() {super.layoutSubviews();host?.view.frame=bounds}
  override func didMoveToWindow() {
    super.didMoveToWindow();guard let host else{return}
    if window==nil {host.willMove(toParent:nil);host.view.removeFromSuperview();host.removeFromParent()}
    else if host.parent==nil {
      var responder:UIResponder?=self
      while let next=responder?.next {
        if let parent=next as? UIViewController {parent.addChild(host);addSubview(host.view);host.didMove(toParent:parent);break}
        responder=next
      }
    }
  }
}

struct DrivingResearchScreen: View {
  @ObservedObject var contentInsets: DrivingResearchInsets
  @ObservedObject private var collector = DrivingResearchCollector.shared
  @ObservedObject private var transfer = DrivingResearchSync.shared
  @ObservedObject private var notificationTests = DrivingResearchTestNotifications.shared
  @Environment(\.scenePhase) private var scenePhase
  @Environment(\.dynamicTypeSize) private var typeSize
  @State private var confirmDelete = false
  @State private var confirmDeleteAgain = false
  @State private var showConsent = false
  @State private var presentedIntroduction = false
  @State private var selectedVisit: ResearchVisit?
  @State private var selectedTest: String?
  @State private var labelMessage: String?

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 24) {
        Text("Driving Research").font(.largeTitle.bold())
          .accessibilityAddTraits(.isHeader)
        glassCard {
          HStack(spacing: 14) {
            Image(systemName: "person.2.fill").font(.title2).foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 4) {
              Text(collector.enabled && collector.ready ? "Collecting" : collector.enabled ? "Finish setup" : "Paused")
                .font(.headline)
              if collector.enabled {Text(collector.status).font(.subheadline).foregroundStyle(.secondary)}
            }
            Spacer(minLength: 0)
            if collector.busy {ProgressView()}
          }.accessibilityIdentifier("research-status")
          let layout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(spacing: 12)) : AnyLayout(HStackLayout(spacing: 12))
          layout {
            Button {
              if collector.enabled {collector.pause()}
              else if collector.consented {Task {await collector.enable()}}
              else {showConsent = true}
            } label: {
              Label(collector.enabled ? "Pause" : "Enable", systemImage: collector.enabled ? "pause.fill" : "record.circle")
                .frame(maxWidth: .infinity).frame(minHeight: 32)
            }
            .buttonStyle(.glassProminent).tint(.blue).disabled(collector.busy)
            .accessibilityIdentifier(collector.enabled ? "research-pause" : "research-enable")
            if collector.consented {
              Button {collector.sync(force:true)} label: {
                HStack(spacing: 6) {
                  if transfer.syncing {ProgressView()} else {Image(systemName: "arrow.triangle.2.circlepath")}
                  Text("Sync Data")
                }.frame(maxWidth: .infinity).frame(minHeight: 32)
              }.buttonStyle(.glass).disabled(transfer.syncing || collector.busy)
                .accessibilityIdentifier("research-sync")
            }
          }
          if let message=transfer.message {Text(message).font(.caption).foregroundStyle(.secondary)}
        }
        if let issue = collector.issue {
          Label(issue, systemImage: "exclamationmark.circle")
            .font(.subheadline).foregroundStyle(.secondary).accessibilityIdentifier("research-issue")
        }
        if collector.consented && needsPermissions {
          section("Permissions") {
            if collector.locationPermission != "Always" {row("Location", collector.locationPermission, icon:"location.fill")}
            if !collector.precise {row("Precise Location", "Off", icon:"scope")}
            if collector.motionPermission != "Allowed" {row("Motion & Fitness", collector.motionPermission, icon:"figure.walk")}
            if collector.notificationPermission != "On" && collector.notificationPermission != "Checking" {row("Stop Notifications",collector.notificationPermission,icon:"bell.badge")}
            if UIApplication.shared.backgroundRefreshStatus != .available {row("Background App Refresh","Off",icon:"arrow.clockwise")}
            if collector.notificationPermission == "Not requested" {
              Button("Enable Stop Notifications",systemImage:"bell") {Task {await collector.requestStopNotifications()}}
                .frame(maxWidth:.infinity,alignment:.leading).frame(minHeight:44)
            }
            if !collector.ready {
              Button("Finish Setup",systemImage:"checkmark.shield") {collector.requestPermissions()}
                .frame(maxWidth:.infinity,alignment:.leading).frame(minHeight:44)
            }
            Button("iPhone Settings",systemImage:"gear") {
              if let url=URL(string:UIApplication.openSettingsURLString) {UIApplication.shared.open(url)}
            }.frame(maxWidth:.infinity,alignment:.leading).frame(minHeight:44)
          }
        }
        section("Station Visits") {
          DrivingResearchVisitTimeline(visits:collector.visits.filter {collector.notifiedVisitIDs.contains($0.id)},
            labels:collector.visitLabels,departures:collector.departureTimes) {selectedVisit=$0}
          if let labelMessage {Text(labelMessage).font(.caption).foregroundStyle(.secondary)}
        }
        if collector.consented {
          if !notificationTests.tests.isEmpty {
            section("Test Notifications") {
              ForEach(notificationTests.tests) {test in
                Button {selectedTest=test.id} label: {
                  VStack(alignment: .leading, spacing: 4) {
                    Text("TEST · \(test.stationName)").font(.headline)
                    Text(test.summary).font(.caption).foregroundStyle(.secondary)
                  }.frame(maxWidth: .infinity, alignment: .leading).frame(minHeight: 44)
                }
              }
            }
          }
          Button("Delete Research Data", role: .destructive) {confirmDelete = true}
            .frame(maxWidth: .infinity).frame(minHeight: 44).foregroundStyle(.secondary).disabled(collector.busy)
        }
      }
      .padding(.horizontal, 20).padding(.top, contentInsets.top + 16).padding(.bottom, contentInsets.bottom + 28)
    }
    .scrollEdgeEffectHidden()
    .tint(.primary)
    .task {
      collector.prepare();notificationTests.refresh();collector.resume(reason: "debug_screen");takeNotificationVisit()
      if !presentedIntroduction {
        presentedIntroduction = true
        if selectedVisit == nil && selectedTest == nil { showConsent = true }
      }
    }
    .onChange(of: collector.confirmationVisit?.id) {takeNotificationVisit()}
    .onChange(of: notificationTests.openTestID) {
      if let id=notificationTests.openTestID {selectedTest=id;notificationTests.openTestID=nil}
    }
    .onChange(of: scenePhase) {if scenePhase == .active {collector.resume(reason: "foreground")}}
    .sheet(isPresented: $showConsent) {
      DrivingResearchConsent(isConsented: collector.consented, onAgree: {
        showConsent = false
        if !collector.consented { Task { await collector.enable() } }
      })
    }
    .confirmationDialog("Delete this phone’s research data?", isPresented: $confirmDelete, titleVisibility: .visible) {
      Button("Continue", role: .destructive) {confirmDeleteAgain=true}
    }
    .alert("Delete all your research data?",isPresented:$confirmDeleteAgain) {
      Button("Cancel",role:.cancel) {}
      Button("Delete Everything",role:.destructive) {Task {await collector.deleteData()}}
    } message: {Text("This deletes the data on this phone and its synced research data. This cannot be undone.")}
    .confirmationDialog(selectedTest == nil ? "What happened at this stop?" : "TEST · What happened at this stop?", isPresented: Binding(get: {selectedVisit != nil || selectedTest != nil}, set: {if !$0 {selectedVisit = nil;selectedTest=nil}}), titleVisibility: .visible) {
      ForEach([("fueled","Got fuel"),("not_fueling","Stopped, no fuel"),("not_a_stop","Not a stop"),("wrong_station","Wrong station"),("unsure","Not sure")], id: \.0) {value in
        Button(value.1) {
          if let id=selectedTest {notificationTests.answer(id,label:value.0)}
          else if let visit = selectedVisit, collector.label(visit,value.0) {labelMessage = "Saved: \(value.1)"}
          selectedVisit = nil;selectedTest=nil
        }
      }
    }
  }

  private var needsPermissions:Bool {
    !collector.ready || (collector.notificationPermission != "On" && collector.notificationPermission != "Checking") || UIApplication.shared.backgroundRefreshStatus != .available
  }
  private func takeNotificationVisit() {
    if let visit=collector.confirmationVisit {selectedVisit=visit;collector.confirmationVisit=nil}
    if let id=notificationTests.openTestID {selectedTest=id;notificationTests.openTestID=nil}
  }
  private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      Text(title).font(.headline).padding(.horizontal, 4).accessibilityAddTraits(.isHeader)
      glassCard(content: content)
    }
  }
  private func glassCard<Content: View>(@ViewBuilder content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: 12, content: content)
      .frame(maxWidth: .infinity, alignment: .leading).padding(18)
      .glassEffect(.regular, in: .rect(cornerRadius: 26))
  }
  private func row(_ title: String, _ value: String, icon: String) -> some View {
    Group {
      if typeSize.isAccessibilitySize {
        VStack(alignment: .leading, spacing: 8) {
          Label(title, systemImage: icon)
          Text(value).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity, alignment: .leading)
      } else {
        LabeledContent {
          Text(value).foregroundStyle(.secondary).multilineTextAlignment(.trailing)
        } label: {
          Label(title, systemImage: icon)
        }
      }
    }.frame(minHeight: 36)
  }
  private func time(_ seconds: Double) -> String {
    Date(timeIntervalSince1970: seconds).formatted(date: .omitted, time: .shortened)
  }
}
