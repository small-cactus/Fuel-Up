# Check every outage row

The overlay starts read-only checks for all six services when an outage appears,
including services whose screens have never been visited. It retries failed or
unfinished checks every five seconds without duplicating active requests. Each
spinner follows that service's real pending request. The existing failure-only
500ms blur and API deadlines are unchanged (research uses its native 20s deadline).

Checks use the normal fault-gated transport and require a 2xx response. Prices
read the national cache, memberships execute the indexed Florida directory RPC,
price history and notification registration execute bounded HEAD database reads,
account services call Auth health, and research calls its deployed health route.
Research health performs a bounded HEAD read against the research database and
returns only availability; it does not enroll a participant, upload data, or
expose participant information. These are API availability checks, not proof of
APNs delivery or every authenticated account/research operation.

## Evidence

- live-checks.json: all six production endpoints returned 200 (444–906ms).
- simulator-recovery.json: actual monitor subscription events from the iPhone 17
  Pro Max simulator. Enabled only the existing Dev transport gate, invoked one
  actual price request, and let its normal 20s deadline trigger the overlay.
  All other services were then checked automatically, timed out at their normal
  deadlines, and retried. Turning faults off recovered all six through real
  responses without a manual check. The overlay disappeared; faults remain off.
- checking.png: native glass panel showing a pending check for every listed API.
- 30 focused network, service-check, overlay, blur, and research tests passed.
- npm test: 160 passed. git diff --check passed.
- Signed Release build completed in 48 seconds. CLI installed in place on iPhone
  18 Pro Max 00008160-001E206E02A0000A; installed-app inventory verified Fuel Up.
  Phone installation and simulator visual QA are separate evidence.
