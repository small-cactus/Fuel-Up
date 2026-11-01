# Second-pass keyword and copy audit

Date: 2026-11-01. This is a review of relevance, clarity, accuracy, and available search evidence, not proof of globally optimal acquisition copy.

## Scope actually inspected

- The current English title/subtitle, live-version promo, saved 1.0.2 keyword/description draft, and screenshot treatment from the preceding verified Safari pass.
- All 210 English keys in the six-translation catalog, the active iOS native onboarding entry path and text, Settings refresh path, and Local Trends empty-state path.
- Stored App Store localization metadata for en-US, es-MX, Simplified Chinese, Traditional Chinese, French, and Vietnamese. These saved translations are not a fresh live verification of each locale. All stored title/subtitle/keyword/promo/description lengths pass their respective character limits; length compliance is not native-speaker editorial approval.
- Additional live Shipmunk U.S. iPhone searches: `gas price tracker` and `midgrade gas`.

## Keyword assessment

| Candidate group | Assessment | Evidence limitation |
| --- | --- | --- |
| cheap gas / gas prices / gas prices near me | Strong alignment with the core product; retain in title and exact-match ads | Previous Shipmunk cheap-gas rank 14 is a dated observation, not a demand estimate |
| E85 / diesel / station finder | Concrete supported differentiation; retain subtitle and ads | Competitive results do not establish conversion rate |
| near / me / nearby / cheapest / compare / locator | Complement existing metadata and local price intent | Individual contribution and cross-word query combinations remain unmeasured |
| tracker | Supports price-history intent | Live `gas price tracker` results include Gas Prices Near You, GasBuddy, GasPulse, and mileage trackers: relevant but mixed intent |
| midgrade / regular / premium / gasoline | Truthful fuel-type specificity | `midgrade gas` shows Fuel Up at rank 7, but includes less relevant results; no verified volume |
| local / map / trends | Describe the actual experience | No demonstrated install contribution yet |

The 98-character organic keyword field remains a candidate set. Do not churn it on another unmeasured guess or call it the best possible. Shipmunk displayed popularity 0 for both additional queries; its difficulty/traffic numbers are tool scores with unverified methodology, not verified Apple query counts. Organic rankings and paid auctions are separate outcomes.

The description is readable and accurate, with nearby prices, no signup, fuel choices, Local Trends, and limitations clearly stated. It is not a measured conversion winner. In-app labels should help people use the app; stuffing them with search keywords would damage clarity. Apple's documented search factors emphasize title, subtitle, keywords, category, and user behavior, not a promise that every UI string improves search ranking.

## Concrete copy corrections

| Surface | Before | After | Reason |
| --- | --- | --- | --- |
| Native welcome and matching React artwork | Find the cheapest gas near you, instantly. | Find cheaper gas near you. | Avoid an absolute price/speed promise unsupported by reported observations and network timing |
| Settings refresh acknowledgement | Prices Refreshed | Refresh Requested | Cache reset requests a later fetch; it has not yet proved new prices arrived |
| Settings refresh failure | Reset Failed | Refresh Failed | Match the action the user chose |
| Local Trends empty state | Not enough historical data collected yet to render trends. Check back soon. | Not enough local price history yet. Check back soon. | Remove implementation language and identify the relevant scope |

Updated all six translated catalogs and regenerated seven native language resources locally. Translation keys and placeholders remain consistent. These changes are committed source for the next build, not installed-device or App Store release evidence.

## Validation and remaining evidence

- Existing localization suite: 6/6 passing.
- JSX source parse and git whitespace checks performed.
- No layout, permission, collection, price-ranking, or navigation logic changed.
- No device screenshots or native-speaker review completed in this pass. Dynamic backend/OS text and every possible runtime error have not been exhaustively exercised.
- Organic keyword effects need release plus time and search metrics. Description and screenshot conversion need sufficient observed traffic. The screenshot treatment remains submitted for review, not a confirmed winner.
- Native labels such as Home, Trends, Settings, Local, National, Continue, Cancel, and fuel grades remain concise and familiar. Optional research disclosures remain explicit; conversion goals do not justify obscuring collection or consent.

## Primary guidance

https://developer.apple.com/app-store/search/
https://developer.apple.com/app-store/product-page/
https://github.com/indieGoodies/Shipmunk
