# Price-drop onboarding consistency

The final setup page now uses the existing blurred map background, wordmark/title
spacing, and split capsule footer. The price-example divider is removed. Copy,
the $3.90 to $2.80 example, permission handling, and skip handling are retained.

The map backdrop previously allocated four maps for a five-page flow. Its map
count and initial offsets now follow `OnboardingModel.pageCount`.

## Verification

- Release simulator build succeeded using the FuelUp workspace/scheme and the
  existing DerivedData cache. Installed in place, preserving simulator app data.
- 21 tests passed across nativeOnboarding, onboardingSave, onboardingHandoff,
  onboardingFlow, onboardingLocation, and priceAlerts.
- iPhone 17 Pro / iOS 26.5: replayed the real setup flow in light and dark themes.
  Title starts at the same position as the other form pages; both buttons use
  the existing Skip/Save frames. No separator remains in the example card.
- iPhone 13 mini: replayed setup and checked the final page at normal text size.
  All content fits, with readable wrapping and no clipped controls.
- Not now completes setup and leaves Nearby price drops off. Yes, tell me
  completes setup and enables the setting with the simulator's existing system
  permission. This does not verify a fresh permission prompt or push delivery.
- Restored the review simulator to Light with Nearby price drops off.
- No physical-device installation or App Store upload performed.

## Accessibility limitation observed

At the largest accessibility text size on iPhone 13 mini, prices correctly stack
and the content scrolls, but the shared footer's blur obscures the last line of
the savings example at the bottom of the scroll range. The split button labels
wrap into tall capsules and remain tappable. This check is not a claim of complete
maximum-text-size visual clearance. The simulator text size was restored.

## Images

- `before-light.png`: original centered page, gray background, divider, stacked actions.
- `after-light.png`: corrected iPhone 17 Pro page.
- `after-dark.png`: corrected dark-theme page.
- `after-compact.png`: corrected iPhone 13 mini page.
- `diff/`: same-device visual comparison (15.10% pixel mismatch, expected from layout/background changes).
