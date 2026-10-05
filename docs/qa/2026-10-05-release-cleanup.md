# Release cleanup, October 5

The app now ships Home, Trends, and Settings tabs. The Dev screen and Live Activity
Designer source were moved outside the route tree into `devtools/`, preserving
useful development source without shipping those screens or their simulation imports.

Removed unreferenced Skia, Victory Native, and Expo Video dependencies. Literal
platform/development guards exclude legacy Home and onboarding screens from iOS
Release; Android fallbacks and the existing development map probe remain. The
legacy icon import addresses only Ionicons instead of the entire font collection.

Release settings now optimize the widget extension (previously `-Onone`), disable
the debug dylib, strip native symbols, and minify bundled JavaScript. dSYMs remain
outside the app for symbolication. Each Release bundle pass removes obsolete files
only from its generated asset folder before Metro copies current assets.

## Measured signed device app

- Before: 97,602,485 bytes.
- After: 45,376,707 bytes.
- Reduction: 53.5%.
- Measurement sums regular files inside the signed arm64 `.app`; App Store download
  and installed allocation sizes differ.
- No debug dylib, unused vector icon fonts, or legacy predictive illustration in
  the final app. Required native branding, station logos, research notifications,
  widgets, splash shaders, and app functionality remain.
- Production export source map contains neither development screens nor legacy
  Home/onboarding, and retains the chart and driving-research implementation.

## Validation

- Signed Release build succeeded; strict deep signature verification succeeded.
- Installed in place on the paired iPhone 18 Pro Max; no user data erased.
- Simulator with updated JS verified Home map, Trends, and Settings and exactly
  three tabs. This is navigation QA, not a claim of physical-device visual QA.
- Full configured unit suite: 163 passed on final run. One cache test failed on
  the initial parallel run, passed independently, and passed on the full rerun;
  no cache implementation or test was changed.
- Trends suite: 44 passed. Settings/onboarding/launch selection: 15 passed.
- Release packaging tests: 3 passed, including iOS Release exclusion, development
  probe/Android retention, widget optimization, and scoped/idempotent asset cleanup.
- Skeleton transition removal is separately preserved in commit `34f96c5`.
