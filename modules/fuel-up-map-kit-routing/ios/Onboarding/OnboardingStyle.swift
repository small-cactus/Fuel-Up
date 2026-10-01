import SwiftUI

struct OnboardingHeading: View {
  let title: String
  let subtitle: String
  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text(title).font(.system(.largeTitle, design: .rounded).bold())
        .accessibilityAddTraits(.isHeader)
      Text(subtitle).font(.body).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
    }.frame(maxWidth: .infinity, alignment: .leading)
  }
}

struct OnboardingGlass: ViewModifier {
  func body(content: Content) -> some View {
    if #available(iOS 26.0, *) {
      content.glassEffect(.regular, in: .rect(cornerRadius: 26))
    } else { content.background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 26)) }
  }
}

struct OnboardingPrimaryButton: View {
  let title: String
  var action: () -> Void
  var body: some View {
    if #available(iOS 26.0, *) { button.buttonStyle(.glassProminent) }
    else { button.buttonStyle(.borderedProminent) }
  }
  private var button: some View {
    Button(action: action) {
      Text(title).font(.headline).frame(maxWidth: .infinity).frame(minHeight: 36)
    }.buttonBorderShape(.capsule).controlSize(.large).tint(.blue)
      .accessibilityIdentifier("onboarding-next")
  }
}

struct OnboardingSelectionRow: View {
  let title: String
  var subtitle: String? = nil
  let selected: Bool
  let action: () -> Void
  var body: some View {
    Button(action: action) {
      HStack(spacing: 14) {
        VStack(alignment: .leading, spacing: 3) {
          Text(title).font(.body.weight(.medium)).foregroundStyle(.primary)
          if let subtitle { Text(subtitle).font(.subheadline).foregroundStyle(.secondary) }
        }
        Spacer(minLength: 8)
        Image(systemName: selected ? "checkmark.circle.fill" : "circle")
          .font(.title3).foregroundStyle(selected ? Color.blue : Color.secondary.opacity(0.5))
      }.padding(.horizontal, 20).padding(.vertical, 16).frame(minHeight: 58).contentShape(Rectangle())
    }.buttonStyle(.plain).accessibilityAddTraits(selected ? .isSelected : [])
      .accessibilityValue(selected ? "Selected" : "Not selected")
  }
}
