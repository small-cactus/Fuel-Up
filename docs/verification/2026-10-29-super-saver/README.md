# Fuel Up Super Saver — revised paywall preview

Superseded by [native close, accordion, and Metal area-light transport](native-close-accordion/README.md).
The screenshots and shader description below document the earlier version.

Replaces the initial Plus concept. This is still a local, flag-gated design preview
at **$19.99/year**, with no StoreKit transaction or entitlement change.

## References and design choices

Reviewed the [Superwall template gallery](https://superwall.com/templates), including:

- [Opal](https://paywall-screenshots.superwall.com/i9_RRd1CJdNTEbzF1O16p.png):
  subdued upper glow, a centered hero, three concise benefits, and a bottom CTA.
- [Mojo](https://paywall-screenshots.superwall.com/zeMUjNi5tp1ydnU5QyyPB.png):
  prominent product wordmark, annual price, and a single Continue action.
- [Roi](https://paywall-screenshots.superwall.com/7XD9LMGFlZtL57PMdw7hu.png):
  clear separation of hero and purchase controls. Its carousel/multiple plans
  would add unnecessary complexity to this one-plan preview.

Also reviewed [RevenueCat's paywall redesign case studies](https://www.revenuecat.com/blog/growth/paywall-redesigns-case-studies)
for removing redundant copy. These references inform layout, not a claim about
this app's conversion performance. No source screenshots/assets were copied into
the app. The user's orange/yellow reference informs the flowing wordmark color.

The revised composition uses the existing Fuel Up logo as an alpha mask, the
Super Saver name, three benefit lines, annual price, native glass Continue/close,
and essential renewal/legal controls. No eyebrow, slogan, illustration, benefit
descriptions, card borders, or particles.

## Native animation

Apple's [MTKView](https://developer.apple.com/documentation/metalkit/mtkview)
renders a Metal fragment shader directly in the existing FuelUpGlass module.
There is no per-frame JS work or third-party shader engine. Broad sine-warped
fields produce a soft amber metallic fold; stronger orange/gold remains inside
the wordmark. An 80-second cycle keeps movement slow. The background fades to a
quiet neutral surface behind the purchase controls and supports both app themes.

- 30 fps; background drawable capped at 480 px wide and at most 1x point resolution.
- Logo uses up to 3x resolution through its alpha mask.
- Two in-flight frames maximum per surface, with frames skipped under pressure.
- Pauses while unfocused, detached, or application inactive.
- Reduce Motion renders one static phase instead of animating.
- Shader compilation is off the main thread. Unsupported/failed Metal falls back
  to a static theme fill and orange wordmark.

## Enable

```sh
EXPO_PUBLIC_PAYWALL_PREVIEW=1 npm start -- --dev-client --localhost
EXPO_PUBLIC_PAYWALL_PREVIEW=1 npm run ios:device -- <paired-device-id> --install
```

Settings → Design Preview → Fuel Up Super Saver, or `fuelup:///plus-preview`.
The flag defaults off, including the deep-link gate. Native changes require a
fresh native build. Continue and Restore only open preview alerts.

## Verification

- `npm test`: 165 passed, 0 failed. Settings preference/lifecycle checks: 4 passed.
- Debug simulator native build and signed Release device build both succeeded.
  Final incremental Release build: 68 seconds, signature verified by install script.
- Installed in place on the paired iPhone 18 Pro Max, version 1.0.1 (39), with
  preview flag enabled. CLI launch to `fuelup:///plus-preview` confirmed.
  Physical screen pixels were not captured; visual/motion evidence is simulator-based.
- iPhone 13 mini: light/dark layouts, all three benefits and CTA visible, close
  and native Continue preview confirmation verified. The Settings entry carries
  the revised Super Saver name.
- iPhone 17 Pro Max: larger light layout captured. A preexisting development
  location warning overlay was dismissed via LogBox before the clean screenshot.
- Live Dynamic Type change exposed cached text line boxes. `PaywallText` now
  applies the full font multiplier explicitly to invalidate measurements. Retested
  the live change to Accessibility Large: no clipped text, benefits wrap, price
  and Continue remain reachable by scrolling. Restored standard Large text size.
- [12-second real-time capture](slow-metal-dark.mp4) confirms both wordmark and
  background change gradually while the foreground layout remains fixed.
- System Reduce Motion toggled on through Settings: two full-resolution captures
  12 seconds apart had exactly zero changed pixels in the hero/background area
  (13–65% of screen height). Restored Reduce Motion off afterward.
- `git diff --check` passed. App Store Connect was not changed.
- Preview guard remains default-off. No purchase/entitlement/provider collection
  code is introduced. No measured physical-device GPU/power claim is made.

Screenshots: [mini light](mini-light.png), [mini dark](mini-dark.png),
[Pro Max light](pro-max-light.png).
