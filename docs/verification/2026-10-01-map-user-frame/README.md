# Overview includes the current user location

Initial framing and Show all now include the actual MapKit user coordinate, falling back to the app's known location while GPS initializes. The location is a separate camera anchor; it is never inserted into the station/cluster graph. Existing chip edge margins, the card exclusion area, longitude wrapping, maximum zoom and native camera animation remain in use. Dense searches retain their bounded layout search.

The cached overview includes the location used to solve it, so Show all cannot reuse a station-only or out-of-date-location camera. A late GPS fix outside the usable map requests a new overview fit when no gesture/focus flight is active. Single-station focus still zooms to that station.

## Verification

- Swift camera-fit fixtures passed for 320-, 375- and 440-point portrait widths and 812-point landscape width. New cases place the user north/south/east/west and diagonally outside one, six, 80 and 400 stations. Existing dense fixtures reach 2,000 stations. All represented chips and the 32-point location area fit with deterministic station-order behavior.
- Three geometry/focus/location-clearance regression tests passed.
- Live MapKit outside-location fixture: 120 frames kept the actual user dot and six stations visible; the user was more than 100 screen points outside the station group.
- Normal and rotated Show all: 54 intermediate native camera frames each, with all six stations visible. Six repeated returns preserved station geometry, cluster membership, tint and native glass connections.
- The fixture previously blocked a card-inset refit before its camera sequence, causing a two-point initial/return mismatch. Probe preparation now accepts real layout updates before camera steps begin, using its actual fixture stations. Assertions and thresholds are unchanged. Camera/bounds evidence is included in return samples.
- Native animation regression passed on the updated framing implementation: 1,650 rendered frames, 113 transitions, no false parent bridges. The final probe-preparation fix only affects fit/overview fixture setup; it does not alter the normal animation probe.
- Debug simulator and Release device builds succeeded. Installed on iPhone 18 Pro Max without launching the phone app. No visual phone validation is claimed.

## Remaining test limitations

The initial-fit probe can still fail when invoked immediately during cold launch, before the React price card finishes changing height: it compares early frames against the final card inset. Its assertion remains unchanged and the failed run is retained in `native-camera.txt`. On the loaded screen, the same unmodified test passed all 120 frames (`initial-fit-loaded.txt`). Production layout changes continue to request a refit; the probe intentionally stops automatic camera changes once its recording stage starts.

The required legacy React cluster probe timed out waiting for a multi-station cluster. Its test, two-point frame threshold and export path remain untouched; failure evidence is retained in `legacy-probe.txt`. This is not a claim that the full legacy gate passed.
