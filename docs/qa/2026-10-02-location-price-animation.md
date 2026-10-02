# Location illustration and price animation — October 2, 2026

The decorative map now extends 100 points farther down behind the existing text. The title, scroll content spacing, and stationary Continue footer retain their positions. Native map attribution remains above the copy.

Three native Liquid Glass sample-price capsules have staggered lifetimes. Each grows from zero over 0.45 seconds, holds still for several seconds, shrinks to zero over 0.32 seconds, then selects a free location before growing again. Six reserved areas prevent overlaps. The values are marked as sample prices and do not come from or change research or live station prices.

Animation uses the embedding UIKit application's foreground notifications and the selected onboarding page. Leaving the page or backgrounding cancels its task. Reduce Motion presents static capsules; this branch was code-reviewed but not exercised through the system setting during this check.

## Verification

- 28 focused onboarding, assets, state-continuity, and preferences tests passed.
- Debug simulator and signed Release device builds passed.
- Recorded 16 seconds on iPhone 17 Pro Max simulator; capsules hold, disappear, and reappear in different areas. Checked light and dark appearance.
- iPhone 13 mini simulator: capsules fit, content scrolls to reveal all three benefits, and Continue remains stationary.
- Installed the Release build on Anthony’s iPhone 18 Pro Max. Installation succeeded; the physical phone app was not launched for QA.
- Cluster rendering and collection services were not changed.

## Evidence

- [Animation](evidence/2026-10-02-location-price-animation/animation.mp4)
- [Light](evidence/2026-10-02-location-price-animation/light.png)
- [Dark](evidence/2026-10-02-location-price-animation/dark.png)
- [Compact, after scrolling](evidence/2026-10-02-location-price-animation/compact-scrolled.png)
