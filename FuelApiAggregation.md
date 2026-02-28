# Fuel API Aggregation

This document explains how the app collects, normalizes, ranks, caches, and debugs gas price data.

## Goal

The app tries to return the cheapest valid station-level gas price for the active location.

The active location can come from:

- Device GPS on the Home screen
- A manual latitude/longitude override set in Settings

The app does not use regional averages as the main result. If no station-level provider returns a usable price, Home fails with an explicit error instead of showing an estimate.

## Provider Types

The app currently supports two provider classes:

- Station-level providers: these can win the main result.
- Area-level providers: these are supplemental only and appear in debug output, but they do not replace a missing station price.

### Station-level providers

- TomTom Search + Fuel Prices
- Barchart `getFuelPrices`
- Google Places Nearby Search with `fuelOptions`

### Area-level providers

- Cardog
- BLS
- EIA
- FRED

## Aggregation Flow

The core fetch pipeline lives in [src/services/fuel/index.js](/Users/anthonyh/Desktop/Fuel Up/src/services/fuel/index.js).

The main flow is:

1. Resolve the active location.
2. Build a cache key from `fuelType`, rounded coordinates, and search radius.
3. Load any cached snapshot first when the refresh allows cached reads.
4. Request all enabled providers in parallel.
5. Normalize all provider responses into one shared quote shape.
6. Select the cheapest valid station-level quote.
7. Save the winning snapshot to cache.
8. Publish provider debug data for Settings.

If no station-level quote is returned, the request fails and Home shows an error message.

## Normalized Quote Shape

Every provider is normalized into the same internal shape before ranking:

- `providerId`
- `providerTier`
- `stationId`
- `stationName`
- `address`
- `latitude`
- `longitude`
- `fuelType`
- `price`
- `currency`
- `priceUnit`
- `distanceMiles`
- `fetchedAt`
- `updatedAt`
- `isEstimated`
- `sourceLabel`

This normalization logic lives in [src/services/fuel/core.js](/Users/anthonyh/Desktop/Fuel Up/src/services/fuel/core.js).

## Provider Details

### TomTom

TomTom uses a 3-step flow:

1. Category search for nearby petrol stations
2. Place lookup by `entityId`
3. Fuel price lookup by `fuelPrice.id`

Important implementation detail:

- The app uses TomTom category `7311` and the `petrol station` query to avoid irrelevant POIs.

Known limitation:

- If the TomTom key can search but does not have Fuel Prices entitlement, the search step still returns stations, but no price can be returned.

### Barchart

Barchart uses one request and returns station candidates with prices when a valid key is present.

The app filters the result set to the active fuel type and picks the cheapest valid station from the payload.

### Google Places

Google uses `places:searchNearby` with:

- `includedTypes: ["gas_station"]`
- `rankPreference: "DISTANCE"`
- `places.fuelOptions` in the field mask

If `fuelOptions.fuelPrices` is present, the app normalizes it into a station quote and can use it as the main result.

### Cardog

Cardog is currently treated as an area-level source.

It is fetched and shown in debug data, but it does not replace a missing station price on Home.

### BLS, EIA, FRED

These are public area-level sources.

They are normalized for supplemental diagnostics and future comparison, but they do not drive the main price card.

## Ranking Rules

Ranking happens after normalization.

The selection rule is intentionally strict:

- Only non-estimated station-level quotes can win.
- If multiple station-level quotes exist, the cheapest price wins.
- If prices tie, the closer station wins.
- If no station-level quote exists, the result is `null`.

This behavior is implemented in `selectPreferredQuote()` in [src/services/fuel/core.js](/Users/anthonyh/Desktop/Fuel Up/src/services/fuel/core.js).

## Cache Behavior

The app uses two cache layers:

- In-memory cache for fast reuse during the current session
- AsyncStorage persistence across app launches

Cache keys are built from:

- Fuel type
- Radius in miles
- Rounded latitude
- Rounded longitude

This prevents minor coordinate jitter from constantly creating new cache entries.

Current TTLs:

- Station cache: 10 minutes
- Area cache: 60 minutes

The cache implementation lives in [src/services/fuel/cacheStore.js](/Users/anthonyh/Desktop/Fuel Up/src/services/fuel/cacheStore.js).

## Home Screen Refresh Rules

The Home screen logic lives in [app/(tabs)/index.js](/Users/anthonyh/Desktop/Fuel Up/app/(tabs)/index.js).

Prices refresh in these cases:

- On initial Home load
- Whenever the Home tab becomes active again
- When the top-left Reload button is tapped

Refresh behavior:

- Focus-based refreshes read cached data first, then fetch live
- Manual Reload skips the cache-first display and forces a live refresh path

If the fetch fails:

- The visible quote is cleared
- The user sees a specific failure message
- Debug state is still captured

## Failure Messaging

The app distinguishes these failure categories:

- Invalid manual coordinates
- No station providers configured
- Location returned no nearby stations
- Providers found stations but returned no usable price

The message selection logic lives in `getFuelFailureMessage()` in [src/services/fuel/core.js](/Users/anthonyh/Desktop/Fuel Up/src/services/fuel/core.js).

## Debug Output

Settings includes a Fuel Debug block that shows:

- The active coordinates used for requests
- Whether the location source is device or manual
- The latest request input payload
- Per-provider request URLs
- Response payloads
- HTTP errors
- Provider-level failure categories

Secrets are redacted from URLs before they are stored in debug state.

Shared debug state lives in [src/AppStateContext.js](/Users/anthonyh/Desktop/Fuel Up/src/AppStateContext.js).

## Manual Location Override

Settings includes a manual latitude/longitude override.

When set:

- Home uses those exact coordinates instead of device GPS
- The map animates to the manual location
- Debug output marks the source as `manual`

When cleared:

- Home returns to device GPS

## Environment Variables

The app reads provider credentials from Expo public env vars:

- `EXPO_PUBLIC_TOMTOM_API_KEY`
- `EXPO_PUBLIC_BARCHART_API_KEY`
- `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`
- `EXPO_PUBLIC_CARDOG_API_KEY`
- `EXPO_PUBLIC_EIA_API_KEY`
- `EXPO_PUBLIC_FRED_API_KEY`

These are read in [src/services/fuel/config.js](/Users/anthonyh/Desktop/Fuel Up/src/services/fuel/config.js).

If env vars change while the app is running, restart the Expo dev server so the new values are loaded.

## Test Coverage

Contract tests for the aggregation layer live in [tests/fuelDataContracts.test.cjs](/Users/anthonyh/Desktop/Fuel Up/tests/fuelDataContracts.test.cjs).

They currently verify:

- TomTom request shape
- Barchart request shape
- Google request shape
- Provider normalization
- Station-only selection rules
- Failure message classification
- Cache key bucketing and TTL logic

## Practical Notes

- A provider returning station search results does not guarantee it can return a station price.
- TomTom commonly fails at the Fuel Prices step if the key lacks entitlement, even when search works.
- Google currently provides the strongest live station-price result when `fuelOptions` is available for a nearby station.
- Area-level providers are useful for diagnostics, validation, and future feature work, but they are intentionally not used as the main fallback result.
