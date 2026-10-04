import SwiftUI

@available(iOS 16.0, *)
struct OnboardingBrandsPage: View {
  @ObservedObject var model: OnboardingModel
  var isSettings = false
  @State private var brandSearch = ""
  @State private var membershipSearch = ""
  @ScaledMetric(relativeTo: .body) private var searchHeight = 56.0

  private var allBrands: [OnboardingBrand] {
    let known = Set(model.brands.map(\.id))
    let saved = model.favorites.subtracting(known).sorted().compactMap {
      OnboardingBrand(["id": $0, "label": $0.capitalized, "count": 0])
    }
    return model.brands + saved
  }
  private var brands: [OnboardingBrand] { filtered(allBrands, query: brandSearch) }
  private var memberships: [OnboardingBrand] { filtered(model.membershipOptions, query: membershipSearch) }

  var body: some View { sections }

  private var heading: some View {
    OnboardingHeading(title: "Gas preferences", subtitle: "Choose any stations you’d rather go to, even if another is cheaper")
      .frame(maxWidth: .infinity, alignment: .leading)
  }

  private var sections: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 26) {
        if !isSettings {
          OnboardingWordmark()
          heading
        }
        if model.membershipLoading {
          OnboardingMembershipSkeleton()
        } else if !model.membershipOptions.isEmpty {
          VStack(alignment: .leading, spacing: 12) {
            sectionTitle("Memberships")
            if model.membershipOptions.count > 10 {
              OnboardingSearchField(text: $membershipSearch, focused: $model.searchFocused,
                                    placeholder: "Find a membership")
                .frame(height: searchHeight).padding(.horizontal, -8)
                .accessibilityIdentifier("onboarding-membership-search")
            }
            if memberships.isEmpty {
              Text("No matching memberships.").foregroundStyle(.secondary)
            } else {
              VStack(spacing: 0) {
                ForEach(memberships) { item in
                  OnboardingSelectionRow(title: item.label, brandIcon: item.id, selected: model.memberships.contains(item.id)) {
                    toggle(item.id, in: &model.memberships); model.changed()
                  }.accessibilityIdentifier("onboarding-membership-\(item.id)")
                  if item.id != memberships.last?.id { Divider().padding(.horizontal, 20) }
                }
              }.modifier(OnboardingGlass())
            }
          }
        }
        if model.membershipError != nil { retry("Memberships couldn’t load.") }

        VStack(alignment: .leading, spacing: 12) {
          sectionTitle("Favorites")
          if allBrands.count > 10 {
            OnboardingSearchField(text: $brandSearch, focused: $model.searchFocused,
                                  placeholder: "Find a station")
              .frame(height: searchHeight).padding(.horizontal, -8)
              .accessibilityIdentifier("onboarding-brand-search")
          }
          if !brands.isEmpty {
            LazyVStack(spacing: 0) {
              ForEach(brands) { item in
                OnboardingSelectionRow(title: item.label, brandIcon: item.id, selected: model.favorites.contains(item.id)) {
                  toggle(item.id, in: &model.favorites); model.changed()
                }.accessibilityIdentifier("onboarding-brand-\(item.id)")
                if item.id != brands.last?.id { Divider().padding(.horizontal, 20) }
              }
            }.modifier(OnboardingGlass())
          } else if model.loading { ProgressView("Finding nearby stations…").tint(.primary) }
          else {
            Text(allBrands.count > 10 && !brandSearch.isEmpty ? "No matching stations." : "No nearby brands for this fuel.")
              .foregroundStyle(.secondary)
          }
          if model.error != nil { retry("Nearby brands couldn’t load.") }
        }
        if !isSettings {
          Text("Optional. You can change these in Settings.").font(.footnote).foregroundStyle(.secondary)
        }
      }.padding(.horizontal, 24).padding(.bottom, 24)
    }.scrollDismissesKeyboard(.interactively)
  }

  private func filtered(_ options: [OnboardingBrand], query: String) -> [OnboardingBrand] {
    // A shrinking inventory must not leave a hidden search filtering the rows.
    let term = options.count > 10 ? query.trimmingCharacters(in: .whitespacesAndNewlines) : ""
    return options.filter { term.isEmpty || $0.label.localizedCaseInsensitiveContains(term) }
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
