# Fuel Up 1.0.3 (41) — nearby price drops

Users can opt in during setup or through Settings → Nearby price drops. Same-station, same-grade, same-payment comparisons come from fresh reported prices in the last nearby Home search. A significant cut must also put the station within 5¢ of the cheapest watched option. See [the price alert runbook](../../../scripts/price-alerts/README.md) for thresholds, expiration, hours and operation.

Verified November 4 on a dedicated iPhone simulator against the production subscription API and Apple’s sandbox APNs. An opted-in Home search registered 40 eligible station IDs. A rollback-only earlier-price fixture exercised the actual matching query against a current station quote. The sender used the matching review simulator’s own sandbox address. Apple accepted the request and SpringBoard published the notification with the app terminated. Switching the feature off in Settings removed the watch. No customer alerts or changes to provider data were used for verification.

The scheduled Supabase sampler and local launchd sender are operational. The hosted sender accepts only the dedicated runner credential and its scheduler returns without dispatch until hosted signing is configured. Existing installations require a client update and explicit opt-in.

The App Store archive and export succeeded. Strict code-signature checks passed for the app and both extensions. All three identify as 1.0.3 (41), and the main app carries the production APNs entitlement. The signed IPA is saved alongside the November 4 Xcode archive. This task did not submit it to App Review. The package digest and bundle checks are in [export-validation.json](export-validation.json).

In the October 29–November 3 market sample, 391 of 6,112 station-day comparisons (6.4%) met the 10¢ and 3% size tests. This is a calibration of the size filter alone. Those daily observations can mix cash and credit; actual sends require matching payment type, an eligible nearby alternative, a fresh quote, a recent opted-in watch and the delivery controls.
