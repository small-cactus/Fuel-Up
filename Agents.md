# Core Mission

The primary objectives of this app are fiercely prioritized as follows:
1. **Priority #1: Native, Beautiful, and Simple Design** - The user experience must be as simple, beautiful, and least confusing as humanly possible, favoring native iOS UI and interactions above all else.
2. **Priority #2: Fastest, Cheapest Gas** - The app must aggressively find and present the closest, cheapest gas price to the user's current location as fast as possible.

---

# Design Guidelines

1. **Native iOS First**: Always prioritize implementing the most native closest UI and actions. Before building anything custom, you MUST exhaustively search for a native approach or an Apple native iOS ported version (e.g., Apple Maps over third-party maps). Never use a third-party version if an Apple native public version exists.

2. **Liquid Glass Effect**: All UI components must use the liquid glass effect where applicable. Documentation is available at `LiquidGlassDocs.md` and `LiquidGlassTabsDocs.md`. NEVER reinvent the glass effect yourself; use the library and docs to implement it.

3. **Fallback to Simple Modernity**: If a native approach or Liquid Glass Effect is strictly impossible to implement, do NOT attempt to mimic it. Instead, build a simple, clean, and modern version of the component. 

4. **Universal Responsiveness**: Everything must be specifically responsive and adapt flawlessly on every single iPhone model by default.

5. **Theme Support**: All implementations must support our dark and light themes by default out of the box.

6. **Code Quality and Maintainability**: 
   - Support a forward-thinking code style that allows for integrations easily.
   - Code should be written to be easy to maintain and edit, even if it results in longer or more verbose code.
   - *Exception*: If the code length would become huge or unmanageable, then optimize for whatever approach is the most efficient at the time.

7. **No Monofiles**: Never use monofiles. All components should be ported from separate files and linked in screens.
   - *Exceptions*: You may include a component in the current file ONLY if it is NEVER to be repeated elsewhere, or if it is so simple that creating a separate file would be more time-consuming than implementing it inline.

8. **Design Rules**:
   - **Never put borders on liquid glass components**.

---

# Cluster Probe Test Spec

The cluster animation has a live simulator integration test. This is the required smoothness gate for cluster split/merge animation work.

## How To Run It

1. Start the Expo dev server for the current workspace.
2. Boot an iOS simulator and make sure the app `com.anthonyh.fuelup` is installed.
3. Open the app at least once and allow location access.
4. Run the probe-only test with `node --test ./tests/clusterProbe.integration.test.cjs`.
5. Run the full suite with `npm test` when you need the normal unit tests plus the live probe gate.

The test launches the booted simulator app, waits for it to load, triggers the in-app cluster probe deep link, waits for the app to export the probe report to the app container, and then validates the exported metrics.

## What The Test Does

The live probe uses the real Apple map, not fake math.

It currently:
1. Waits for the map to load.
2. Re-centers on the current location before recording.
3. Starts recording cluster debug frames.
4. Runs the automated stepped zoom sequence.
5. Stops recording.
6. Restores the prior map view after recording.
7. Exports a JSON report to the simulator app container at `Documents/cluster-debug-probe.json`.

The integration runner reads that JSON file and fails if the probe did not complete or if the smoothness metric is over the threshold.

## Do Not Change

Do not weaken the test just to make it pass.

Specifically, do not:
1. Raise the `maxFrameDelta` threshold above `2`.
2. Remove the live simulator probe test from `./tests/clusterProbe.integration.test.cjs`.
3. Replace the live map probe with a fake math-only assertion.
4. Disable the app-container JSON export that the test reads.
5. Change the test to ignore failed, blocked, or timed-out probe runs.
6. Hide regressions by only changing the test timing, token handling, or polling behavior unless the probe is genuinely not being detected.

If the test fails, fix the animation or the real probe path. Do not redefine success downward.

## Smoothness Metric

Smoothness is measured from the exported probe JSON, not from visual guesswork alone.

Primary field:
1. `maxFrameDelta`

This value is the maximum per-frame on-screen movement, in pixels/points, observed across the tracked overlay layers during the recorded probe.

Pass condition:
1. `maxFrameDelta <= 2`

Interpretation:
1. Lower is smoother.
2. Values above `2` mean at least one recorded frame jumped too far on screen.
3. The integration test enforces only the hard gate (`<= 2`), but the exported report also includes supporting context such as `sampleCount`, `transitionCount`, `timedOutStages`, `steps`, and the full `logText`.

When debugging a failure:
1. Read `Documents/cluster-debug-probe.json` from the simulator app container.
2. Check `status`, `message`, and `timedOutStages` first to confirm the probe actually ran.
3. Compare `maxFrameDelta` against the `2` threshold.
4. Use `logText` and the embedded `[ClusterDebug Recording]` section to see which layer jumped and during which split/merge phase.
5. Treat the test result as the source of truth for whether the animation is smooth enough to ship.
