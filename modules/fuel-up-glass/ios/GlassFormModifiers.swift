import SwiftUI

/// Native row backgrounds report their existing bounds; they never participate
/// in layout. The form paints ONE material per section, not one per control.
private struct GlassRowBounds: PreferenceKey {
  static var defaultValue: [String: [Anchor<CGRect>]] = [:]
  static func reduce(value: inout [String: [Anchor<CGRect>]], nextValue: () -> [String: [Anchor<CGRect>]]) {
    value.merge(nextValue(), uniquingKeysWith: +)
  }
}

struct GlassSectionModifier: ViewModifier {
  let id: String
  func body(content: Content) -> some View {
    if #available(iOS 26.0, *) {
      content.listRowBackground(
        Color.clear.anchorPreference(key: GlassRowBounds.self, value: .bounds) { [id: [$0]] }
      )
    } else {
      content
    }
  }
}

struct GlassFormModifier: ViewModifier {
  private func extendedBounds(_ bounds: CGRect, viewportHeight: CGFloat) -> CGRect {
    guard !bounds.isNull else { return bounds }
    let top = bounds.minY <= 0 ? min(bounds.minY, -52) : bounds.minY
    let bottom = bounds.maxY >= viewportHeight ? max(bounds.maxY, viewportHeight + 52) : bounds.maxY
    return CGRect(x: bounds.minX, y: top, width: bounds.width, height: bottom - top)
  }

  func body(content: Content) -> some View {
    if #available(iOS 26.0, *) {
      content
        .scrollContentBackground(.hidden)
        .backgroundPreferenceValue(GlassRowBounds.self) { sections in
          GeometryReader { geometry in
            ForEach(sections.keys.sorted(), id: \.self) { id in
              let rowBounds = (sections[id] ?? []).reduce(CGRect.null) { $0.union(geometry[$1]) }
              // Form virtualizes offscreen rows. Keep an open edge at the viewport
              // instead of rounding the first/last currently mounted row.
              let bounds = extendedBounds(rowBounds, viewportHeight: geometry.size.height)
              if !bounds.isNull && bounds.width > 0 && bounds.height > 0 {
                Color.clear
                  .frame(width: bounds.width, height: bounds.height)
                  .glassEffect(.regular, in: .rect(cornerRadius: 26))
                  .position(x: bounds.midX, y: bounds.midY)
              }
            }
          }
          .allowsHitTesting(false)
          .accessibilityHidden(true)
        }
        .clipped()
    } else {
      content
    }
  }
}
