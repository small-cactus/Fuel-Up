# TestFlight 1.0.0 (31): persistent mileage collection

The previous backtest reconstructed distance from GPS records sampled every five seconds while driving (30 seconds in monitoring mode), rejected delayed samples for live-position freshness, and excluded long gaps. This build adds a separate native mileage ledger that processes every delivered sample before event sampling. The existing live station detector keeps its freshness rules.

## Behavior

- Valid delayed samples up to 24 hours old can contribute to historical distance, only after the current collection boundary, in chronological order. Duplicate/out-of-order samples never add distance twice.
- Reject invalid coordinates, simulated fixes, accuracy worse than 40 meters, future timestamps, and segments faster than 70 meters/second. Stationary drift and small movements below an accuracy-based noise floor do not inflate the total.
- Segments over 120 seconds apart are gaps, not guessed driving distance. `unmeasuredGapSeconds` is not a claim that the user drove during the gap.
- Atomically persist the cumulative counter and last anchor per callback batch, using iOS file protection until first authentication. Preserve counters across process restarts. Pauses/permission outages break segment continuity, and deletion removes the ledger. Corrupt storage surfaces an error instead of silently resetting mileage.
- Attach `mileageAtReceipt` to research events and write periodic diagnostic checkpoints through the existing durable outbox. Fields include version, epoch, captured meters, covered seconds, gap seconds/count, accepted/delayed/rejected/duplicate sample counts and collection boundaries. This is receipt-time state: `lastSampleAt` identifies its latest GPS sample; do not backdate the whole batch total to each older event's timestamp.
- A valid driving-speed fix can engage driving mode at 2.5 meters/second. Recent drive evidence holds for up to ten minutes, with sustained stationary motion ending the hold after five minutes. Stale/future motion callbacks cannot renew the hold. Existing consent and Always/Precise/Motion permissions remain required.

No automatic fueling alerts, station preference predictor, time-based fueling forecast, or tank-size assumptions are enabled. No backend schema change is required: metadata uses the existing diagnostic/payload contract. No research history is rewritten. Previously missed travel cannot be recovered unless actual delayed samples exist.

## Validation

Native compiled tests cover all-sample corner distance, delayed batches isolated from live freshness, restart/deduplication, GPS gaps and teleports, stationary drift, pause boundaries, invalid samples, driving-mode hold, deletion, and corrupt storage. Server validator round-trips the mileage metadata unchanged. Related collection, notification permissions, silent push, cross-check, step-history and timing-history tests pass; logs are in `build-31/`.

These tests do not establish road-measured mileage accuracy, battery impact, or guarantee iOS background continuity. Compare future consented trips against a vehicle trip meter before claiming an accuracy percentage.

## Distribution

Build 31 reserved and verified in EAS. Archive/upload and tester availability verification pending.
