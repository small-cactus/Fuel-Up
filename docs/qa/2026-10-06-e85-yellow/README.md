# Also show E85: focused follow-up

October 6, 2026. Based on the reverted baseline 9ec1d08.

- Settings/onboarding now say **Also show E85**.
- The selected grade stays visible, with additional E85 stations merged by station ID. The selected grade price remains on shared stations; E85-only additions retain their E85 price and card label.
- E85 availability gives visible station bubbles a native yellow glass tint. Reported availability survives missing/stale E85 prices; unavailable prices are not invented.
- Extra ethanol prices do not compete with gasoline prices for the primary recommendation. The optional request does not delay primary results; its failure preserves primary results and any usable E85 cache.
- No special E85 cluster-parent priority, cluster isolation navigation, dual-price labels, or grade/icon redesign from the rejected change was restored.
- Yellow materials use separate native glass containers so they cannot tint neighboring green/neutral bubbles. Existing count bubbles update when the source/toggle changes.

## Checks

- `npm test`: 165 passed.
- Signed Release and simulator builds succeeded.
- Simulator visual inspection: light and dark maps, yellow E85 availability, neutral ordinary stations, green gasoline recommendation, updated toggle text. Screenshots alongside this note.
- Required legacy `tests/clusterProbe.integration.test.cjs`: failed after 129 seconds waiting for its exported report. Its route is the retained LegacyHomeScreen, whose `ENABLE_CLUSTER_MERGE_TRANSITIONS` was already false at baseline 9ec1d08. This test/threshold/export path was not weakened or removed; this is an unresolved legacy gate, not a pass.
- Signed Release installed over the existing app on the paired iPhone 18 Pro Max, verified bundle `com.anthonyh.fuelup`, version 1.0.0 (24). App data retained; no physical-device launch or visual QA claimed.
- Final current-map native gates: both passed (`Swift Glass Lab renders…` and `E85 glass stays…`, 58 seconds total). Baseline: 1,650 rendered frames, 113 transitions, longest transition 247 ms. E85 test verified exact yellow material on designated stations through split/merge, native container isolation, and preserved green/neutral material on the others.
