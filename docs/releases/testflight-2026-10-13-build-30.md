# TestFlight 1.0.0 (30): background motion crash fix

Implementation and regression evidence: `61d400f` and
`../operations/2026-10-13-motion-crash/README.md`.

The build-29 crash report symbolicated to the motion bridge's event dictionary
conversion. A native Thread Sanitizer regression reproduces concurrent cached
payload writes in the original code and passes after serializing motion commands
and callbacks. Late callbacks from stopped stream generations are ignored.

Validation: signed Release build and strict deep signature verification passed;
1,000 overlapping native callback/history requests plus lifecycle checks passed
under Thread Sanitizer; five related bridge/history/permission tests passed.
No claim is made of reproducing the exact allocator trap on a physical phone.

Build number 30 is reserved in EAS and synchronized in app.json and the local
native targets. Distribution targets are the existing internal/external groups.
Archive and distribution export succeeded. The app and both extensions report
1.0.0 (30); archive deep strict signature verification passed and the exported
profile uses production APNs. Package metadata/hash: `build-30/validation.json`.

Apple accepted the upload at 2026-10-13 17:34:31 UTC. The existing non-blocking
Hermes framework dSYM warning remains; the app dSYM is present and retained.
At 2026-10-13 17:44 UTC, App Store Connect showed build 30 as **Testing** in
both existing groups: Fuel Up External Testing (6 testers) and Fuel Up Internal
Testing (1 tester). External submission used the checked Automatically notify
testers option and the accompanying What to Test notes. No tester membership
was changed. This verifies availability, not delivery of every notification or
resolution of every possible on-device crash.

Local archive: `/tmp/FuelUp-TestFlight-30.xcarchive`; exported IPA:
`/tmp/FuelUp-TestFlight-30-export/FuelUp.ipa`. Build/export/upload logs are under
`/tmp/fuelup-crash-20261013/`. The build-29 archive and matching dSYM are preserved.
