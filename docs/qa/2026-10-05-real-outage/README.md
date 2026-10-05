# Real request-driven connection overlay

The Dev switch now drops transport delivery only. Screen loading, service health,
cached data, fallback, and recovery have no fault-mode flags. No health values were
fabricated during the final simulator checks.

Map requests share the existing national Trends deadline of 20 seconds. Other
JavaScript requests retain a 15-second deadline. Native research uses its existing
20-second request timeout. One transport deadline controls both fallback and health.

Blur is independent of those deadlines: fast requests remain clear for the first
second, followed by a 650ms ramp to intensity 24. An actual failure ramps to 40 in
650ms and displays the warning. Native Liquid Glass contains the recovery message
and the service list. Untested services remain labeled "Not checked".

## Verification

- iPhone 17 Pro Max simulator, iOS 26.5, Debug native build succeeded.
- Enabled the native Dev switch through Argent. The switch did not manufacture
  service failures. Used the app's real Supabase gas-prices invocation on Home to
  exercise its transport with delivery blocked; no mock response or health report.
- At 2.330 seconds the request was pending without error. The 2.2s and 6.3s images
  show the same settled blur rather than an animation spanning the timeout.
- The actual price service changed to unresponsive 20.008 seconds after dispatch;
  the API caller returned its normal error at 20.054 seconds. See request-timing.json.
- Only Fuel prices failed; all unqueried services remained unknown. Inspected
  warning and glass readability in both themes.
- Disabling faults through the Dev handler left Fuel prices unresponsive. A real
  failed-read retry succeeded, changed it to responding, incremented recovery to 1,
  and removed the Home overlay. Fault injection left off after QA.
- 22 focused network/overlay/blur/onboarding/Trends tests passed; npm test: 160 passed.
- Standalone Swift gate execution passed timeout, task cancellation, and release
  checks. Debug and signed Release builds succeeded.
- Signed Release built in 55 seconds with the preserved device cache, then installed
  in place through CLI on iPhone 18 Pro Max 00008160-001E206E02A0000A. Device inventory
  confirmed com.anthonyh.fuelup. Phone installation is separate from simulator QA;
  no physical-phone visual QA claim.

The repair-underway / under-20-minute sentence is the user-provided product copy;
there is no incident ETA API wired to that sentence. This change does not alter it.
