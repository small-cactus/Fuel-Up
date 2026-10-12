# TestFlight 1.0.0 (29): installation silent sync

Native implementation: `07a53f9`. Register installations for silent APNs usage-sync independently of optional research enrollment and visible-alert authorization. Upload only the existing allowlisted installation outbox. Preserve research consent, permissions and pause behavior. See `../operations/2026-10-12-installation-silent-sync/README.md` for the implementation, deployed server verification and nine passing targeted tests.

Build number 29 reserved on EAS and synchronized in app.json and all native targets. Existing App Store build 27 submission remains unchanged. Distribution targets are the existing Fuel Up Internal Testing and Fuel Up External Testing groups.

Final archive succeeded at `/tmp/FuelUp-TestFlight-29.xcarchive`. The app and both extensions report 1.0.0 (29); deep strict signature verification passed. Distribution export succeeded at `/tmp/FuelUp-TestFlight-29-export`, and its embedded APNs entitlement is production. IPA SHA-256: `42745afe5b70ae4713b16d126b9b8a61657ab4cb283767899b9227d32cf1afff`. Upload succeeded at 2026-10-12 21:08:18 UTC. Apple processing and tester availability remain pending. Upload emitted the existing non-blocking missing Hermes framework dSYM warning; Hermes crash symbolication may be incomplete.

Disk preparation removed superseded device outputs in the default Xcode cache, the earlier incomplete-scope build-28 archive, and the completed build-28 distribution temporary directory. Preserved the final uploaded build-28 archive/export, release logs/evidence, active `/tmp/FuelUpGlassDevice` device cache and simulator cache. Available space before archive: approximately 4.9 GiB.

Packaging corrected a hard-coded notification-extension build number before final export. The initial archive was not uploaded; all three bundles were checked again in both the final archive and exported IPA. Logs: `/tmp/fuelup-testflight-29-final-archive.log`, `/tmp/fuelup-testflight-29-export.log`, `/tmp/fuelup-testflight-29-upload.log`.
