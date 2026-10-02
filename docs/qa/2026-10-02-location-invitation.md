# Location invitation and onboarding scroll correction

The welcome footer now overlays the full-height map. Previously the shared safe-area bar shortened the map content, placing its bottom blur above the controls. The welcome map and its existing native material blur now continue behind the footer.

Gas preferences now puts its heading inside the scroll view, matching the fuel and location pages. The bottom native soft scroll edge remains in place.

The location page replaces the permission card with an illustrative native Apple map, three fuel markers, and a short explanation of location use. It requests When In Use access only after Continue. There is one permission action, and successful authorization plus a usable fix automatically advances to fuel. Denial leaves the page available with Open Settings and explanatory text; no repeated system prompts are issued. The map is illustrative and does not show the user's position or claim live prices.

Apple's [Privacy HIG](https://developer.apple.com/design/human-interface-guidelines/privacy/) was consulted on October 2. Its pre-alert guidance calls for one Continue/Next action leading to the system prompt, rather than an Enable/Allow button that implies the custom screen grants permission. This implementation follows that pattern; this is not a claim of App Review approval.

## Validation

- 28 focused tests passed: native onboarding, asset mapping, state continuity, and preferences persistence.
- Debug simulator and signed Release iPhone builds succeeded.
- iPhone 13 mini simulator (iOS 26.5): welcome blur visually checked in light and dark; location map, text, and sole Continue action fit the compact portrait layout in both themes.
- Continue opened the actual Apple location prompt. Allow While Using App automatically advanced to Choose your fuel, page 3 of 4, without another tap.
- Scrolling Gas preferences moved the title completely offscreen with the content. Inline section search and the soft bottom edge remained visible.
- iPhone 17 Pro Max simulator: location layout inspected in dark mode. Don't Allow retained page 2 and changed the action to Open Settings with denial guidance.
- Temporary appearance overrides and suppression of an existing unsigned-Debug notification/keychain warning were used for visual QA, then cleared by restarting the simulator apps. No fixtures or permission overrides were applied to the physical phone.
- devicectl confirmed successful installation of the signed Release on Anthony's iPhone 18 Pro Max, bundle com.anthonyh.fuelup. Physical-phone interactions were not tested.
- Largest Dynamic Type and landscape were not manually exercised in this pass. Text uses native scalable styles and both content pages remain scrollable. Cluster rendering was untouched, so the cluster probe was not run.

Screenshots: [welcome light](evidence/2026-10-02-location-invitation/welcome-light.png), [welcome dark](evidence/2026-10-02-location-invitation/welcome-dark.png), [location light](evidence/2026-10-02-location-invitation/location-light.png), [location dark](evidence/2026-10-02-location-invitation/location-dark.png), [large location](evidence/2026-10-02-location-invitation/location-large-dark.png), [scrolled preferences](evidence/2026-10-02-location-invitation/preferences-scrolled.png).
