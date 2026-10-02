import SwiftUI

@available(iOS 16.0, *)
struct OnboardingLocationPage: View {
  @ObservedObject var model: OnboardingModel
  let bottomInset: CGFloat
  @Environment(\.dynamicTypeSize) private var typeSize
  @ScaledMetric(relativeTo: .largeTitle) private var headlineSize = 40

  var body: some View {
    GeometryReader { geometry in
      ZStack(alignment: .bottom) {
        OnboardingLocationMap(coordinate: model.hasLocationAccess ? model.coordinate : nil)
          .ignoresSafeArea().allowsHitTesting(false).accessibilityHidden(true)

        // The map is atmosphere; a solid reading surface keeps the request clear
        // in both appearances, with no glass simulation or decorative cards.
        if typeSize.isAccessibilitySize {
          background.ignoresSafeArea().allowsHitTesting(false)
        } else {
          LinearGradient(stops: [
            .init(color: background.opacity(0), location: 0),
            .init(color: background.opacity(0.95), location: 0.28),
            .init(color: background, location: 0.52),
          ], startPoint: .top, endPoint: .bottom)
            .frame(height: geometry.size.height * 0.72)
            .ignoresSafeArea(edges: .bottom).allowsHitTesting(false)
        }

        ScrollView {
          VStack(alignment: .leading, spacing: 16) {
            Image(systemName: "location.fill")
              .font(.title2.weight(.semibold)).foregroundStyle(.blue)
              .accessibilityHidden(true)
            Text("Find gas\nnear you.")
              .font(.system(size: headlineSize, weight: .bold, design: .rounded))
              .fixedSize(horizontal: false, vertical: true)
              .accessibilityAddTraits(.isHeader)
            Text(model.locationBlocked
                 ? "Turn on location in Settings to find nearby gas."
                 : "See nearby stations and their latest prices.")
              .font(.body).foregroundStyle(.secondary)
              .fixedSize(horizontal: false, vertical: true)
          }
          .frame(maxWidth: 520, alignment: .leading)
          .padding(.horizontal, 24)
          .padding(.top, 24)
          .frame(maxWidth: .infinity, minHeight: max(0, geometry.size.height - bottomInset), alignment: .bottomLeading)
        }
        .scrollIndicators(.hidden)
        .frame(height: max(0, geometry.size.height - bottomInset))
        .frame(maxHeight: .infinity, alignment: .top)
      }
    }.background(background)
  }

  private var background: Color { Color(uiColor: .systemGroupedBackground) }
}
