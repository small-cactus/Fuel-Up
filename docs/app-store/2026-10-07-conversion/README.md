# Fuel Up conversion screenshot set

Four focused product images for the English (U.S.) App Store page. Genuine app captures were taken October 6, 2026 local time (October 7 UTC), using public Cupertino demo coordinates. No prices, rankings, map markers, or UI were fabricated or retouched.

## Story and order

1. **Find cheaper gas. Near you.** Immediate core benefit, with the nearby price map and station card.
2. **Gas prices change. Stay in the know.** National Trends chart and recently reported station comparisons.
3. **Your usual fuel. And E85.** Dark appearance, premium search with yellow E85 availability markers. Does not claim an E85 price exists when it is missing.
4. **Your stations. Your way.** Brand favorites and membership preferences.

Large two-line headlines stay legible at search-result scale. Short supporting copy provides context without covering the interface. The Fuel Up wordmark, consistent framing, and gentle color progression connect the set. Four distinct benefits avoid repetitive filler.

## Provenance and dimensions

Captures use the current localized simulator Release app, built October 6 at 22:30 local time. Its embedded build number is 25; build 26 changes the release number, with the same relevant product UI. This is simulator evidence, not a claim that App Store build 26 was launched on a physical device.

- iPhone screenshots: iPhone 17 Pro Max simulator, 1320 × 2868 source pixels. Uniformly fitted without stretching into three marketing canvas sizes: 1320 × 2868, 1206 × 2622, and 1080 × 2340. Smaller exports are marketing compositions of the same current phone screen, not separate smaller-device UI QA captures.
- iPad screenshots: separately captured current app on the 13-inch iPad simulator, 2064 × 2752. A dedicated tablet composition retains its actual interface.
- `raw/` retains unedited source captures; `exports/` contains final RGB PNGs without alpha.
- `manifest.json` records source mappings, dimensions, headlines, and export filenames.
- `preview-*.png` are four-image contact sheets for comparison at thumbnail scale.

## Regeneration and verification

Run `node render.cjs` with Sharp available on `NODE_PATH` (or installed in the execution environment). The renderer checks all 16 outputs for dimensions, opacity, and device-frame overflow. The phone artwork retains its source aspect ratio. Visual review covered the large and compact phone contact sheets and the separate tablet layouts; the intermediate phone size uses the same geometry. Syntax validation and `git diff --check` passed. No app code changed, so app unit/build tests are not relevant to these static assets.

## ASO basis and measurement

Apple recommends showing the app's essence first and keeping each subsequent screenshot focused on one main benefit or feature. The first one to three screenshots can appear in search results. This is why the set leads with nearby prices, Trends, and E85 instead of setup or research screens.

- https://developer.apple.com/app-store/product-page/
- https://developer.apple.com/app-store/product-page-optimization/

This design is a conversion hypothesis, not a proven maximum. After release and sufficient traffic, compare the first image against an alternative using Apple's Product Page Optimization, keeping other listing variables stable. Evaluate conversion rate with uncertainty; do not call a winner on a small sample. No paid ASO tools or invented search-volume estimates were used.

The listing must remain in Prepare for Submission. Uploading these assets does not authorize App Review submission.

## Upload receipt

Uploaded and verified in App Store Connect on October 7, 2026 UTC for app `6759831421`, version 1.0, English (U.S.):

| Category | Final count | Export folder |
| --- | --- | --- |
| iPhone with Dynamic Island, medium | 4 | `exports/iphone-medium` |
| iPhone with Dynamic Island, large | 4 | `exports/iphone-large` |
| iPhone with Face ID, medium | 4 | `exports/iphone-compact` |
| iPad 13-inch | 4 | `exports/ipad` |

Every populated category shows `01-nearby.png`, `02-trends.png`, `03-e85.png`, `04-brands.png` in that order. All four uploads finished processing in every category. Previous attachments were removed from the draft; their recoverable source assets remain in Apple's Asset Library. The version page was reopened and confirmed saved, with Save disabled and status **Prepare for Submission**. No review was submitted. `app-store-draft.png` and `app-store-ipad.png` preserve visible dashboard proof.
