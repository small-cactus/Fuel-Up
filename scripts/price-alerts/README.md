# Nearby price drops

The price-alert choice is separate from research consent, iOS authorization, and silent-sync registration. The client requires explicit opt-in and visible notification permission. A recent device fix must agree with the Home search origin to within a quarter mile. Manual searches suspend the watch. The app sends up to 40 eligible station IDs for the chosen fuel grade and radius, plus the device time zone. It does not submit coordinates to the watch endpoint. Settings → Nearby price drops clears the subscription. A watch expires seven days after its last refresh.

Supabase samples cached, station-level quotes from complete national sweeps at minutes 7, 27, and 47. No extra provider collection runs. The matcher compares prices for the same station, fuel and payment type. A candidate must be at least 10¢ and 3% below an earlier report within 24 hours, the new report must be at most 12 hours old, and it must be within 5¢ of the cheapest fresh watched quote for that payment type. A notification names the fuel, decrease, station, new reported price, and cash/credit basis. Tapping it opens the Home map and selects the station if it is still in the user's eligible results.

Delivery hours are 8 a.m. through 8:59 p.m. in the device's last reported time zone. An atomic claim consumes the quote and a 48-hour per-installation cooldown before contacting Apple. That conservatively suppresses another attempt after a timeout with an unknown outcome. Delivery history expires after 30 days. Both senders share these controls.

## Operations

- The local APNs worker runs via launchd every ten minutes while this Mac is awake and logged in. Install or update with `python3 scripts/price-alerts/install.py --cli /absolute/path/to/supabase` (the native CLI, beside supabase-go). The installer uses the existing Fuel Up APNs configuration and puts owner-only runtime files outside the checkout. The worker log contains only times and counts.
- The hosted Edge Function `fuel-price-alerts` and cron job `fuel-price-alert-delivery` are deployed. The scheduler only invokes the function if the private runner secret exists. To activate, first authorize the specific Apple push credential for this Supabase project. Then run `node scripts/price-alerts/enableHosted.mjs --enable-hosted` with the selected APNs configuration. This stores the signing key in project Edge secrets and an independent invocation secret in Vault. Project Edge secrets are shared with other functions in the project. Keep signing material out of Git and logs.
- A customer rollout requires the new client. Never populate watches from existing silent-sync devices, legacy push tokens, analytics locations or research consents.
- Inspect aggregate delivery counts and statuses in `fuel_app_private.price_alert_deliveries`. Apple acceptance confirms transport, not that an individual read the alert.

## Verification

The rollback SQL fixture in `tests/sql/nearbyPriceAlerts.sql` exercises consent, credential isolation, first observation, threshold, payment type, local alternatives, quiet hours, cooldown and removal. Use an isolated database or apply the migration and fixture together inside a rollback transaction on a database without existing watches. The fixture temporarily substitutes test quotes in the derived view; it never changes raw prices.

On November 4, a dedicated review simulator enrolled through the real app with 40 station IDs. A controlled, rolled-back earlier-price fixture fed the actual matcher and sender with the app terminated. Apple accepted the sandbox alert and SpringBoard published the bulletin to Notification Center. The in-app switch removed the watch; no customer device was used. Both the iOS simulator build and targeted application tests passed.
