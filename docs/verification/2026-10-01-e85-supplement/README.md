# E85 availability supplements — October 1, 2026

Added daily server-side availability imports from the public [E85Prices map](https://e85prices.com/e85map) and [Thorntons locator](https://www.mythorntons.com/locations/). Both endpoints are anonymous and have no access fee. No commercial-reuse license was found; free endpoint access is not evidence of unrestricted redistribution rights. No paid service or account was added.

## Verified outcome

- E85Prices: 6,262 valid directory records imported; 32 invalid-coordinate records rejected. Thorntons: 212 explicitly E85-tagged records imported; one rejected. Existing AFDC: 4,801 active records. These overlapping counts are not unique physical-station totals.
- Matching reconciles station IDs and standalone directory aliases using coordinates, address and brand. Palm Harbor aliases resolve to one station (63556); Oldsmar Thorntons (177822) is now included.
- Clearwater cache-only endpoint returned 14 E85 stations within 15 miles, including 10 without current prices. All 14 survived the Home card model. Five-mile search returned three and correctly excluded Oldsmar.
- No imported source prices or reporter identities are stored. Availability-only stations retain null price, null price timestamp and no grade quotes. Actual current cached quotes remain subject to the 24-hour rule.
- Daily Cron is active at 06:45 UTC. Successful imports are due the next UTC calendar day; failure backoff and Retry-After remain authoritative. Client requests read the database only.

## Import recovery

The first E85Prices database import exceeded the default API statement timeout (57014). Its transaction rolled back; Thorntons succeeded. A scoped migration gives only the protected background import RPC a 60-second statement timeout and five-second lock timeout. Reusing the already downloaded snapshot succeeded in 11.5 seconds, with the real response hash. Original failure evidence remains in source status, followed by the later success. No additional provider retry or nationwide collector changes were needed.

## Verification

- Application unit suite: 151 passed.
- Fuel cloud suite: 57 passed.
- Source/import/trajectory tests: 13 passed; final source/import rerun: nine passed.
- Both imports and site reconciliation exercised transactionally before deployment; final live state saved in `source-state.json`.
- Cache-only endpoint and Home model assertions reproduced with `node docs/verification/2026-10-01-e85-supplement/verify.mjs`; output saved in `endpoint.json`.
- Release iOS build succeeded and installed on iPhone 18 Pro Max without opening it. This proves installation, not visual phone validation.

Existing legacy cluster integration probe had timed out waiting for a watched cluster in the earlier E85 verification; its gate was not weakened or removed. These source changes do not modify the renderer.
