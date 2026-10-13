# Mileage-only fill forecasting

The requested model now uses only accumulated captured driving distance and known confirmed fuel purchases. This supersedes route-and-clock readiness for the current experiment. This is an offline research implementation, not a shipped notification policy.

## Rule

1. The first confirmed fill establishes a distance anchor.
2. The second confirmed fill provides the first observed fill-to-fill mileage interval.
3. Forecast the next fill at that many miles after the most recent confirmed fill. Each accumulated mile reduces predicted miles remaining by one.
4. As more confirmed fills become known, use the median of the latest three completed positive-distance intervals. Also compare simply repeating the immediately previous interval.
5. Replay one warning per confirmed-fill anchor when predicted miles remaining reaches 5, 10, or 20 miles. Compare learning after one, two, or three completed intervals.

No elapsed-time, time-of-day, route, station preference, app usage, or slowing-down signals affect this forecast. Timestamps still order evidence and reject implausible GPS segments; existing travel accounting uses speed only to identify driving segments. The replay runs on newly accumulated distance, without clock cooldowns or daily alert caps. A missing fuel confirmation does not silently reset the counter. Already-overdue mileage can trigger once after the next distance increment.

## Frozen snapshot results

Only one account has repeated confirmed fuel purchases: seven purchases and six completed intervals. Another account has one confirmed purchase and cannot yet learn a mileage interval. These are the existing October 13 exports, not a new live data pull.

Captured miles between this tester's confirmed purchases:

**119.5, 214.9, 125.2, 115.4, 150.2, 119.3.**

Each row below is a forward prediction, frozen when the preceding fill became known. The target fill is never included in training.

| Completed prior intervals | Last-interval forecast | Rolling-median forecast | Next observed interval |
|---:|---:|---:|---:|
| 1 | 119.5 | 119.5 | 214.9 |
| 2 | 214.9 | 167.2 | 125.2 |
| 3 | 125.2 | 125.2 | 115.4 |
| 4 | 115.4 | 125.2 | 150.2 |
| 5 | 150.2 | 125.2 | 119.3 |

All values are captured miles. The latest three rolling-median forecasts were off by +9.8, -25.0, and +5.9 miles (forecast minus observed interval). More personal history helps here but does not eliminate error.

The rolling-median policy starting after one interval, with a warning at **10 predicted miles remaining**, generated four warnings. The next confirmed fills were actually **105.3, 0.15, 35.0, and 4.1 captured miles away**. The remaining fill among the five forecastable future purchases occurred before the warning threshold was reached.

For an explicitly defined distance evaluation window of (0, 20] captured miles, two warnings were inside and two outside. This is not a claim of 50% imminent-notification precision: the endpoint and unit are distance, tracking is incomplete, and nearby unconfirmed purchases are not exhaustive negative evidence. The 0.15-mile warning also provides very little advance distance.

Waiting for three completed intervals produced three warnings at the same 10-mile lead, with two inside the evaluation window and one outside. A zero-alert cold start has undefined precision. All nine predeclared minimum-history/lead combinations, including failures, are preserved in `results.json`.

## What this supports

A simple, personal miles-remaining estimate is feasible after two confirmed fills. Mileage alone in this snapshot does **not** establish an accurate narrow fill window or meet the user's zero-false-alert objective. Neither repeating the first/latest interval nor updating the median solves the observed variability. No live alerts were enabled.

These distances sum validated GPS driving segments; gaps longer than 120 seconds are not bridged. Earlier coverage analysis found substantial tracking gaps, so captured miles are not complete actual mileage. Confirmation means a fuel purchase, not a verified full tank. We have no purchased gallons, odometer readings, fuel-level measurements, or verified full-tank labels, so this cannot measure tank capacity. No time-derived fuel consumption or guessed vehicle defaults are used to fill those gaps.

## Reproduce

Run `python3 scripts/driving-research/backtestMileageOnly.py PRIVATE_DIRECTORY OUTPUT_DIRECTORY`, where PRIVATE_DIRECTORY contains the protected `research.json` export. No station or usage export is read. Output contains only anonymous distance aggregates; input hashes and source hashes are recorded. Raw events, identities, coordinates and exact visit timestamps remain outside Git.

Run `python3 tests/mileageReadiness.test.py` for mileage-specific regression checks. `validation.txt` records the complete related offline test suite. No app files changed, so no app build or simulator test is claimed or required for this experiment.
