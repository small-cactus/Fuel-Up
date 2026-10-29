import ExpoModulesCore
import ExpoUI

public final class FuelUpGlassModule: Module {
  public func definition() -> ModuleDefinition {
    Name("FuelUpGlass")
    Function("getAppLanguage") { Bundle.main.preferredLocalizations.first ?? "en" }
    View(SuperSaverMetalView.self) {
      Prop("isDark") { (view, value: Bool) in view.isDark = value }
      Prop("wordmark") { (view, value: Bool) in view.wordmark = value }
      Prop("effect") { (view, value: Int) in view.effect = value }
      Prop("hdrBrand") { (view, value: Bool) in view.hdrBrand = value }
      Prop("glyphText") { (view, value: String) in view.glyphText = value }
      Prop("glyphFontSize") { (view, value: Double) in view.glyphFontSize = value }
      Prop("active") { (view, value: Bool) in view.active = value }
    }
    View(SaverCloseView.self) {
      Prop("isDark") { (view, value: Bool) in view.isDark = value }
      Events("onClose")
    }
    OnCreate {
      ViewModifierRegistry.register("fuelGlassForm") { params, _, _ in
        GlassFormModifier(bottomContentInset: params["bottomContentInset"] as? Double ?? 0)
      }
      ViewModifierRegistry.register("fuelGlassSection") { params, _, _ in
        GlassSectionModifier(id: params["id"] as? String ?? "section")
      }
    }
    OnDestroy {
      ViewModifierRegistry.unregister("fuelGlassForm")
      ViewModifierRegistry.unregister("fuelGlassSection")
    }
  }
}
