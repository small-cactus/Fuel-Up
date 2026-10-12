# TestFlight 1.0.0 (29): installation silent sync

Native implementation: `07a53f9`. Register installations for silent APNs usage-sync independently of optional research enrollment and visible-alert authorization. Upload only the existing allowlisted installation outbox. Preserve research consent, permissions and pause behavior. See `../operations/2026-10-12-installation-silent-sync/README.md` for the implementation, deployed server verification and nine passing targeted tests.

Build number 29 reserved on EAS and synchronized in app.json and all native targets. Existing App Store build 27 submission remains unchanged. Distribution targets are the existing Fuel Up Internal Testing and Fuel Up External Testing groups.

Final archive succeeded at `/tmp/FuelUp-TestFlight-29.xcarchive`. The app and both extensions report 1.0.0 (29); deep strict signature verification passed. Distribution export succeeded at `/tmp/FuelUp-TestFlight-29-export`, and its embedded APNs entitlement is production. IPA SHA-256: `42745afe5b70ae4713b16d126b9b8a61657ab4cb283767899b9227d32cf1afff`. Upload succeeded at 2026-10-12 21:08:18 UTC. Apple processing completed; final tester availability is verified below. Upload emitted the existing non-blocking missing Hermes framework dSYM warning; Hermes crash symbolication may be incomplete.

Disk preparation removed superseded device outputs in the default Xcode cache, the earlier incomplete-scope build-28 archive, and the completed build-28 distribution temporary directory. Preserved the final uploaded build-28 archive/export, release logs/evidence, active `/tmp/FuelUpGlassDevice` device cache and simulator cache. Available space before archive: approximately 4.9 GiB.

Packaging corrected a hard-coded notification-extension build number before final export. The initial archive was not uploaded; all three bundles were checked again in both the final archive and exported IPA. Logs: `/tmp/fuelup-testflight-29-final-archive.log`, `/tmp/fuelup-testflight-29-export.log`, `/tmp/fuelup-testflight-29-upload.log`.

## Verified distribution

On October 12 at approximately 21:12 UTC, App Store Connect showed build **1.0.0 (29) — Testing, expires in 90 days** in both existing groups: Fuel Up External Testing (six testers) and Fuel Up Internal Testing (one tester). Submitted build 29 through the external beta-review flow with Automatically notify testers checked and the exact notes in `testflight-2026-10-12-build-29-what-to-test.txt`. The resulting external group has six builds; the internal group has seven. No tester/group additions or removals were made.

This verifies build availability and notification configuration, not individual installation, notification receipt, or the new on-device silent-sync registration. Testers must install build 29 and open it once. No phone app launch or test push was performed during this release. The App Store build 27 review submission was not changed.
