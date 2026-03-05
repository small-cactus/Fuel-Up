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

The cluster animation has a live iOS simulator integration test. This is the required quality gate for cluster split/merge behavior.

## How To Run It

1. Start the Expo dev server for the current workspace.
2. Boot an iOS simulator and make sure the app `com.anthonyh.fuelup` is installed.
3. Open the app at least once and allow location access.
4. Run the probe-only test with `node --test ./tests/clusterProbe.integration.test.cjs`.
5. Run the full suite with `npm test` when you need the normal unit tests plus the live probe gate.

The integration runner reloads the app, launches the in-app probe using deep link automation, waits for report export, then validates strict animation gates.

## What The Test Does

The probe runs on the real Apple map and captures live rendered animation behavior.

Execution flow:
1. Reload the app before probe start (terminate + relaunch).
2. Wait for load and trigger `fuelup:///?clusterProbe=1&clusterProbeToken=<token>`.
3. Build a probe plan from the current watched cluster and map region.
4. Center to the probe start region and begin frame recording.
5. Run stepped zoom-in and stepped zoom-out sequences.
6. Run one-shot zoom-in and one-shot zoom-out sequences.
7. Stop recording and restore the original map region.
8. Export probe artifact JSON to the app container at `Documents/cluster-debug-probe.json`.

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

## How Metrics Are Captured

Numbers are captured from the live render path and exported as structured JSON.

Capture sources:
1. Per-frame render samples emitted from the animated cluster overlay (UI-thread + JS-thread instrumentation).
2. Transition events emitted when split/merge runtime phases and bridge/carry state changes occur.
3. Probe run metadata (`status`, `message`, `timedOutStages`, plan, token trigger, mode coverage).
4. Map reset invariants captured at probe start/end (cluster signature and station-on-screen geometry snapshot).
5. Probe log text that includes a recording timeline and summarized motion context.

Artifact location:
1. Simulator app container: `Documents/cluster-debug-probe.json`.
2. Integration runner reads this file and computes strict telemetry summaries and gates.

## What The Test Measures

The test computes strict, multi-axis diagnostics from recorded samples and transitions.

Primary measurement families:
1. Frame smoothness: per-frame movement deltas (`maxFrameDelta`, percentiles, maxima).
2. Visible continuity: visible-layer frame deltas and jump detection at activation/stage switches.
3. Container tracking: logical container path, visible container path, and logical-vs-visible offset delta over time.
4. Timing/pacing: animated frame-step durations and very-long-step detection.
5. Idle-map movement duration: total continuous motion time while map is otherwise idle.
6. Disconnect handoff integrity: +N-to-price handoff checks for position, size, and content continuity.
7. Motion and state coverage: layer visibility/travel coverage, runtime phase coverage, transition-type coverage, probe mode coverage (stepped and one-shot), and map-motion state coverage.
8. Reset invariants: start/end map-state consistency for cluster signature, station count, pair count, and pair-distance geometry.
9. Deep telemetry export: numeric field series summaries, per-layer kinematics, layer-pair distance traces, top jump frames/events.

## Goal Of The Outputs

The outputs are meant to represent real, user-visible animation quality and correctness on device.

The goal is to prove:
1. Movement is smooth frame-to-frame, without pops or discontinuous jumps.
2. Logical animation state and visible on-screen position remain aligned.
3. Split/merge transitions preserve identity and visual continuity across layer handoffs.
4. Movement pacing is fast enough to finish promptly while still visually smooth.
5. Probe coverage is broad enough to catch regressions across stepped zoom and one-shot zoom scenarios.
6. After probe reset, map-visible station geometry is consistent with where it started.

---

# Cluster Transition Contract (User-Defined)

The split/merge behavior must follow this exact model:

1. Glass containers in the same parent container can merge with a morphing effect when they are touching.
2. The parent container must encapsulate the full range of pills that can merge.
3. During connection/merge:
   - Instantly replace the existing outside-parent price container with a parent-contained duplicate that is 1:1 in style/position.
   - Animate that duplicate into a `+1` capsule moving toward the main cluster shown price.
   - For more than one extra price, convert to `+n`, move toward existing `+1`, assume exact same position/style, then disappear while existing `+1` becomes `+2`.
4. During disconnection/zoom-in:
   - Parent container remains large enough to contain existing outside-parent price locations.
   - Parent container stays pinned/scaled to the map.
   - Instantly duplicate `+n` exactly where it is (same text/container/position), then move duplicates inside parent bounds toward their outside-parent target positions using quick eased motion.
   - When aligned, transition to exact text/styles of the outside-parent price containers, then instantly remove the parent-contained duplicates so there is zero pixel delta at handoff.
