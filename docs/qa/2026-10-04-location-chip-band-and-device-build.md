# Location chip band and CLI device build

Location's decorative price capsules now occupy the centered vertical 40% of the
map hero (30% through 70%). The existing 26-point inset reserves room for their
spring overshoot, and the band clips its contents. The grow/hold/shrink sequence,
stationary visible positions, native glass, map lifetime, and blur are unchanged.

`npm run ios:device -- <device-identifier> --install` performs a signed Release
build and updates the phone in place. It reuses the existing device DerivedData,
parallelizes independent targets, disables CLI compiler indexing, checks that
Pods are in sync, and keeps JS bundling enabled. It verifies the bundle signature
and identifier before installation and queries the installed bundle afterward.
The old phone identifier was removed from the Expo development shortcut.
`Agents.md` now documents wireless CLI installation and cache reuse.

## Storage cleanup

Removed only regenerable caches after checking that no build was using them:

- `/private/tmp/FuelUpQABuild`: obsolete October 1 QA build.
- `/private/tmp/fuelup-national-cache-build`: obsolete October 1 build.
- `~/Library/Caches/Homebrew`: downloaded package cache.
- `~/Library/Caches/pip`: downloaded package cache.

Available disk space rose from approximately 1.1 GiB to 14 GiB immediately after
cleanup. Subsequent builds consume some of that space. Active device/simulator
DerivedData, source, research artifacts, and existing QA evidence were preserved.

## Validation

- 27 focused onboarding tests passed.
- Shell syntax, CLI help and argument handling passed.
- A mocked failed build exits with its failure status and never attempts install.
- Debug simulator and signed Release physical-device builds passed.
- iPhone 17 Pro Max simulator, iOS 26.5: checked Location with animated capsules
  across their upper, middle, and lower positions in light and dark themes. The
  tighter band keeps them clear of the wordmark and Location heading. The existing
  unsigned-debug Expo notifications keychain warning was dismissed during QA.
- The CLI build with indexing disabled completed in 210 seconds while populating
  caches for the new compiler settings. An unchanged repeat build completed in
  **52 seconds**, with no CocoaPods install or clean step. This is a warm-cache
  measurement, not a controlled before/after speedup ratio; the initial reference
  build ran alongside simulator compilation and had different cache state.
- `devicectl device install app` succeeded on iPhone 18 Pro Max
  `00008160-001E206E02A0000A`. The subsequent installed-app query confirmed
  `com.anthonyh.fuelup`, version 1.0.0, bundle version 1. Installation was in place;
  no phone app data was cleared. Phone launch/interaction QA is not claimed.
- Compact phones, Reduce Motion, and VoiceOver were not exercised in this run.
  The unrelated live Home cluster probe was not run.

[Location in light mode](evidence/2026-10-04-location-chip-band/location-light.png)

[Location in dark mode](evidence/2026-10-04-location-chip-band/location-dark.png)
