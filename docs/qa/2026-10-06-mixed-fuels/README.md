# Mixed fuels and cluster browsing, October 6, 2026

## Behavior

- Home's “Also show me E85” combines the selected grade with E85 results, deduplicated by station identity. It no longer restricts gasoline results to stations that also offer E85.
- E85 stations show the selected-grade and E85 prices separately. Each price has its own reported timestamp and 24-hour expiration. Missing values remain an em dash; availability is retained without inventing a price.
- Additional E85-only quotes do not set the selected-grade comparison baseline or receive special cluster-parent priority. Glass tint behavior remains the existing recommendation/neutral treatment.
- Tapping a cluster hides other stations, fits the member coordinates without including the user's location, selects the existing parent, and limits the carousel to those members. Show all restores the complete search. Dense subsets can be tapped again to browse more closely.
- E85 and diesel chips reuse the native fuel-selection SVG assets. Gasoline-only chips have no pump icon. Regular, midgrade and premium artwork is white, silver and gold in both themes.
- Probe routing explicitly honors a native probe link even after a legacy probe session. No legacy thresholds or assertions were weakened.

## Validation

- Updated source builds successfully for the iOS simulator using Debug, current workspace, scheme FuelUp, and /tmp/FuelUpGlassSim. Physical installation and TestFlight distribution were not performed.
- 169 app/model/lifecycle tests pass; the new mixed-fuel cases are included in npm test. See unit-tests.tap.
- Both current native live probes pass: normal glass transitions (1,643 recorded frames, 113 transitions) and cluster tap/isolation/parent selection/Show all restoration. See native-probes.tap and cluster-browse.json. The animation test's maximum camera travel is not a claim that every frame meets the separate legacy two-point gate.
- Visual simulator checks cover regular/midgrade/premium artwork in light and dark themes, premium plus E85 labels, diesel icons, actual cluster isolation and preserved parent selection. Screenshots are attached. Live cache-only Tampa reads returned premium and E85 stations without duplicate IDs; these are provider-reported values, not verified pump prices.
- The separate required tests/clusterProbe.integration.test.cjs gate was attempted repeatedly and timed out without a completed token report. The retained legacy screen has merging globally disabled in the pre-existing configuration. A temporary probe-only enablement also timed out and was removed. Its test and strict success criteria remain unchanged; this legacy gate is unresolved, not passed. See legacy-probe.tap.
- One native rerun immediately after simulator installation missed its cold-launch link. Repeating with the app loaded passed both native probes without changing tests or deadlines.
