# Native glass surfaces

The production iOS glass surfaces use Apple's SwiftUI or UIKit rendering and
layout. JavaScript retains preferences, data, navigation, and screen composition.
A SwiftUI Host contains the complete glass surface and its labels/controls;
there is no React Native text or transparent touch overlay above these surfaces.

| Surface | Native implementation |
| --- | --- |
| Home / prices-sheet station cards | `NativeStationCard`, shared SwiftUI layout and native Go button |
| Show all / reset action | `GlassActionButton`, SwiftUI glass button |
| Onboarding Continue / permission / Get Started action | `GlassActionButton`, prominent native glass button |
| Welcome and predictive example price pills | `ExamplePricePill`, SwiftUI annotation content |
| Onboarding radius card and slider | `RadiusControl`, SwiftUI glass and Slider |
| Onboarding Live Activity illustration | `LiveActivityPreview`, SwiftUI layout, image, and glass |
| Trends leaderboard and scope picker | Existing SwiftUI leaderboard and Menu |
| Home map pills / pagination | Existing native UIKit cluster engine and page control |
| Tabs / settings / station brands / developer forms | Existing native tabs, SwiftUI forms and controls |

The legacy map/probe renderer and its diagnostic card retain their original
native-glass wrappers and animation instrumentation. They are not the production
iOS Home route. Non-iOS fallbacks remain separate; neither is a reason to replace
or weaken the live cluster probe. The cluster animation, tint, selection, ranking,
and data-fetching code were not changed by this conversion.

## Layout details

- Native cards report measured content height to the existing paged carousel.
- Hosts ignore nested safe areas and measure vertical content intrinsically.
- Larger text uses stacked card layouts; the radius page scrolls rather than
  compressing its header when the card needs more space.
- Native slider editing-end events reframe the radius preview using the latest
  value, while value changes still update the circle immediately.
- Compact glass actions use native Button labels and intrinsic sizing so the
  title cannot collapse when hosted inside a centered React Native row.

## Verification — October 1, 2026

- iPhone 13 mini / iOS 26.5 simulator: Home card, carousel swipe to second card,
  Show all return/reset, welcome/predictive examples, notification preview,
  Continue and Not Now, and radius drag from 10 to 13 miles.
- Light and dark appearances; accessibility-medium text. Native Home content
  remained readable. The radius header initially compressed at larger text;
  changing that page to a scroll container fixed it.
- Native prices sheet: long station-name fixture, full address, and $10.99 price
  rendered without truncating the numeric price. Fixtures were supplied only
  through the simulator sheet URL and never written to app/backend price data.
- `npm test`: 150 passed.
- Targeted Home-card, horizontal fallback-layout, radius, onboarding-interaction,
  onboarding-continuity and flow checks: 45 passed. RN source-layout checks now
  follow the retained fallback file; native layout was checked on the simulator.
- Trends regression checks: 35 passed.
- Release device build succeeded. No cluster animation code or probe gates changed.
