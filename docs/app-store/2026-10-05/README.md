# App Store screenshots — October 5, 2026

Sixteen full-resolution screenshots captured from the current Release simulator build at source commit `3b5e7b7` and uploaded to Fuel Up: Find Cheaper Gas (`6759831421`), iOS version 1.0, English (U.S.).

## Capture sets

| Directory | Simulator | PNG dimensions | App Store Connect slot | Images |
| --- | --- | --- | --- | --- |
| `iphone-medium` | iPhone 17 Pro | 1206 × 2622 | iPhone with Dynamic Island, medium display | 4 |
| `iphone-large` | iPhone 17 Pro Max | 1320 × 2868 | iPhone with Dynamic Island, large display | 4 |
| `iphone-compact` | iPhone 13 mini | 1080 × 2340 | iPhone with Face ID, medium display | 4 |
| `ipad` | iPad Pro 13-inch (M4) | 2064 × 2752 | iPad 13-inch display | 4 |

Every set has the same order:

1. Nearby gas map and recommended station card.
2. National Trends and cheapest reported regular prices.
3. Fuel types.
4. Station brands and memberships.

## Validation

- `xcodebuild` Release for iOS Simulator succeeded using `/tmp/FuelUpGlassSim`; no clean or dependency regeneration was needed.
- Captured using Argent at native resolution, with a public Cupertino demonstration location and a 9:41 status bar.
- Screenshots show actual app UI and observed price responses. Prices are provider reports, not verified pump truth. No prices or app content were composited into the captures.
- Reviewed the four screens on the compact, medium, and large iPhone and the iPad. Compact cards wrap long addresses; preference rows remain readable; scrolling content passes behind native tab controls. No clipping or overlap defect requiring a source change was found in these reviewed screens.
- All 16 files decode as RGB PNGs at the listed dimensions. `manifest.json` records their byte sizes and SHA-256 hashes.
- App Store Connect finished processing every upload. Revisited the iPhone Media Manager and reloaded the iPad page; each of the four populated slots showed **4 of 10 App Screenshots**, in the intended order, without processing or validation errors. Reviewed the rendered iPad previews as well.
- The prior five `fuelup_resized_*.png` assets were detached from the old Face ID large-display slot. App Store Connect explicitly confirmed they remain in the Asset Library. Other slots can inherit the new screenshots according to Apple's scaling behavior.

The app was not submitted for review, and the selected App Store build and other listing metadata were not changed. Physical phone state was not touched.

## Listing

- [iPhone Media Manager](https://appstoreconnect.apple.com/apps/6759831421/distribution/ios/version/inflight/media-manager/iphone)
- [iPad Media Manager](https://appstoreconnect.apple.com/apps/6759831421/distribution/ios/version/inflight/media-manager/ipad)

The captures and manifest are publication assets, not app bundle resources.
