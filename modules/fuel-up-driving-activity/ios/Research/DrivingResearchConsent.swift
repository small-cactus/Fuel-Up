import SwiftUI

/// Consent stays readable at larger text sizes; the illustration is decorative.
struct DrivingResearchConsent: View {
  var isConsented = false
  let onAgree: () -> Void
  @State private var showDetails = false
  @State private var sheetCornerRadius: CGFloat?

  private static let resources: Bundle = {
    let host = Bundle(for: DrivingResearchCollector.self)
    guard let url = host.url(forResource: "FuelUpResearch", withExtension: "bundle")
      ?? Bundle.main.url(forResource: "FuelUpResearch", withExtension: "bundle"),
      let bundle = Bundle(url: url) else { return host }
    return bundle
  }()

  var body: some View {
    NavigationStack {
      VStack(spacing: 0) {
        Capsule()
          .fill(.tertiary)
          .frame(width: 36, height: 5)
          .padding(.top, 16)
          .accessibilityHidden(true)

        ScrollView {
          VStack(spacing: 24) {
            Image("ResearchConsentMap", bundle: Self.resources)
              .resizable().scaledToFit()
              .frame(maxWidth: 300).frame(height: 180)
              .accessibilityHidden(true)

            VStack(spacing: 10) {
              Text("Help Fuel Up")
                .font(.largeTitle.bold()).lineLimit(1).minimumScaleFactor(0.6)
                .accessibilityAddTraits(.isHeader)
              Text("Make your next fuel stop better.")
                .font(.body).foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            }

            VStack(spacing: 24) {
              consentRow("Share your activity", icon: "location.fill", color: .blue,
                detail: "Share precise location, motion, times, station stops, and your answers. Collection continues in the background.")
              consentRow("You’re in control", icon: "chart.bar.fill", color: .purple,
                detail: "Pause anytime. Your data stays until you delete it.")
              consentRow("Help us improve", icon: "lock.fill", color: .green,
                detail: "Data uses a random participant ID for research and better recommendations.")
            }

          }
          .padding(.horizontal, 24).padding(.top, 24).padding(.bottom, 12)
        }

        VStack(spacing: 4) {
          Button(action: onAgree) {
            Text(isConsented ? "Done" : "Agree & Enable").font(.headline)
              .frame(maxWidth: .infinity).frame(minHeight: 40)
          }
          .buttonStyle(.glassProminent).tint(.blue).controlSize(.large)
          .accessibilityIdentifier("research-consent-agree")
          Button { showDetails = true } label: {
            Text("Learn More").font(.body).foregroundStyle(.blue)
              .frame(minHeight: 44)
          }.buttonStyle(.plain)
        }
        .padding(.horizontal, 24).padding(.top, 12).padding(.bottom, 8)

      }
      .toolbar(.hidden, for: .navigationBar)
      .sheet(isPresented: $showDetails) {
        NavigationStack {
          ScrollView {
            VStack(alignment: .leading, spacing: 20) {
              Text("Driving Research").font(.title.bold())
              Text("Fuel Up collects precise locations, motion, timestamps, station stops, and your visit answers to research and improve fuel recommendations. Collection continues in the background when enabled.")
              Text("Records are linked to a random participant ID. Location history can still identify places you visit; a random ID does not make it anonymous.")
              Text("Records are kept until you delete them. You can pause collection or delete the data on this phone and its synced research data from Driving Research in Settings.")
            }.padding(24)
          }
          .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { showDetails = false } } }
        }.tint(.primary)
      }
    }
    .tint(.primary)
    .background(DrivingResearchSheetCorners { sheetCornerRadius = $0 })
    .presentationCornerRadius(sheetCornerRadius)
    .presentationDetents([.large])
    .presentationDragIndicator(.hidden)
  }

  private func consentRow(_ title: String, icon: String, color: Color, detail: String) -> some View {
    HStack(alignment: .top, spacing: 18) {
      Image(systemName: icon)
        .font(.system(size: 25, weight: .semibold))
        .foregroundStyle(color).frame(width: 52, height: 52)
        .background(color.opacity(0.13), in: Circle())
        .accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 4) {
        Text(title).font(.headline)
        Text(detail).font(.subheadline).foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .combine)
  }
}
