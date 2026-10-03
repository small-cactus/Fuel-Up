import SwiftUI
import ReactNativeBlur

// Share the app's existing tint-free backdrop blur with native screens.
// Vary the blur radius itself instead of fading a colored material over content.
struct PureProgressiveBlur: UIViewRepresentable {
  enum Direction { case top, bottom, uniform }
  var radius: CGFloat = 20
  var direction: Direction = .bottom
  var linearTransition = false

  func makeUIView(context: Context) -> VariableBlurView {
    let view = VariableBlurView(maxBlurRadius: radius, blurStyle: .regular)
    view.isUserInteractionEnabled = false
    view.accessibilityElementsHidden = true
    configure(view)
    return view
  }

  func updateUIView(_ view: VariableBlurView, context: Context) {
    configure(view)
  }

  private func configure(_ view: VariableBlurView) {
    view.updateBlur(
      maxBlurRadius: radius,
      direction: direction == .top ? .blurredTopClearBottom : .blurredBottomClearTop,
      startOffset: 0,
      // An opaque radius mask gives a uniform blur without a material tint.
      radial: direction == .uniform,
      radialCenterX: 0.5, radialCenterY: 0.5,
      radialClearRadius: 0, radialFeather: 0,
      blurStyle: .regular,
      linearTransition: linearTransition
    )
  }
}
