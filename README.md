<p align="center">
  <img src="./assets/fuelup-icon.png" alt="Fuel Up app icon" width="72" />
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./assets/FuelUp-text-logo-dark.png" />
    <source media="(prefers-color-scheme: light)" srcset="./assets/FuelUp-text-logo-light.png" />
    <img src="./assets/FuelUp-text-logo-dark.png" alt="Fuel Up" width="240" />
  </picture>
</p>

<p align="center">
  Fuel Up is an iOS-first fuel discovery app built with Expo and React Native.
  It combines a map-led home screen, live and historical price aggregation, trend views, predictive fueling onboarding, and native iOS surfaces such as widgets and Live Activities.
</p>

<p align="center">
  <img alt="Expo 55" src="https://img.shields.io/badge/Expo-55-111111?logo=expo&logoColor=white" />
  <img alt="React Native 0.83" src="https://img.shields.io/badge/React%20Native-0.83-20232A?logo=react&logoColor=61DAFB" />
  <img alt="Expo Router" src="https://img.shields.io/badge/Routing-Expo%20Router-0A84FF" />
  <img alt="Supabase" src="https://img.shields.io/badge/Data-Supabase-1E7F5C?logo=supabase&logoColor=white" />
  <img alt="iOS First" src="https://img.shields.io/badge/Platform-iOS%20First-3A3A3C?logo=apple&logoColor=white" />
</p>

<p align="center">
  <img src="./assets/predictive-fueling.png" alt="Fuel Up predictive fueling artwork" width="100%" />
</p>

## Quick Start

### Prerequisites

- Node.js 20+
- npm
- Xcode and iOS Simulator

### Install dependencies

```bash
npm install
```

### Launch the app in the iOS simulator

```bash
npm run ios:sim
```

### Start Metro only

```bash
npm start
```

## Environment

Fuel Up boots without committed credentials. Optional integrations are loaded from environment variables at runtime.

```bash
cp .env.example .env
```

Common variables:

| Variable | Purpose |
| --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL for remote persistence and trend history |
| `EXPO_PUBLIC_SUPABASE_KEY` | Supabase publishable key |
| `EXPO_PUBLIC_PRIMARY_STATION_URL` | Dedicated station feed endpoint |
| `EXPO_PUBLIC_SECONDARY_STATION_URL` | Extended station feed endpoint |
| `EXPO_PUBLIC_TOMTOM_API_KEY` | TomTom place and fuel price lookups |
| `EXPO_PUBLIC_BARCHART_API_KEY` | Barchart station price lookups |
| `EXPO_PUBLIC_CARDOG_API_KEY` | Cardog regional pricing lookups |
| `EXPO_PUBLIC_EIA_API_KEY` | EIA market data |
| `EXPO_PUBLIC_FRED_API_KEY` | FRED market data |

## What The App Contains

| Area | What it does |
| --- | --- |
| Home map | Finds nearby stations, ranks prices, clusters markers, and keeps the bottom-card selection synchronized with the map |
| Trends | Rebuilds historical station price rows into charts, a leaderboard, and regional summaries |
| Settings | Stores radius, preferred fuel grade, theme, onboarding reset, cache reset, and predictive location controls |
| Dev tools | Exposes request counters, cache reset helpers, local notification triggers, and Live Activity testing controls |
| Onboarding | Walks through the product narrative, predictive fueling demo, permissions, radius, and fuel-grade preferences |

## Architecture

### Routing and app shell

- `app/_layout.js` is the root gate. It wires the global providers, decides whether onboarding should appear, mounts the tab stack, and handles cluster-probe automation entry points.
- `app/(tabs)/_layout.js` defines the native tab bar and the four primary tabs: Home, Trends, Settings, and Dev.
- `app/prices-sheet.js` is presented as a form sheet from the root stack.

### Shared state

- `src/AppStateContext.js` owns volatile app-wide state such as manual location overrides, resolved search context, cache reset tokens, cluster probe requests, and the progressive root reveal.
- `src/PreferencesContext.js` persists user-facing preferences in `AsyncStorage`, including search radius, preferred fuel grade, provider mode, and onboarding completion.
- `src/ThemeContext.js` centralizes light, dark, and system appearance handling.

### Fuel data pipeline

- `src/services/fuel/index.js` is the aggregation entry point. It resolves the active provider mode, requests station and regional data, validates stale prices, deduplicates overlapping results, caches snapshots, and produces the ranked station list used by the map and sheet.
- `src/services/fuel/core.js` contains provider-specific request builders, response normalizers, cache-key logic, and quote-selection helpers.
- `src/services/fuel/priceValidation.js` applies validation and prediction rules before a quote is displayed.
- `src/services/fuel/trends.js`, `trendProjection.js`, and `trendLeaderboard.js` rebuild Supabase history into the Trends screen’s charts and leaderboard.

### Predictive fueling experience

- `src/screens/OnboardingScreen.js` drives the full onboarding flow.
- `src/screens/onboarding/predictive/` contains the predictive fueling map scene, route simulation, camera choreography, and narrative UI shown during onboarding.
- `src/screens/onboarding/predictive/simulationMath.cjs` and `routeDiagnostics.cjs` are the core math and validation utilities behind the predictive demo.

### Native and platform integrations

- `src/lib/notifications.js` handles push notification registration, token persistence, and Live Activity helpers.
- `src/lib/PriceDropActivity.tsx` defines the widget / activity UI surface.
- `modules/fuel-up-map-kit-routing/` contains the local Expo module used for native MapKit routing support.
- `plugins/withProgressiveBlurNativeBuild.js` and the patch scripts in `scripts/` keep the native build path aligned with the project’s UI and widget setup.

## Repository Layout

```text
app/                                Expo Router screens and tab entry points
assets/                             App icon, logos, splash art, predictive visuals
modules/fuel-up-map-kit-routing/    Local Expo native module
plugins/                            Expo config plugins
scripts/                            Local tooling, patching, push, and diagnostics helpers
src/components/                     Shared UI components and overlays
src/lib/                            State, preferences, location, notifications, utilities
src/screens/                        Onboarding and predictive fueling screens
src/services/fuel/                  Aggregation, validation, caching, trends, projections
tests/                              Unit tests and simulator-driven quality checks
```

## Verification

These commands were used to validate the current repository state:

```bash
npm test
npx expo config --json
npm run ios:sim
gitleaks dir . --no-banner
```

## Scripts

| Command | Description |
| --- | --- |
| `npm start` | Starts the Expo dev server |
| `npm run ios:sim` | Opens the app in the iOS simulator through Expo |
| `npm run ios` | Runs the configured physical-device workflow |
| `npm run android` | Runs the Android build path |
| `npm run web` | Starts the web target |
| `npm test` | Runs the default unit and logic test suite |
| `npm run test:cluster` | Runs cluster animation tests plus the simulator probe integration |
| `npm run push:send` | Sends a push notification using local APNs credentials |

## Bundle IDs

- iOS: `com.anthonyh.fuelup`
- Android: `com.anthonyh.fuelup`
