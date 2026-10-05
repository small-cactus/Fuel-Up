# Warning and blur appear together

Supersedes the pending-blur behavior in the earlier real-outage QA run.
ConnectionOverlay now returns null for pending requests, including requests close
to their deadline. Only an actual failure or known offline connection mounts the
warning and ConnectionBlur together. The blur then animates to intensity 40 over
650ms. The map/national Trends timeout remains 20 seconds.

## Verification

- iPhone 17 Pro Max simulator with the real app API invocation and Dev transport
  fault gate; no fabricated responses or injected service status.
- Captured mounted UI and transport status at 0, 1, 5, 10, 19 and 20.5 seconds.
  There was no ConnectionBlur and no warning through 19.014 seconds. At 20.514
  seconds the real timeout had failed, and both blur and warning were mounted.
- pending.png shows the clear map during the request; failed.png shows the
  warning and blur after timeout. Navigation remains available.
- 13 focused blur/overlay/transport tests passed, including an actual transport
  timeout driving the rendered component; npm test: 160 passed.
- Fault gate disabled after QA and the normal failed-read retry requested.
- Signed Release build succeeded in 54 seconds and installed in place via CLI on
  iPhone 18 Pro Max 00008160-001E206E02A0000A. Device inventory confirmed Fuel Up.
  Visual QA above was on the simulator, not on the physical phone.
