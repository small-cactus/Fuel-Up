# Brand preferences and E85 QA

Seven-page onboarding adds nearby brand discovery/search, preferred-brand-first ranking, E85 co-availability, and matching Settings controls. Brands are ordered by the number of unique stations inside the selected radius that offer the selected fuel. Other brands remain available. GasBuddy E85 coverage searches return the chosen fuel grade; brand identity survives cloud cache/history. Home, Predictive and Trends use the saved preferences.

## Verified

- Core suite: 133/133; lifecycle/preferences checkpoint: 127/127; cloud suite: 50/50.
- Final feature regressions: 48/48, including strong ranking, discovery, clean setup/relaunch persistence, stale async results, permission races, and E85 cache separation. Run `node --test tests/stationPreferences.test.mjs tests/preferencesStore.test.mjs tests/brandPreferencesInteraction.test.cjs tests/onboardingFlow.test.mjs tests/onboardingLocation.test.cjs tests/onboardingInteraction.test.cjs tests/onboardingStateContinuity.test.cjs tests/fuelE85Cache.test.cjs`.
- Supabase migration and gas-prices deployment succeeded. Five-grade live/cache probe passed. Live Tampa premium + E85 query returned four stations with premium prices and confirmed E85 prices.
- iPhone 13 mini, iOS 26.5: XCTest passed the complete seven-page clean onboarding, 15-mile radius, E85 grade, independent Require E85 switch, preferred brand, Settings values, termination/relaunch persistence, Trends and Dev navigation. Source: `qa/ios/FuelUpQATests.swift`. Result: `/tmp/fuel-brands-compact8.xcresult`. All page screenshots were visually inspected. Location/radius uses the simulated Tampa GPS coordinate. Permission grant/denial behavior also has focused interaction tests; this run did not reset OS permissions.
- Fixed a real native glass rendering defect found during this pass: Continue text disappeared after advancing pages. Button content now sits over a separate native glass background. The button exposes its current page to accessibility and keeps a 56-point minimum height.
- Home screenshot verifies preferred Thorntons at $3.24 ranks above available RaceTrac at $2.34; cheaper other-brand map annotations remain visible. Brand sheet search was also inspected in dark mode on iPhone 17 Pro Max.
- Home card-swap Argent replay passed 4/4 with Fast Refresh disabled. Video showed annotation continuity during both swaps. React capture: 20.2 seconds, 40 commits, none over 16 ms. This is not a native FPS measurement or a valid before/after comparison.
- Release JavaScript bundled successfully, signed package verified, installed and launched on the physical iPhone 18 Pro Max. Physical visual/performance QA was not performed.

Screenshots, card-swap replay/profile metadata, a trimmed recording, and focused test output are in `docs/qa/evidence/2026-09-28-brands/`.

## Harness notes and remaining limits

The old six-page Argent onboarding flow was retired in favor of the seven-page native XCTest above; it could not represent the new final page. The existing Argent card-swap flow remains verified. XCTest taps the trailing SwiftUI switches, since a center tap on their multiline labels does not toggle them. The unsigned simulator binary emits an Expo notifications Keychain entitlement warning; the harness dismisses only that specific development overlay before tab navigation. The signed phone package has its provisioning entitlements. The simulator signing workaround was unsuccessful and the working simulator app was restored before the passing run.

The production cluster integration gate still times out while clustering is disabled; its thresholds were not changed. Native Instruments capture did not produce a usable trace. A single Expo notifications native initialization crash was observed earlier; this pass does not establish that underlying upstream race is fixed. Existing predictive robustness failures and ESLint warnings remain. Therefore this report is feature verification, not an assertion that the entire app is ready for market.

Concurrent native Glass Lab work in the shared checkout was excluded from the tested JavaScript and installed phone package. QA used an isolated checkout at the feature checkpoint plus the Continue rendering fix.
