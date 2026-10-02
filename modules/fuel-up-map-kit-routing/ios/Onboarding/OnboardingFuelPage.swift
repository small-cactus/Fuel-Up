import SwiftUI

struct OnboardingFuelPage: View {
  @ObservedObject var model: OnboardingModel
  private let grades = [("regular", "Regular", "87"), ("midgrade", "Midgrade", "89"),
                        ("premium", "Premium", "91–93"), ("diesel", "Diesel", ""), ("e85", "E85", "Flex fuel")]
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 26) {
        OnboardingHeading(title: "Choose your fuel", subtitle: "Use the grade recommended for your car.")
        VStack(spacing: 0) {
          ForEach(grades, id: \.0) { grade in
            OnboardingSelectionRow(title: grade.1, subtitle: grade.2.isEmpty ? nil : grade.2,
                                   fuelIcon: grade.0, selected: model.fuel == grade.0) {
              model.fuel = grade.0
              model.changed()
            }.accessibilityIdentifier("onboarding-grade-\(grade.0)")
            if grade.0 != "e85" { Divider().padding(.horizontal, 20) }
          }
        }.modifier(OnboardingGlass())
        if model.fuel != "e85" {
          Toggle("Also needs E85", isOn: $model.requiresE85)
            .font(.body).padding(20).modifier(OnboardingGlass())
            .accessibilityIdentifier("onboarding-requires-e85")
            .onChange(of: model.requiresE85) { _ in model.changed() }
        }
      }.padding(24)
    }
  }
}
