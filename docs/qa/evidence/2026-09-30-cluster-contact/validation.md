# Cluster contact verification — September 30, 2026

Implementation commit: `0f8701a` on `master`.

The native contact fixture covers horizontal prices 110pt apart, prices 37pt apart
vertically brought into contact by an approximately 8pt location-dot nudge, and a
separate price near another cluster's count. Both zoom returns combine the intended
pairs. The independent count neighbor stays in a separate native glass effect.
See [recorded checkpoint](combined.png) and [native frames](contact-summary.json).

Validation:

- Six Swift model suites passed (geometry, glass grouping, location clearance,
  camera fit, focus, and market identity).
- 138 normal unit tests passed.
- Native simulator regression run: 15 of 16 passed on the full run. The emphasis
  check recorded a 7.17pt size step while the Release build was running. Its isolated
  rerun after compilation passed unchanged: 29 intermediate sizes, maximum 3.68pt
  step. No timing limits or motion thresholds were relaxed.
- The contact regression passed again on the final binary and was recorded.
- Main native transition gate: 1,646 frames, 113 transitions, 28 live connection
  frames during committed merges, no bridges between independent logical parents.
  Longest handoff transition was 247ms; maximum rebound was 17.99pt.
- Connected +1 traveled 17.01pt with 149 intact intermediate frames before split.
- All six overview returns preserved owners, native glass connections, and geometry.
- Rapid probe: 50 zoom cycles / 100 camera requests, 2,220 frames, 119 splits,
  173 merges. Native tint remained assigned exclusively to the current global
  cheapest ID, including a mid-run winner change. This is native tint telemetry,
  not a claim that every previously reported physical-phone color artifact was
  reproduced or independently resolved.
- Simulator Debug and signed device Release builds succeeded.
- Release installed on the connected iPhone 18 Pro Max (`com.anthonyh.fuelup`).
  The physical app was not foregrounded or visually inspected.

Remaining gate limitation:

The required legacy Home probe (`tests/clusterProbe.integration.test.cjs`) was run
unchanged and failed after 129.2s waiting for token `probe-test-1790784127781`.
Home's `ENABLE_CLUSTER_MERGE_TRANSITIONS` remains false. This task does not claim a
passing legacy Home gate or change that separate implementation.

The final recording is local and Git-ignored:
[contact zoom recording](/Users/anthonyh/Desktop/Fuel%20Up/.argent/recordings/screen-recording-0EE3DFFD-087C-483C-A651-C55C59A719A3-1790784293939.mp4).
The committed image and JSON retain portable evidence without adding video history.
