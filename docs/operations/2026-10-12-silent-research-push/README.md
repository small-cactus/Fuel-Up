# Silent research sync and full notification authorization

The operator `node scripts/driving-research/requestSync.mjs PARTICIPANT_UUID`
now queues a durable sync command and sends a direct silent APNs wake:
`content-available: 1`, `apns-push-type: background`, priority 5, no alert,
sound, badge, or notification-service-extension payload. The command remains
available through authenticated control checks when iOS delays delivery.

The database atomically claims one send per request. Accepted, rejected, sending,
and unknown outcomes are not automatically resent. New wakes for the same
participant are limited to one per 30 minutes; missing registration leaves the
command queued. Participant tokens cannot invoke the operator claim function.

The native handler validates the wake envelope, preserves consent and deliberate
pause, and reads the actual command from the authenticated server. Its 25-second
budget cancels unfinished work and completes the OS callback once; the existing
durable outbox resumes later. Installation telemetry also starts its background
URLSession drain. APNs registration is independent of visible alert authorization.

Visible local research alerts now require full authorization. Native setup
requests alert and sound authorization without provisional, upgrades provisional
permission on an active research screen, and flags quiet delivery as incomplete.
The JS permission path explicitly disables provisional authorization and checks
the iOS authorization enum, rather than treating provisional `granted` as full.
A person can still deny alerts or change notification settings.

## Verification on 2026-10-12

- Eight APNs, permission-flow, and notification-policy tests passed.
- Native callback test passed: unrelated payload, consent, pause, upload,
  expiration, and exactly-once completion. Timeout exercised at the real 25 seconds.
- Migration and synthetic access-control/claim/throttle/revocation tests passed
  inside rollback transactions, before and after deploying the migration.
- Signed Release device build succeeded (55 seconds); strict deep signature
  verification passed. The built Info.plist includes `remote-notification`.
- Installed in place on the paired iPhone 18 Pro Max; registry verified 1.0.0 (28).
  No uninstall, data reset, or foreground launch was performed.
- One silent test sent at 13:40:15.718885 UTC: APNs accepted it; the authenticated
  phone control endpoint acknowledged completion at 13:40:19.110485 UTC (3.392 s).
  The count report just before completion is a prior snapshot, not a post-drain count.
- A fresh permission snapshot at 13:40:17.223369 UTC reported authorization=2,
  alertSetting=2, soundSetting=2: fully authorized with alerts and sound enabled.

This verifies one real silent wake/sync cycle, not guaranteed future delivery.
iOS controls background scheduling, including throttling and force-quit behavior.
TestFlight distribution has not been updated by this change.

Apple reference: https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app

Repeat tests:

```sh
node --test tests/drivingResearchAPNs.test.mjs tests/drivingResearchPermissions.test.cjs tests/drivingResearchQuiet.test.cjs tests/drivingResearchSilentPush.test.cjs
node scripts/driving-research/verifySilentPush.mjs
```
