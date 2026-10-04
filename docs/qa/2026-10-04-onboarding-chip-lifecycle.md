# Location chip placement and lifecycle

The chip band remains 40% of the map hero's height, shifted upward from 30–70%
to **20–60%**. Entry starts with the green chip visible and a small spring pulse;
the two neutral chips begin their pops 120 ms apart, instead of waiting 1.6 seconds
between each initial appearance.

Chip colors never change. One green chip keeps its price and position throughout
the view's lifetime, ensuring it stays visible without overlapping another green.
Only the neutral chips cycle: shrink for 320 ms, wait until fully gone, select a
different unoccupied cell and a new price, then grow there. Visible chips do not
move or change price. Reduce Motion displays all three without cycling.

Prices are illustrative, randomized in cents within the existing $3.89–$4.72
window. The green price uses $3.89–$4.19 and neutral prices use $4.20–$4.72, so the
green chip is always strictly cheaper. Tint follows a fixed chip identity rather
than a particular displayed price string.

## Validation

- Final Debug simulator and signed Release device builds passed; Release took
  82 seconds using the saved CLI workflow.
- 27 focused onboarding checks passed after the final edit.
- iPhone 17 Pro Max simulator, iOS 26.5: recorded first entry and repeated neutral
  shrink/disappear/relocate/grow cycles. Reviewed light and dark appearance.
- The light-mode recording contains 907 frames at 30 fps. A pixel-color heuristic
  over the 832 frames after 2.5 seconds found exactly one green capsule in every
  frame, with identical bounds. This supplements visual inspection; it is not an
  exhaustive semantic UI test. The green price remained $4.01 in this recording,
  below the randomized neutral prices.
- The existing unsigned-debug Expo notifications keychain warning was dismissed
  before recording. Compact phones, live Reduce Motion changes, and VoiceOver
  were not exercised. Home cluster behavior was untouched; its probe was not run.
- Installed the final signed build in place on iPhone 18 Pro Max
  `00008160-001E206E02A0000A`. `devicectl device info apps` confirmed
  `com.anthonyh.fuelup` (1.0.0, bundle version 1). Phone data was preserved.
  Physical-phone interaction QA is not claimed.

[Entry and neutral chip cycles](evidence/2026-10-04-onboarding-chip-lifecycle/entry-and-neutral-cycles.mp4)

[Recorded-frame check](evidence/2026-10-04-onboarding-chip-lifecycle/frame-check.json)

[Dark appearance](evidence/2026-10-04-onboarding-chip-lifecycle/location-dark.png)
