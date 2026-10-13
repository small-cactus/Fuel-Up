# Build 29 background motion crash

Read the October 13 13:15 EDT submitted TestFlight crash feedback and downloaded
its diagnostic archive. The report is for build 1.0.0 (29), iPhone 15 Pro Max,
iOS 26.3.1, while the process was in a non-UI role. The saved build-29 app dSYM
UUID matches the reported executable exactly.

Symbolication places the crashing app frame at the dictionary conversion for
`sendEvent("onActivityUpdate", payload)` in `FuelUpDrivingActivityModule.swift`
(old line 181). The allocator trapped while allocating Swift dictionary storage.
The raw report is private outside the repository; only the relevant diagnostic
metadata, hash and symbolicated app frames are retained here.

The bridge used a concurrent OperationQueue for Core Motion callbacks while
Expo commands ran on their default queue and authorization polling used main.
Live updates and history callbacks read/replaced the same `lastActivityPayload`
without synchronization. The new native regression compiles the production
motion fields, function registrations and helper methods with fake framework
boundaries. Thread Sanitizer reports concurrent writes to that cached dictionary
in the original source. This reproduces a concrete race consistent with the
submitted allocator crash, rather than claiming the identical hardware SIGTRAP
was reproduced.

## Fix

Route all motion bridge commands, Core Motion callbacks and authorization polling
through the main queue. Core Motion queries remain asynchronous; the callbacks
only convert small motion payloads and emit events. Add a stream generation so
queued callbacks from a stopped/replaced subscription cannot emit into a new one.
No permissions, research enrollment, upload formats or raw records are changed.

## Verification

- Original source: fails the new regression with a Thread Sanitizer data race.
- Fixed source: 1,000 overlapping live/history requests, cached fallback reads,
  repeated starts, stop/restart stale callbacks and authorization completion pass
  under Thread Sanitizer.
- Existing JS motion bridge, history, step-history and permission tests: 5 pass.
- Regression command: `node --test tests/drivingActivityConcurrency.test.cjs`.
- Set `FUELUP_MOTION_TEST_SOURCE` to an exported original source file to reproduce
  the failing version without editing the checkout.

The regression tests use synthetic callbacks, not physical Core Motion or a
simulator claim. Signed Release build and deep signature verification passed (118 seconds).
TestFlight build 30 distribution is being prepared; this checkpoint does not
claim tester availability.
