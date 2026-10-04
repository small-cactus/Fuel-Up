import ExpoModulesCore
import SwiftUI

final class DrivingResearchView: ExpoView {
  private var host:UIHostingController<DrivingResearchScreen>?
  required init(appContext:AppContext?=nil) {
    super.init(appContext:appContext)
    let controller=UIHostingController(rootView:DrivingResearchScreen())
    if #available(iOS 16.4,*) {controller.safeAreaRegions=[]}
    controller.view.backgroundColor = .clear;host=controller;addSubview(controller.view)
  }
  func setDark(_ dark:Bool) {host?.overrideUserInterfaceStyle=dark ? .dark : .light}
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
  @ObservedObject private var collector = DrivingResearchCollector.shared
  @Environment(\.scenePhase) private var scenePhase
  @State private var confirmDelete = false
  @State private var showConsent = false
  @State private var selectedVisit: ResearchVisit?
  @State private var labelMessage: String?

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 24) {
        Text("Driving Research").font(.largeTitle.bold())
          .accessibilityAddTraits(.isHeader)
        glassCard {
          HStack(spacing: 14) {
            Image(systemName: "car.side.fill").font(.title2).foregroundStyle(.blue)
            VStack(alignment: .leading, spacing: 4) {
              Text(collector.enabled && collector.ready ? "Collecting" : collector.enabled ? "Finish setup" : "Paused")
                .font(.headline)
              if collector.enabled {Text(collector.status).font(.subheadline).foregroundStyle(.secondary)}
            }
            Spacer(minLength: 0)
            if collector.busy {ProgressView()}
          }.accessibilityIdentifier("research-status")
          Button {
            if collector.enabled {collector.pause()}
            else if collector.consented {Task {await collector.enable()}}
            else {showConsent = true}
          } label: {
            Label(collector.enabled ? "Pause Collection" : "Enable Collection",
                  systemImage: collector.enabled ? "pause.fill" : "record.circle")
              .frame(maxWidth: .infinity).padding(.vertical, 6)
          }
          .buttonStyle(.glassProminent).tint(.blue).disabled(collector.busy)
          .accessibilityIdentifier(collector.enabled ? "research-pause" : "research-enable")
        }
        if let issue = collector.issue {
          Label(issue, systemImage: "exclamationmark.circle")
            .font(.subheadline).foregroundStyle(.orange).accessibilityIdentifier("research-issue")
        }
        section("Permissions") {
          row("Location", collector.locationPermission, icon: "location.fill")
          row("Precise Location", collector.precise ? "On" : "Off", icon: "scope")
          row("Motion & Fitness", collector.motionPermission, icon: "figure.walk")
          if collector.consented && !collector.ready {
            Button("Finish Setup", systemImage: "checkmark.shield") {collector.requestPermissions()}
              .frame(maxWidth: .infinity, alignment: .leading).frame(minHeight: 44)
          }
          Button("iPhone Settings", systemImage: "gear") {
            if let url = URL(string: UIApplication.openSettingsURLString) {UIApplication.shared.open(url)}
          }.frame(maxWidth: .infinity, alignment: .leading).frame(minHeight: 44)
        }
        if collector.consented {
          section("Tracking") {
            row("Motion", collector.motion, icon: "car.side")
            row("Nearby Stations", "\(collector.stationCount)", icon: "fuelpump")
            row("Geofences", "\(collector.fenceCount)", icon: "location.circle")
            if let fix = collector.lastFix {
              row("Accuracy", "±\(Int(max(0,fix.accuracy))) m", icon: "scope")
            }
          }
        }
        section("Saved Data") {
          row("Recorded", "\(collector.total)", icon: "checkmark.circle")
          row("Pending", "\(collector.pending)", icon: "arrow.up.circle")
          row("Uploads", collector.uploadSchedule, icon: "network")
          row("Last Sync", collector.lastUpload?.formatted(date: .omitted, time: .shortened) ?? "—", icon: "clock")
          Button("Sync Saved Data", systemImage: "arrow.triangle.2.circlepath") {collector.sync(force: true)}
            .frame(maxWidth: .infinity, alignment: .leading).frame(minHeight: 44)
            .disabled(!collector.consented)
        }
        section("Station Visits") {
          if collector.visits.isEmpty {
            Label("No visits yet", systemImage: "fuelpump").foregroundStyle(.secondary)
              .frame(minHeight: 44)
          }
          ForEach(collector.visits) {visit in
            Button {selectedVisit = visit} label: {
              HStack {
                VStack(alignment: .leading, spacing: 4) {
                  Text(visit.station.name).foregroundStyle(.primary)
                  Text("\(time(visit.startedAt)) · Possible stop").font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.right").font(.caption.bold()).foregroundStyle(.tertiary)
              }.frame(minHeight: 44)
            }
          }
          if let labelMessage {Text(labelMessage).font(.caption).foregroundStyle(.secondary)}
        }
        if collector.consented {
          Button("Delete Research Data", role: .destructive) {confirmDelete = true}
            .frame(maxWidth: .infinity).frame(minHeight: 44).disabled(collector.busy)
        }
      }
      .padding(.horizontal, 20).padding(.top, 16).padding(.bottom, 28)
    }
    .tint(.blue)
    .task {collector.prepare();collector.resume(reason: "debug_screen")}
    .onChange(of: scenePhase) {if scenePhase == .active {collector.resume(reason: "foreground")}}
    .sheet(isPresented: $showConsent) {
      NavigationStack {
        ScrollView {
          VStack(alignment: .leading, spacing: 24) {
            Image(systemName: "car.side.fill").font(.largeTitle).foregroundStyle(.blue)
            Text("Join Driving Research").font(.title.bold())
            Text("Share precise locations, motion, timestamps, station stops, and your visit labels with Fuel Up to improve recommendations. Collection continues in the background.")
            Text("Records use a random participant ID and are kept until you delete them. You can pause or delete your research data here anytime.")
              .foregroundStyle(.secondary)
            Button("Agree & Enable Collection") {
              showConsent = false
              Task {await collector.enable()}
            }.buttonStyle(.glassProminent).tint(.blue)
              .controlSize(.large).frame(maxWidth: .infinity)
          }.padding(24)
        }
        .toolbar {ToolbarItem(placement: .cancellationAction) {Button("Cancel") {showConsent = false}}}
      }.presentationDetents([.large])
    }
    .confirmationDialog("Delete this phone’s research data?", isPresented: $confirmDelete, titleVisibility: .visible) {
      Button("Delete Research Data", role: .destructive) {Task {await collector.deleteData()}}
    }
    .confirmationDialog("What happened at this stop?", isPresented: Binding(get: {selectedVisit != nil}, set: {if !$0 {selectedVisit = nil}}), titleVisibility: .visible) {
      ForEach([("fueled","I bought fuel"),("not_fueling","I stopped, but did not fuel"),("wrong_station","This is the wrong station"),("unsure","I’m not sure")], id: \.0) {value in
        Button(value.1) {
          if let visit = selectedVisit {collector.label(visit,value.0);labelMessage = "Saved: \(value.1)"}
          selectedVisit = nil
        }
      }
    }
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
    LabeledContent {
      Text(value).foregroundStyle(.secondary).multilineTextAlignment(.trailing)
    } label: {
      Label(title, systemImage: icon)
    }.frame(minHeight: 36)
  }
  private func time(_ seconds: Double) -> String {
    Date(timeIntervalSince1970: seconds).formatted(date: .omitted, time: .shortened)
  }
}
