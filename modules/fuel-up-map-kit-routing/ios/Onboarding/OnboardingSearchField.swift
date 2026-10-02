import SwiftUI

// UIKit owns the iOS search control, keyboard, clear button, and accessibility.
struct OnboardingSearchField: UIViewRepresentable {
  @Binding var text: String
  @Binding var focused: Bool
  func makeCoordinator() -> Coordinator { Coordinator(self) }
  func makeUIView(context: Context) -> UISearchBar {
    let view = UISearchBar()
    view.delegate = context.coordinator
    view.placeholder = "Find a brand"
    view.searchBarStyle = .minimal
    view.autocapitalizationType = .none
    view.autocorrectionType = .no
    view.returnKeyType = .done
    return view
  }
  func updateUIView(_ view: UISearchBar, context: Context) {
    context.coordinator.parent = self
    if view.text != text { view.text = text }
  }
  final class Coordinator: NSObject, UISearchBarDelegate {
    var parent: OnboardingSearchField
    init(_ parent: OnboardingSearchField) { self.parent = parent }
    func searchBarTextDidBeginEditing(_ searchBar: UISearchBar) { parent.focused = true }
    func searchBarTextDidEndEditing(_ searchBar: UISearchBar) { parent.focused = false }
    func searchBar(_ searchBar: UISearchBar, textDidChange searchText: String) { parent.text = searchText }
    func searchBarSearchButtonClicked(_ searchBar: UISearchBar) { searchBar.resignFirstResponder() }
  }
}
