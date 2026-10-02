import SwiftUI

@available(iOS 16.0, *)
struct OnboardingBrandsPage: View {
  @ObservedObject var model: OnboardingModel
  @State private var search = ""
  @ScaledMetric(relativeTo: .body) private var searchHeight = 56.0
  private var brands: [OnboardingBrand] {
    let known = Set(model.brands.map(\.id))
    let saved = model.favorites.subtracting(known).sorted().compactMap {
      OnboardingBrand(["id": $0, "label": $0.capitalized, "count": 0])
    }
    return (model.brands + saved).filter { search.isEmpty || $0.label.localizedCaseInsensitiveContains(search) }
  }
  var body: some View {
    VStack(spacing: 0) {
    OnboardingSearchField(text: $search, focused: $model.searchFocused).frame(height: searchHeight).padding(.horizontal, 16)
    ScrollView {
      VStack(alignment: .leading, spacing: 24) {
        if !model.searchFocused {
          OnboardingHeading(title: "Your usual stops", subtitle: "Have a membership or a favorite? Pick them here.")
        }
        if search.isEmpty {
          if !model.membershipOptions.isEmpty {
            sectionTitle("Memberships")
            VStack(spacing: 0) {
              ForEach(model.membershipOptions) { item in
                OnboardingSelectionRow(title: item.label, brandIcon: item.id, selected: model.memberships.contains(item.id)) {
                  toggle(item.id, in: &model.memberships)
                  model.changed()
                }.accessibilityIdentifier("onboarding-membership-\(item.id)")
                if item.id != model.membershipOptions.last?.id { Divider().padding(.horizontal, 20) }
              }
            }.modifier(OnboardingGlass())
          } else if model.membershipLoading { ProgressView("Finding memberships…") }
          if model.membershipError != nil { retry("Memberships couldn’t load.") }
        }
        sectionTitle("Favorites")
        if !brands.isEmpty {
          LazyVStack(spacing: 0) {
            ForEach(brands) { item in
              OnboardingSelectionRow(title: item.label, brandIcon: item.id, selected: model.favorites.contains(item.id)) {
                toggle(item.id, in: &model.favorites)
                model.changed()
              }.accessibilityIdentifier("onboarding-brand-\(item.id)")
              if item.id != brands.last?.id { Divider().padding(.horizontal, 20) }
            }
          }.modifier(OnboardingGlass())
        } else if model.loading { ProgressView("Finding nearby stations…") }
        else {
          Text(!search.isEmpty ? "No matching brands." : model.coordinate == nil ? "Choose favorites later in Settings." : "No nearby brands for this fuel.")
            .foregroundStyle(.secondary)
        }
        if model.error != nil { retry("Nearby brands couldn’t load.") }
        Text("Optional. You can change these in Settings.").font(.footnote).foregroundStyle(.secondary)
      }.padding(24)
    }
    .scrollDismissesKeyboard(.interactively)

  }
  }
  private func sectionTitle(_ text: String) -> some View {
    Text(text).font(.headline).accessibilityAddTraits(.isHeader)
  }
  private func retry(_ text: String) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(text).font(.subheadline).foregroundStyle(.secondary)
      Button("Try again") { model.emit?(["type": "retry"]) }.frame(minHeight: 44)
    }
  }
  private func toggle(_ id: String, in values: inout Set<String>) {
    if values.contains(id) { values.remove(id) } else { values.insert(id) }
  }
}
