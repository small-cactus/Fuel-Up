# Pre-review polish

October 7, 2026. No App Review submission or new TestFlight upload.

- Onboarding now presents a native alert when location is denied or restricted after the user requests access. Cancel dismisses it and leaves onboarding in place. Settings opens the app's system settings. Tapping Continue with an existing denial presents the same choices instead of redirecting immediately.
- Added Support and Privacy Policy rows at the bottom of Settings, linking to the published Google Sites pages.
- Renamed the Research & Debug section to Driving Research.
- Localized the added copy in all six non-English app languages and regenerated native language resources.
- Based on the user's explicit confirmation of content rights, saved the App Store Connect declaration that the app uses third-party content and has the necessary rights. Verified Saved and the resulting declaration text. Screenshot attached.

Validation: 26 existing Settings, localization, native-onboarding bridge, onboarding-save, and handoff tests passed. Release simulator build succeeded using the existing `/tmp/FuelUpGlassSim` cache; no dependency reinstall or cache cleanup. `git diff --check` passed. These changes were not installed or visually exercised in this turn, and no physical phone was opened. Build 26 already uploaded to Apple does not contain these code changes; a new upload is needed before review.

Scope follows the user's requested Cancel/Settings behavior. This change does not add manual location entry or resolve the separate authorized-but-no-GPS-fix timeout issue found in the previous audit.
