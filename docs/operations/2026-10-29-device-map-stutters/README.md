# Physical iPhone map stutter capture — October 29, 2026

Fuel Up 1.0.0 build 38 was observed on an iPhone 18 Pro Max running iOS 27.0.1. The direct USB connection worked. Fuel Up was not running initially and was launched in place without a build, install, or data reset. The user was instructed to pan first, then reproduce the worst gestures.

## App log evidence

A FuelUp-filtered device syslog captured launch and subsequent manual interaction, approximately 10:31:28–10:33:23 America/New_York. `log-summary.json` contains only timestamps, durations, aggregate diagnostics, and a SHA-256 of the private raw log.

- 54 iOS HangTracer always-on reports; maximum 2.44 seconds.
- 50 reports at or after 10:32:00; maximum still 2.44 seconds. The stalls continued beyond startup.
- 271 Core Location diagnostics warning that a method can cause UI unresponsiveness if invoked on the main thread.
- Duplicate threshold-classification messages were excluded from hang counts.

These are hang reports, not average FPS measurements. There were no precise gesture phase markers, no matched before/after comparison, and instrumentation can add overhead. The warnings correlate with the capture but do not establish the source-level cause.

## Investigation lead

`DrivingResearchCollector.ready` synchronously calls `CLLocationManager.locationServicesEnabled()`. Several research event callbacks consult `ready`, including callbacks delivered through the main actor. `checkTrackingHealth` and `InstallationProfile` contain additional calls. These are candidates to inspect with call stacks; the logs alone do not prove which caller emitted each warning or that changing it will resolve map rendering stalls.

## Capture handling

The raw device log and system trace remain local because they may contain sensitive device, location, and network details. No raw capture is committed. No app behavior was changed by this capture task.

## Confirmed trace attribution and first repair

The saved Animation Hitches trace contains 91.137 seconds starting 10:31:55.234 EDT. Fuel Up app symbols were resolved with the exact archived build 38 dSYM UUID `9B47B3D9-2DF3-3695-B3F5-D3776DF2A887`.

Of 25,914 Fuel Up main-thread samples, 23,115 (89.20%) include `DrivingResearchCollector.refreshCounts`, and 22,969 (88.64%) include `DrivingResearchStore.events(pending:limit:)`. Gesture logging (`recordInteraction`) accounts for a large overlapping subset; upload completion callbacks also enter the same query. Map frame ticking appears in 770 samples (2.97%). Inclusive sample counts overlap and are not wall-clock durations.

The recent-events query orders all events by `recorded` with `LIMIT 12`. The previous composite indexes start with `uploaded` or `kind`, which do not serve this unfiltered ordering. The first repair adds an idempotent `events(recorded)` index for both existing and new stores. It preserves WAL/FULL durability, row contents, upload flags, and collection behavior. No map, glass, animation, or permission logic is changed in this first cycle.

`store-read-benchmark.md` records the real SQLite legacy-store regression and local synthetic benchmark. `trace-summary.json` retains app-only aggregates. The raw trace is local at `/private/tmp/fuelup-map-live-20261029-1430.trace`; app-filtered raw logs and XML exports use the same filename prefix. Instruments required explicit SIGINT after its automatic stop began, then saved successfully. Its closed, consumed 22 GB raw intermediate was removed during final save to prevent disk exhaustion; final trace export succeeded.

ESLint: zero errors, 672 existing warnings across 185 files. Existing research, interaction, permission, and quiet-mode tests passed. Device before/after validation remains pending at this checkpoint.
