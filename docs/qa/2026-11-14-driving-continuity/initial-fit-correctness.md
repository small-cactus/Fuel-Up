# Initial camera fit: vertical binding constraint

The first live native-suite run failed the assertion that at least one horizontal edge must be within 1 point of its safe inset. The exact-test rerun reproduced that failure and exported `/tmp/fuelup-movement-fit.json`, token `fit-1794651673763`.

The report contains 120 completed, non-animating frames, six represented stations per frame, and zero transition events. Its safe fit rectangle is x=17, y=129, width=368, height=338 points. Recomputing actual view bounds across every recorded frame gives:

| Edge | Minimum clearance beyond safe inset (points) |
| --- | ---: |
| Left | 9.547705007842353 |
| Right | 9.547705008977118 |
| Top | -0.000002982235060 |
| Bottom | 0.000002976094265 |

Both vertical edges are effectively flush with the allowed rectangle. Increasing zoom would clip the top or bottom stations, so the 9.55-point horizontal clearances do not indicate excess zoom. The solver correctly uses the tighter of horizontal and vertical constraints. The fixture centers around the real simulated location, so latitude affects its projected aspect ratio; the real card inset also affects available height.

The test now checks that at least one of the four edges is tight, rather than requiring a horizontal edge. The existing per-view four-edge clipping allowance, 1-point tightness limit, minimum sample count, station/count representation, non-animation requirement, and zero-transition requirement are unchanged. No renderer, camera solver, fixture, timeout, or legacy 2-point animation threshold was changed. The subsequent live rerun is recorded separately by the release verification run.
