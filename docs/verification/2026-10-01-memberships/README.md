# State-aware gas access and preferred station ranking

Memberships are now the fourth onboarding page, immediately after Location. The native SwiftUI Form/Toggle controls are also available in Settings → Gas Memberships. Saved memberships survive travel; new options come only from cached station inventory in the state Apple reverse-geocodes. All 50 states and DC normalize from names or postal abbreviations. No upstream station requests are made for this directory.

Supported access programs: Costco, Sam’s Club, BJ’s Wholesale Club, and Walmart+ (grants Sam’s fuel access). Public stations are not restricted just because they offer optional loyalty rewards. Club prices are hidden by default, including for existing installs with no saved memberships. Saved selections outside the current state remain editable. If location/network lookup fails, users can retry or continue with no club access and change Settings later; no guessed national options are substituted.

Home and Local Trends share eligibility and ranking. A preferred brand receives a $0.20/gallon ranking allowance, in integer thousandths to avoid a floating-point boundary error. At exactly 20 cents higher, the lower actual price wins. A 15-gallon fill represents up to $3 of preference value: this is the user's chosen tradeoff, not a statistically fitted optimum or a real discount. Displayed raw prices, 24-hour freshness, fuel grade, E85, radius, and ratings remain enforced. Swift's actual-cheapest green identity and clustering code are unchanged. National Trends stays a nationwide raw-price comparison.

## Sources checked October 1, 2026
- Costco member-only fuel: https://www.costco.com/f/-/gasoline-qanda
- Sam’s fuel eligibility: https://help.samsclub.com/app/answers/detail/a_id/380
- Walmart+ Sam’s member fuel access: https://www.walmart.com/help/article/walmart-benefits-fuel-discounts/b85623bb273a41979488aa9cbdb1b4c9
- BJ’s location discovery: https://www.bjs.com/clubLocator

Use cached inventory for geography instead of stale corporate state counts. Florida returned all four choices; Utah omits BJ’s; Alaska returns Costco. Some Sam’s stations permit public fueling, but the cached quote has no reliable membership-price eligibility distinction: do not expose a member-price quote without declared access. Special guest/gift-card and fleet-only programs are not modeled.

## Verification
- App suite: 149 passed.
- Focused access, onboarding interaction/persistence/location, preferences and request keys: 54 passed.
- Local/National Trends: 35 passed, including exact Home/Local access and preference parity.
- Existing brand interaction and predictive preference tests: 9 passed.
- Cloud service suite: 54 passed.
- ESLint: zero errors; existing/style/performance warnings remain.
- Live SQL: directory queried as anon for every state + DC; no raw station table access; invalid state returns an empty list. `verify.sql` reproduces `state-directory-verification.json`.
- Simulator: 375×812 iPhone viewport. Settings loaded Florida choices and saved a Sam’s toggle; after resetting only simulator onboarding, Location → Memberships is page 4 of 8. Light and dark appearance visually checked; simulator preferences/theme restored. Landscape and maximum Dynamic Type were not exercised. One transient directory load failed; visible Try Again recovered with HTTP 200 and correct options.
- Release iOS build succeeded. Installed on the paired iPhone 18 Pro Max with devicectl; the phone app was not launched.

Migration `20261001190000_state_fuel_memberships.sql` deployed and recorded. It adds a state index and one read-only public RPC exposing only known membership IDs. Research collection, archives, and schedules unchanged.
