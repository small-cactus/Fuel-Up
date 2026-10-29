# Fuel Up Plus design preview

Preview-only annual paywall for price-drop alerts, route-aware fuel reminders,
and following one favorite station. Display price: **$19.99 / year**.

## Enable and open

The build-time flag is off unless explicitly set to `1`:

```sh
EXPO_PUBLIC_PAYWALL_PREVIEW=1 npm start -- --dev-client --localhost
EXPO_PUBLIC_PAYWALL_PREVIEW=1 npm run ios:device -- <paired-device-id> --install
```

Open **Settings → Design Preview → Fuel Up Plus**, or `fuelup:///plus-preview`.
Restart Metro after changing the flag. For an ordinary build, omit the variable
or set it to `0`; both the Settings entry and the deep-link preview are gated.
This flag grants no entitlement and changes no existing feature availability.

Continue and Restore display native preview confirmations. There is no StoreKit
purchase, charge, subscription, alert registration, or station lookup in the
preview. The illustration contains fixed example data, not a real station price.
Terms and Privacy open the Apple standard EULA and the app's existing privacy page.

## Design

Existing Fuel Up wordmark, system typography, SF Symbols, app theme backgrounds,
native SwiftUI glass controls, and the existing native glass container. Warm amber
connects the route illustration, feature icons, and annual CTA. No custom blur or
glass borders. All benefits fit on the iPhone mini at the default text size; large
Dynamic Type moves the purchase section into the same scroll view.

Apple's [SubscriptionStoreView](https://developer.apple.com/documentation/storekit/subscriptionstoreview)
was considered; it requires real StoreKit product/group configuration. This
prototype uses native UI primitives without a product or billing integration.
The design-skill search returned generic web/clarity guidance; the existing app's
native patterns were the useful reference for this screen.

## Verification — October 29, 2026

- `npm test`: 165 passed, 0 failed.
- Settings preference/lifecycle tests: 7 passed, 0 failed.
- `git diff --check`: passed.
- iPhone 13 mini / iOS 26.5: light and dark screenshots; all three benefits and
  annual CTA visible at default text size. Open from Settings, close, Continue,
  and Restore confirmed. Continue explicitly states no purchase is made.
- Accessibility Large on the mini: expanded content scrolls; annual price,
  wrapping CTA, and footer links remain reachable. Returned system text size to
  Large and app theme to Light after testing. VoiceOver spoken output was not tested.
- iPhone 17 Pro Max simulator: larger light layout verified and saved.
- Flag `0` in a freshly restarted Metro bundle: preview deep link redirected to
  Settings, with the Design Preview section absent. Flag `1` verified separately.
- Signed Release 1.0.1 (39) built in 141 seconds, signature verified, installed
  over the existing paired iPhone 18 Pro Max app, and launched successfully using
  the preview URL. Physical screen pixels were not captured; visual evidence is
  from the simulators. The phone build embeds flag `1` and works without Metro.
- App Store Connect was not changed by this preview task.

Screenshots: [mini light](mini-light.png), [mini dark](mini-dark.png),
[Pro Max light](pro-max-light.png).
