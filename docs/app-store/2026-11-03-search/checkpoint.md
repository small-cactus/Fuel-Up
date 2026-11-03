# US search acquisition checkpoint, November 3, 2026

- Apple Ads showed `[find cheap gas]` Running in Gas Prices Exact Match at $0.95 maximum cost per tap after saving. The keyword picker showed one of five search-popularity dots. Campaign settings showed $10 daily and an end date of November 6 at 12:00 AM New York time.
- Apple confirmed one custom product page submitted, Waiting for Review. [E85 and diesel station finder](https://appstoreconnect.apple.com/apps/6759831421/distribution/productpages/50bdb8ad-af9e-43d1-ac01-20841f027af7) uses the approved English keyword `locator`. Its E85 screenshot leads the medium iPhone and 13-inch iPad galleries, followed by nearby prices, trends, and brands. The subtitle terms E85 and diesel were unavailable in the keyword picker. [Review submission](https://appstoreconnect.apple.com/apps/6759831421/distribution/reviewsubmissions/details/46f601a7-dae2-441f-a0c8-b00341219581)
- The [Find Cheap Gas page](https://sites.google.com/view/fuel-up-gas/find-cheap-gas) is published on the existing website. A public GET returned 200. The install button points to the correct [US app listing](https://apps.apple.com/us/app/id6759831421), also verified by public GET.
- The 1.0.3 English (US) metadata draft uses the published page as Marketing URL and tests `flex` in place of `trends`. Keywords: `near,me,nearby,cheapest,locator,compare,gasoline,premium,regular,midgrade,map,flex,local,tracker`. Preserve the 1.0.2 baseline for the ongoing welcome screenshot test; the draft has no release or measured result.

### Baselines for follow-up

US Apple public software search, returning up to 200 records. Positions are one-based and can vary across requests; use the same storefront, query and parameters when comparing. These are discovery proxies. November 2 reference: [research evidence](../2026-11-02-welcome-comparison/research-evidence.json).

| Term | Nov 2 | Nov 3 |
|---|---:|---:|
| find cheap gas | 20 | 17 |
| cheap gas | 21 | 160–166 |
| gas prices | 56 | 96 |
| gas prices near me | 36 | 106 |
| fuel up | 7 | 18 |
| e85 | 78 | 102–107 |
| diesel prices | 20 | 30 |
| diesel prices near me | — | 11 |
| e85 stations near me | — | 19 |
| local gas prices | — | 25 |
| cheap gas near me | — | 31 |
| gas price tracker | — | 44 |
| flex fuel stations | — | 47 |

Evaluate the new ad by its reported impressions, taps, spend and installs. Evaluate the custom page after approval by its own impressions and conversion. Compare rank changes separately over multiple days. Apple Search accounted for 874 impressions and eight first-time downloads in the seven days ending November 2. Neither new action has an observed effect on those numbers.
