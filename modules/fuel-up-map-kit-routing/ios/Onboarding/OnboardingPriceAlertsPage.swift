import SwiftUI

/// The prices are an example, never a live quote.
struct OnboardingPriceAlertsPage: View {
  @ScaledMetric(relativeTo: .largeTitle) private var priceSize: CGFloat = 40

  var body: some View {
    GeometryReader { size in
      ScrollView {
        VStack(alignment: .leading, spacing: 28) {
          Text("Can we tell you when gas prices near you drop?")
            .font(.system(.largeTitle, design: .rounded, weight: .bold))
            .accessibilityAddTraits(.isHeader)
          VStack(alignment: .leading, spacing: 18) {
            HStack {
              Label("Regular gas nearby", systemImage: "fuelpump.fill")
                .font(.subheadline.weight(.semibold))
              Spacer()
              Text("Example").font(.caption).foregroundStyle(.secondary)
            }
            Divider()
            ViewThatFits(in: .horizontal) {
              HStack(alignment: .bottom, spacing: 14) {
                previousPrice
                Image(systemName: "arrow.right").foregroundStyle(.secondary)
                  .padding(.bottom, 10).accessibilityHidden(true)
                currentPrice
              }.fixedSize(horizontal: true, vertical: false)
              VStack(alignment: .leading, spacing: 12) { previousPrice; currentPrice }
            }
            Text("That’s $2 less on a 10-gallon fill-up.")
              .font(.body.weight(.medium)).fixedSize(horizontal: false, vertical: true)
          }
          .padding(22).frame(maxWidth: .infinity, alignment: .leading)
          .modifier(OnboardingGlass()).accessibilityElement(children: .combine)
        }
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: 480, alignment: .leading)
        .padding(.horizontal, 26).padding(.vertical, 56)
        .frame(maxWidth: .infinity, minHeight: size.size.height, alignment: .center)
        .overlay(alignment: .top) { OnboardingWordmark() }
      }.scrollBounceBehavior(.basedOnSize)
    }
    .background(Color(uiColor: .systemGroupedBackground))
    .accessibilityIdentifier("onboarding-price-alerts")
  }

  private var previousPrice: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text("Yesterday").font(.subheadline)
      Text(verbatim: "$3.29").font(.system(size: priceSize, weight: .medium, design: .rounded))
    }.foregroundStyle(.secondary)
  }

  private var currentPrice: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text("Today").font(.subheadline.weight(.semibold))
      Text(verbatim: "$3.09").font(.system(size: priceSize, weight: .bold, design: .rounded))
    }
  }
}
