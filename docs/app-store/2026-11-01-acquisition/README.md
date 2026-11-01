# Acquisition optimization — November 1, 2026

## Verified starting point

Inspected the two existing Safari tabs (App Store Connect and Apple Ads), the installed Shipmunk application, and Apple official guidance. No paid research subscription was purchased.

- App Store: 1.0.1 (39), Ready for Distribution.
- Apple Ads: existing United States Search Results campaign, Running, but zero reported impressions, taps, installs, and spend in Last 7 days. Reporting can lag three hours. Running is not proof of delivery.
- Shipmunk U.S. iPhone query `cheap gas`: Fuel Up at position 14. `gas prices near me` and `e85 finder`: not seen in the first 30 results inspected. These are dated observations, not guaranteed future ranks. Shipmunk heuristic scores are not Apple search-volume data.
- Live title/subtitle already cover core terms: `Fuel Up: Find Cheap Gas Prices` / `E85 & Diesel Station Finder`. Preserved both.

## Saved changes

### Apple Ads

Campaign 2145003416, ad group 2152358223. Audience broadened to Reach All Eligible Users; U.S. geography preserved. Search Match remains off. Exact matching concentrates the small test budget on relevant intent.

Added 14 terms, bringing the group to 22. Seven core terms use a $0.95 max CPT test bid; the other 15 remain $0.64. No claim that $0.95 is optimal; there is no conversion history yet.

$0.95: cheap gas, gas prices, gas prices near me, cheapest gas, cheap gas near me, cheapest gas near me, cheap gas finder.

$0.64: gas finder, gas station finder, diesel prices, e85 finder, gas station near me, gas stations near me, compare gas prices, fuel prices, diesel prices near me, diesel fuel finder, e85 near me, e85 stations, e85 gas stations, premium gas prices, gas price tracker.

Daily budget remains $10. Start October 30 at noon; end changed from November 7 midnight to November 6 midnight, America/New_York, to keep the original one-week test within seven $10 calendar-day allocations. This is not authorization for recurring spend. No budget increase, duplicate campaign, broad-match expansion, or paid third-party service.

### Live-version promotional text

Saved and re-read on version 1.0.1:

> Find cheaper gas near you. Compare regular, premium, diesel and E85, check local price trends, and choose your next stop. No signup required. U.S. coverage.

Promotional text is conversion copy, not an indexed keyword field.

### Next-version metadata draft

Created 1.0.2 in Prepare for Submission. Saved and reloaded the 98-character keyword field:

```text
near,me,nearby,cheapest,locator,compare,gasoline,premium,regular,midgrade,map,trends,local,tracker
```

It retains local intent and fuel-grade discovery, adds `cheapest` and `tracker`, and replaces weaker/narrow tokens `93`, `91`, `flex`, and `ethanol`. Avoids repeating name/subtitle words. This is a hypothesis, not measured search uplift.

The draft description now leads with nearby prices and no signup, explains comparing stations and choosing a stop, and makes Local Trends the primary view with National as an explicit alternative. Research is still optional; pump-price and coverage limitations remain. Promotional text copied into the draft too.

**Draft keywords/description are not live. A new 1.0.2 binary and App Review are required.** No binary was built or submitted in this acquisition task; no release was claimed. Existing other-language metadata was preserved.

### Screenshot experiment

Product Page Optimization test `Nearby gas - no signup - November 2026` (62271d72-034c-4759-979a-866a5a964479), Treatment A (98dbcb36-0735-459a-b3c7-2e40eabb4b6f), English (U.S.), one treatment at 50% traffic.

Changes only the first image headline to **Cheaper gas nearby. No signup.** with **Compare prices. Choose your next stop.** The other three images remain byte-identical. Uploaded all four images for each of the four existing size sets, verified four accepted screenshots per set and first-image order. Visually checked the App Store Connect treatment preview. Original listing assets remain unchanged.

Clicked Start Test, Add for Review, then Submit for Review. Apple confirmed **1 Item Submitted** and said review may take up to 48 hours. This is submitted for review, not a running experiment or a proven winner.

## Creative provenance and validation

`render.cjs` regenerates the first image in four sizes using the genuine app captures in `../2026-10-07-conversion/raw`. These are retained October captures, not newly captured November device QA. App pixels are uniformly resized and rounded at the device edge; prices and controls are not fabricated. It copies screenshots 2–4 unchanged from the earlier exports. `manifest.json` records source paths, dimensions and SHA-256 hashes.

Validation: 16 exports with correct dimensions and no alpha, 12 unchanged copies byte-matched to source; node syntax check and git diff whitespace check. Main phone preview reviewed for readable hierarchy and no clipping. No app source changed, so native app tests are not applicable.

Reproduce with Node and sharp installed outside the app dependencies:

```sh
NODE_PATH=/tmp/fuel-aso-tools/node_modules node docs/app-store/2026-11-01-acquisition/render.cjs
```

## Measurement and follow-up criteria

- Allow reporting delay before judging whether delivery resumed. Diagnose account/ad eligibility if zero impressions persists; do not keep escalating bids blindly.
- Measure impressions, tap-through rate, installs, tap-through conversion rate, and cost per install by keyword. There are no observed search queries or winning keyword economics yet.
- Keep total spend within the approved one-off $70 test. No automatic extension or recurring campaign.
- Evaluate screenshot test using Apple's confidence/result reporting after meaningful traffic. Small counts cannot establish a winner. Keep only changes supported by conversion evidence.
- Organic ranking depends on relevance and user behavior as well as metadata. No tool or keyword set can guarantee ranking above every competitor.

## Official references

- https://developer.apple.com/app-store/product-page/
- https://developer.apple.com/app-store/search/
- https://developer.apple.com/app-store/product-page-optimization/
- https://ads.apple.com/app-store/help/ad-groups/0021-modify-audience-settings
- https://ads.apple.com/app-store/help/bids-and-budget/0016-manage-budgets
- https://ads.apple.com/app-store/help/recommendations/0090-manage-recommendations
- https://github.com/indieGoodies/Shipmunk
