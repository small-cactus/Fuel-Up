# Research presentation and active reconnection

## Driving Research

The hosting controller publishes readiness after UIKit viewDidAppear, on the next
main-loop turn. The introduction uses that lifecycle signal, retaining SwiftUI's
normal sheet presentation. Leaving the screen invalidates any queued presentation.
No fixed navigation delay or forced presentation is used.

Recorded an actual Settings row tap on iPhone 17 Pro Max simulator, iOS 26.5.
The recording shows the horizontal screen push finishing, the research screen
visible on its own, and then the sheet sliding up from the bottom. Reviewed the
recording at 10 frames per second; research-presentation-frames.jpg preserves that
sequence. The original 4.1-second MP4 is included.

## Home connection warning

Blur starts only with a real failure, reaches intensity 65 over 500ms, and has no
pending-request blur. The existing API deadlines remain unchanged. Recovery copy
and service rows now share one native Liquid Glass container, below the separate
symbol and heading.

The overlay immediately retries failed reads and checks for another attempt every
five seconds while active. Pending requests are not duplicated. Writes are not
replayed. Per-service spinners appear only for actual pending requests; services
that have not been queried remain Not checked.

On the simulator, invoked actual price and price-history reads with the Dev
transport gate enabled. History failed at its 15-second deadline and started a
real retry 52ms later. Prices failed at 20 seconds and started a retry on the next
five-second check. Further attempts followed their normal deadlines without
overlap. Restoring transport delivery, without a manual retry, recovered both
services and removed the overlay. See reconnect-timing.json and the light/dark
screenshots. Faults were left off.

## Validation and installation

- 17 focused overlay, timing, network, and research tests passed.
- npm test: 160 passed. Debug simulator build succeeded.
- Signed Release build succeeded in 50 seconds and was installed in place via
  CLI on iPhone 18 Pro Max 00008160-001E206E02A0000A. App inventory verified Fuel Up.
- Visual QA was performed on the simulator; phone installation is verified
  separately and does not claim physical-device visual QA.
