import ExpoModulesCore
import UIKit

public final class FuelUpNativeSearchModule: Module {
  public func definition() -> ModuleDefinition {
    Name("FuelUpNativeSearch")
    View(FuelUpSearchBar.self) {
      Prop("placeholder") { (view, value: String) in view.searchBar.placeholder = value }
      Prop("isDark") { (view, value: Bool) in view.overrideUserInterfaceStyle = value ? .dark : .light }
      Prop("active") { (view, value: Bool) in view.setActive(value) }
      Events("onQueryChange")
    }
  }
}

/// UIKit owns the field, magnifier, clear button, editing and iOS 26 appearance.
/// No React text field or custom glass background is involved.
final class FuelUpSearchBar: ExpoView, UISearchBarDelegate {
  let searchBar = UISearchBar(frame: .zero)
  let onQueryChange = EventDispatcher()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    searchBar.searchBarStyle = .minimal
    searchBar.delegate = self
    searchBar.autocapitalizationType = .none
    searchBar.autocorrectionType = .no
    searchBar.searchTextField.accessibilityIdentifier = "brand-search"
    searchBar.searchTextField.accessibilityLabel = "Search preferred brands"
    searchBar.searchTextField.adjustsFontForContentSizeCategory = true
    addSubview(searchBar)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    searchBar.frame = bounds
  }

  func setActive(_ active: Bool) {
    guard !active else { return }
    searchBar.resignFirstResponder()
    searchBar.setShowsCancelButton(false, animated: false)
    searchBar.text = ""
  }

  func searchBar(_ searchBar: UISearchBar, textDidChange searchText: String) {
    onQueryChange(["text": searchText])
  }

  func searchBarTextDidBeginEditing(_ searchBar: UISearchBar) {
    searchBar.setShowsCancelButton(true, animated: true)
  }

  func searchBarSearchButtonClicked(_ searchBar: UISearchBar) {
    searchBar.resignFirstResponder()
  }

  func searchBarCancelButtonClicked(_ searchBar: UISearchBar) {
    searchBar.text = ""
    onQueryChange(["text": ""])
    searchBar.resignFirstResponder()
    searchBar.setShowsCancelButton(false, animated: true)
  }
}
