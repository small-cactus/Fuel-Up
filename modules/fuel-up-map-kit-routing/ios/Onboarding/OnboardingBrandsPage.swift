import SwiftUI

@available(iOS 16.0, *)
struct OnboardingBrandsPage: View {
  @ObservedObject var model: OnboardingModel
  var isSettings = false
  var bottomInset: CGFloat = 0
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
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
        if model.membershipLoading || !model.membershipOptions.isEmpty {
          VStack(alignment: .leading, spacing: 12) {
            loadingTitle("Memberships", loading: model.membershipLoading)
            if model.membershipOptions.count > 10 && !model.membershipLoading {
              OnboardingSearchField(text: $membershipSearch, focused: $model.searchFocused,
                                    placeholder: "Find a membership")
                .frame(height: searchHeight).padding(.horizontal, -8)
                .accessibilityIdentifier("onboarding-membership-search")
            }
            skeletonSwap(loading: model.membershipLoading, label: "Loading memberships", identifier: "onboarding-membership-loading") {
              if memberships.isEmpty {
                Text("No matching memberships.").foregroundStyle(.secondary).padding(20)
              } else {
                VStack(spacing: 0) {
                  ForEach(memberships) { item in
                    OnboardingSelectionRow(title: item.label, brandIcon: item.id, selected: model.memberships.contains(item.id)) {
                      toggle(item.id, in: &model.memberships); model.changed()
                    }.accessibilityIdentifier("onboarding-membership-\(item.id)")
                    if item.id != memberships.last?.id { Divider().padding(.horizontal, 20) }
                  }
                }
              }
            }
          }
        }
        if model.membershipError != nil { retry("Memberships couldn’t load.") }

        VStack(alignment: .leading, spacing: 12) {
          loadingTitle("Favorites", loading: model.loading)
          if allBrands.count > 10 && !model.loading {
            OnboardingSearchField(text: $brandSearch, focused: $model.searchFocused,
                                  placeholder: "Find a station")
              .frame(height: searchHeight).padding(.horizontal, -8)
              .accessibilityIdentifier("onboarding-brand-search")
          }
          skeletonSwap(loading: model.loading, label: "Loading station brands", identifier: "onboarding-brand-loading") {
            if !brands.isEmpty {
              LazyVStack(spacing: 0) {
                ForEach(brands) { item in
                  OnboardingSelectionRow(title: item.label, brandIcon: item.id, selected: model.favorites.contains(item.id)) {
                    toggle(item.id, in: &model.favorites); model.changed()
                  }.accessibilityIdentifier("onboarding-brand-\(item.id)")
                  if item.id != brands.last?.id { Divider().padding(.horizontal, 20) }
                }
              }
            } else {
              Text(allBrands.count > 10 && !brandSearch.isEmpty ? "No matching stations." : "No nearby brands for this fuel.")
                .foregroundStyle(.secondary).padding(20)
            }
          }
          if model.error != nil { retry("Nearby brands couldn’t load.") }
        }
        if !isSettings {
          Text("Optional. You can change these in Settings.").font(.footnote).foregroundStyle(.secondary)
        }
      }.padding(.horizontal, 24).padding(.bottom, 24 + bottomInset)
        .animation(reduceMotion ? .linear(duration: 0.18) : .smooth(duration: 1.05), value: model.loading)
        .animation(reduceMotion ? .linear(duration: 0.18) : .smooth(duration: 1.05), value: model.membershipLoading)
    }.scrollDismissesKeyboard(.interactively)
  }

  // Keep native glass and the UIKit search field outside the shader surface.
  // Only the placeholder shapes and actual row content morph through Metal.
  private func skeletonSwap<Content: View>(loading: Bool, label: String, identifier: String,
                                           @ViewBuilder content: () -> Content) -> some View {
    SkeletonLiquidSwap(loading: loading) {
      OnboardingSkeletonRows()
        .accessibilityElement(children: .ignore).accessibilityLabel(label)
        .accessibilityIdentifier(identifier)
    } content: {
      content()
    }
    .modifier(OnboardingGlass())
  }

  private func loadingTitle(_ title: String, loading: Bool) -> some View {
    HStack {
      sectionTitle(title)
      Spacer()
      if loading { ProgressView().tint(.primary) }
    }
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
