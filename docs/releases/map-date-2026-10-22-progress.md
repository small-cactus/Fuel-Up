# Research dates and map camera persistence — unfinished release

Research station visits and arrival/departure entries now display native localized
dates together with times. Background origin, user-location, station-data and
card-inset updates no longer request a camera fit after initial presentation.
Explicit station focus and Show All retain their existing camera behavior.

The targeted camera-fit, focus, card, quiet-research and release-packaging checks
passed: 16 tests. `git diff --check` passed. A new opt-in Debug native camera probe
and integration test cover background updates in overview, panned and selected
views, followed by explicit station focus and Show All.

Native verification is NOT complete. The simulator build exhausted available
disk space during compilation and was interrupted. The new live regression,
visual date checks and cluster integration checks still need to run. No new
release archive or TestFlight upload has been made, and the build number remains
32. App Store Connect in Safari also requires sign-in.

Build and test logs are under `/tmp/fuelup-map-date-20261022/`. Older Fuel Up
archives were preserved as verified compressed files. Older Archives-folder
compressed copies were moved to the user's Windows desktop, under
`D:/FuelUpArchiveBackup/20261022/`, only after matching SHA-256 verification.
Each original location retains a `.backup.json` restoration pointer; the full
manifest is `archive-backup-manifest.json` in the log folder. Build 32's compressed
archive and exported IPA remain local. Source, research records and active build
caches were preserved.

Resume after disk capacity is available: complete the incremental simulator
build, run live/visual verification, bump all targets to the next available build
number, archive/sign/export/upload and verify TestFlight distribution.
