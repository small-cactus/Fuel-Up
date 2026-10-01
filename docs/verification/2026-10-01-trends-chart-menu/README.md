# Trends chart continuity and native menu — October 1, 2026

Local's chart disappeared when its newly selected station set had no matching historical rows, when only one observation existed, or when gap segmentation left only isolated points. National intentionally split its path across missed collection hours. The user now explicitly requested display filling from the last known value, superseding the earlier no-fill presentation rule.

Both scopes use one continuous curved line with the existing gradient and no point dots. A display-only helper carries the preceding observed price through missing hourly/daily buckets and through the trailing interval. A lone observation draws a full-width flat line. A Local area with no historical rows starts from the arithmetic mean of its currently visible, fresh, raw station quotes. With no known prices at all, the existing empty state remains; zero or invented prices are never substituted. Stored history, quote ranking, measured deltas, completed-scan cache, and 24-hour serving filters are unchanged.

The scope control uses Expo's Apple SwiftUI Menu with an inline Picker, native glass button style, a selected-option checkmark, and an explicit SF Symbol chevron. Its label takes its intrinsic size so SwiftUI cannot compress away the selected text. Existing Android fallback remains simple. Native approach was verified against installed Expo sources and [Apple's picker documentation](https://developer.apple.com/documentation/swiftui/picker) and [glass button style](https://developer.apple.com/documentation/SwiftUI/PrimitiveButtonStyle/glass%28_%3A%29).

Validation:
- Trends suite: 34/34 passed, including gaps, trailing carry-forward, single observation, no-data fallback, immutable raw rows, current raw average, and unchanged rank-history behavior.
- Added rendered-screen regression then passed: a Local area without history still emits a valid SVG line and shows its current $3.25 average. Existing gradient interruption cleanup and no-dot checks remain.
- App suite: 144/144 passed. ESLint: no errors; existing style/performance warnings remain. Diff whitespace check passed.
- Live FuelUp Glass Lab simulator: Local full-width graph, native dropdown with Local checked, National selection and continuous chart across the earlier missing hours, plus dark appearance. Screenshots included. The temporary dark setting was restored to System.
- Release build succeeded and installed on the user's iPhone 18 Pro Max. Phone app was not opened; visible verification is simulator evidence, not phone interaction.
- No backend deployment, provider fetch, native map animation, or clustering change.
