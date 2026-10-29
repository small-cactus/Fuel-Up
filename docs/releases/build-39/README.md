# Fuel Up 1.0.1 (39)

Release prepared 2026-10-29 for production App Review.

## Included changes

- Map stutter correction for the optional driving-research SQLite event-time lookup.
- Local Trends loads available nearby station history for new installations. Local remains the default; National requires explicit selection.
- Settings scrolls behind the native glass tab bar while keeping the final rows accessible. See `settings/README.md` for light/dark simulator evidence.

## Build and verification

- Signed Release archive: `FuelUp-39-settings-fixed.xcarchive` (the earlier `FuelUp-39.xcarchive` predates the Settings correction and was not uploaded).
- App and both extensions report version 1.0.1, build 39, with valid signatures and debugging disabled. See `export-validation.json` for bundle validation and exported IPA SHA-256.
- Archive and export succeeded; upload succeeded at 2026-10-29 11:49:44 EDT.
- Upload emitted a nonblocking missing Hermes framework dSYM warning for UUID `B99B4F0D-1B56-3D94-940F-383F4F00C905`. Hermes-native symbolication for that framework may be limited.
- Settings validation: native simulator build, in-place installation, light/dark scrolling screenshots, 165 standard tests and seven focused tests passed.
- The Settings change has not been visually verified on a physical iPhone.

## Submission preparation

- App Store Connect draft version 1.0.1 created; manual release retained.
- What's New saved for English (U.S.), Simplified Chinese, Traditional Chinese, French, Spanish (Mexico), and Vietnamese.
- Review notes describe onboarding, map, Local Trends, Settings, optional research consent, and existing installation analytics.
- Processing completed, build 39 was attached, and the production submission succeeded at 2026-10-29 11:58 EDT (15:58 UTC).
- App Store Connect submission record explicitly shows **Waiting for Review** for **1.0.1 (39)**. This is submitted, not yet approved or released.
- Submission ID: `ab42ab56-41d7-4252-9b98-039f5ff2d82b`.
- Manual release remains selected; approval does not automatically publish the update.

## English What's New

• Fixed stutters while panning and zooming the map.
• Local price trends now load for new users using available nearby station history. Trends continues to open on Local.
• Fixed the Settings background so content scrolls behind the glass tab bar.
