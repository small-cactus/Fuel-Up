# Yellow E85 cluster parents

October 6, 2026. Follow-up to 0919045 at the user's request.

Visible yellow E85 stations have first priority when choosing a cluster representative. Recommendation, comparable price, and station ID keep the order deterministic among peers. A yellow station with no current price still takes priority. Ordinary clusters retain their prior selection rules.

The renderer, overview fit, and station-focus solver carry the same E85 flag and comparison price, preventing the fitted geometry from assuming a different parent than the rendered map. Yellow material and station prices are unchanged.

Validation:
- Native geometry, camera-fit, and focus suites: 3 passed. Covers E85 versus the recommendation, unavailable E85 price, multiple yellow candidates, input reordering, distance bounds, and restoring ordinary ownership when disabled.
- Legacy cluster gate remains unresolved: timed out waiting for its report after 130 seconds. Its animation path was disabled before this change. No legacy gates were weakened or removed.
- Simulator and signed Release builds succeeded; signature verification passed. Installed in place on the paired iPhone 18 Pro Max, version 1.0.0 (24), preserving app data. Physical-device visual QA is not claimed.
- Final live native baseline and yellow-parent probes both passed (59 seconds). Baseline recorded 1,645 frames and 113 transitions, with a 248 ms longest transition. Yellow probe additionally checks that each yellow station's owner is yellow and that yellow cluster-count bubbles are rendered through the run.
- An initial live attempt could not run because Metro was disconnected. After restarting the development server and verifying the app loaded, both native probes passed.

## Price-card follow-up

The user clarified that E85 belongs next to 93 in the lower station price container, not inside map bubbles. The SwiftUI station card now presents labeled selected-grade and E85 prices side by side, with a vertical layout at larger text sizes. Bubbles retain the existing single-price layout. The extra grade is paired by station ID from independently freshness-filtered quotes; missing/stale values show an em dash. The expiry timer also watches the secondary quote timestamp.

`npm test`: 165 passed, including shared-station prices, E85-only inventory, and stale secondary quote suppression. Simulator inspection on iPhone 13 mini confirmed the two columns and unavailable-price state; the attached screenshot uses actual reported Wawa data, whose E85 price was unavailable. The debug warning overlays are simulator-only development warnings, not part of the Release card.
