# Persistent onboarding maps

The four-page native onboarding flow now mounts its MapKit backdrop once, outside
the UIKit pager. Welcome keeps its own map and annotations; Location, Fuel, and
Gas preferences share one Mission Creek map, mounted at full size from Welcome.
Native paging offsets move the welcome map with its page, including back swipes.
The forms retain their existing per-page blur and scroll behavior. The temporary
snapshot loader and the extra maps on Fuel and Gas preferences were removed.

The Location top blur band is 25% shorter (0.27 instead of 0.36 of the hero
height), with radius reduced from 20 to 12 and a smooth gradient. The bottom
band starts farther down (0.52 instead of 0.36 of the hero height), exposing
more of the map while preserving blur beneath the explanation and footer.

## Validation

- Debug simulator and signed Release iPhone builds succeeded.
- 27 focused onboarding/asset/state/interaction tests passed.
- Standard suite: 160 passed on rerun. The first run hit the existing intermittent
  `fuelCacheReset` duplicate-grade failure; its isolated rerun also passed. No
  cache code or tests were changed.
- iPhone 17 Pro Max simulator, iOS 26.5: Welcome, Location permission/automatic
  advancement, Fuel, Gas preferences, completion, replay, and light/dark checked.
- Repeated forward/back swipes across all four pages retained exactly two
  MKMapView instances with unchanged identities and full-screen frames.
- Final dark-mode recording shows nine page swipes with loaded map imagery;
  a short cancelled back swipe returns to Location.
- The unsigned simulator's existing Expo notifications keychain warning was
  dismissed during visual validation.
- Home clustering was untouched; the live cluster probe was not run. Compact
  devices, live VoiceOver, and Reduce Motion were not exercised in this run.
- Phone installation is pending a reachable physical device; the signed build
  is at `/tmp/FuelUpGlassDevice/Build/Products/Release-iphoneos/FuelUp.app`.

[Location, dark](evidence/2026-10-04-onboarding-map-continuity/location-dark.png)

[Page transitions](evidence/2026-10-04-onboarding-map-continuity/transitions-dark.mp4)

[Native map lifetime evidence](evidence/2026-10-04-onboarding-map-continuity/map-lifetime.json)
