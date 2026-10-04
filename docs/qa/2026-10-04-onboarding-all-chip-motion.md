# Onboarding: all price chips relocate

This follow-up supersedes the fixed-green behavior documented in `2026-10-04-onboarding-chip-lifecycle.md`. The user requested that green continue moving like the other chips.

All three chips now take turns shrinking, relocating, and growing. Each retains its color identity. Position and randomized price update only at zero scale. Green remains $3.89–$4.19 and neutral chips remain $4.20–$4.72, so green is always cheapest. Green briefly disappears during its relocation; it is never duplicated or transferred to another visible chip.

The 20–60% vertical placement band, 120 ms initial appearance spacing, map persistence, blur treatment, and static Reduce Motion branch remain unchanged.

## Verification

- 27 focused onboarding tests passed across nativeOnboarding, onboardingStateContinuity, onboardingInteraction, onboardingFlow, onboardingLocation, and onboardingAssets.
- Debug simulator build succeeded for iPhone 17 Pro Max, iOS 26.5.
- A 32.8-second light-mode simulator recording shows initial entry and repeated relocation, including green at multiple positions with new cheaper prices. The known unsigned debug Expo notifications Keychain warning was dismissed before checking onboarding.
- A supporting recorded-pixel heuristic checked 892 frames after the first 3 seconds: 851 contained one green component and 41 contained none during small or fully shrunk phases. It found four distinct rounded green centers and no frame with multiple green components. This is supporting visual evidence, not a semantic UI assertion.
- Dark appearance was checked separately.
- Signed Release build succeeded in 107 seconds using the persistent device cache. CLI installation over the existing app succeeded on the paired iPhone 18 Pro Max (`00008160-001E206E02A0000A`), and the device app query confirmed `com.anthonyh.fuelup`, version 1.0.0, build 1. Phone launch and visual interaction were not tested.

The live cluster probe was not run because cluster split/merge code was unchanged. Compact devices, Reduce Motion, and VoiceOver were not exercised live for this follow-up.

## Evidence

- [Recorded chip cycles](evidence/2026-10-04-onboarding-all-chip-motion/all-chip-cycles.mp4)
- [Recorded-frame check](evidence/2026-10-04-onboarding-all-chip-motion/frame-check.json)
- [Dark appearance](evidence/2026-10-04-onboarding-all-chip-motion/location-dark.png)
