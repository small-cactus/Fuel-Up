# Onboarding map backgrounds and scrolling headers

- The location map now fills the screen. Its upper illustration transitions into the same native ultra-thin material used at the bottom of the welcome page. Removed the map opacity fade and light-only white wash.
- Fuel and Gas preferences use a full-screen map with that native material. Glass controls and the stationary footer retain their existing behavior.
- Shared 132 × 38 Fuel Up wordmark uses the same assets and safe-area placement as Trends/Settings on the added pages, but belongs to scrolling content. Welcome retains its icon/wordmark composition inside a scroll view.
- Location copy overlaps the hero by 25 points instead of 50. Larger phones use additional benefit spacing to occupy roughly half of the previously empty space above the footer; compact layouts remain scrollable.
- Decorative chips grow with the existing spring in the centered 50% band of the upper map illustration. The sample caption has a reserved center corridor. No live prices or collection behavior changed.

Validation:

- Release device and Debug simulator builds succeeded.
- Eight focused onboarding, state continuity, and iOS minimum-support tests passed (`tests.tap`).
- iPhone 17 Pro Max simulator: reviewed welcome, location, fuel, and preferences; checked light/dark map treatments; granting location advanced to fuel. All three added wordmarks start at normalized y=0.065 (safe-area edge). Scrolling preferences removed the wordmark while the bottom button remained at y=0.879.
- Location's final benefit ends at y=0.779, with page dots starting at y=0.839, reducing the previously reported gap. Screenshot evidence is included.
- iPhone 13 mini simulator: reviewed the compact location layout; title wraps and benefits remain in the scroll view. A pre-existing unsigned-simulator notification warning overlays the footer in this environment.
- Installed `com.anthonyh.fuelup` successfully on Anthony's iPhone 18 Pro Max over the existing wireless connection, without uninstalling or clearing preferences. Physical screen verification remains user-side.
