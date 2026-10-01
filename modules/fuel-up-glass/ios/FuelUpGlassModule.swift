import ExpoModulesCore
import ExpoUI

public final class FuelUpGlassModule: Module {
  public func definition() -> ModuleDefinition {
    Name("FuelUpGlass")
    OnCreate {
      ViewModifierRegistry.register("fuelGlassForm") { _, _, _ in GlassFormModifier() }
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
