# Network faults and loading UI — 2026-10-05

## Implementation

`src/components/ConnectionOverlay.js` is reusable. Mount it last inside a full-size screen root, passing `active={isFocused}` when the screen remains mounted in a tab navigator. It reads the shared monitor by default; `status` can supply another monitor or a preview, and `style` can adjust its bounds. Home is its first consumer. The overlay uses a native thick-material blur, with its symbol and text directly on the blur. Tabs remain usable.

The Dev screen's first switch holds the Supabase client's requests/responses and the native Driving Research transport until disabled. It is session-only and resets at process restart. Aborted queued writes are not sent. MapKit tiles and developer tooling are outside the app-API fault boundary.

The service list covers the app's client-facing API areas, not an inventory of physical machines or backend replicas: fuel prices, price history, memberships, notifications, Driving Research, and account services. A response updates only its service; unqueried services remain “Not checked.” Native network reachability selects the separate offline message. A watchdog identifies stalled requests. The overlay rechecks failed, known read requests every 30 seconds while foreground/focused, without replaying writes; recovered services prompt Home to refresh.

The outage recovery wording is the product message requested by the owner. It is not connected to a live AI-repair status feed or a measured restoration ETA. Offline copy does not make a server-outage or repair claim.

Native station-brand skeletons share the existing membership skeleton layout in both onboarding and Settings. Trends has a glass leaderboard skeleton in both scopes. Trend color uses the same observed interval as the displayed percentage, without changing stored price observations.

Driving Research uses `person.2.fill` and presents its introduction once per screen entry. Dismissing it does not reopen it while on the screen. Previously consented users get Done; merely viewing the introduction does not enable collection. A pending visit/test confirmation takes precedence over the introduction.

## Verification

- Debug simulator build succeeded on iPhone 17 Pro Max, iOS 26.5.
- Toggled Network Faults using the native switch. Home showed the heavy-blur outage state with all six simulated failures. Verified light and dark modes and continued navigation to Dev.
- Verified simultaneous membership and station-brand skeletons in onboarding and Settings. Confirmed the Favorites skeleton replaces even a saved favorite while discovery is pending.
- Verified the leaderboard skeleton beneath the chart in Local and National Trends.
- Verified Driving Research opens its introduction automatically, and stays dismissed after a swipe. No consent was submitted.
- A real `fuel_memberships_for_state` RPC remained pending for 41,165 ms with faults enabled. Turning the native switch off released it successfully. Fuel prices, price history and memberships reported responding, and Settings showed loaded brands and preserved membership/favorite selections.
- Injected an offline reachability state into the simulator monitor to inspect the separate offline presentation; restored it afterwards. This was a UI fixture, not a physical network-disconnection test.
- `npm test`: 160 passed. The obsolete fuel-picker source assertion now checks the existing dedicated native fuel-page link.
- Targeted network/overlay/onboarding/brands/Settings/Trends suites: 47 passed. The transport tests cover stalls, cancellation, watchdog failure/recovery, stale responses and read-only recovery. The rendered chart regression covers a national decline whose final bucket rises.
- Signed Release CLI build and in-place wireless installation on the paired iPhone 18 Pro Max succeeded; app inventory confirms `com.anthonyh.fuelup`, version 1.0.0, build 1. Phone installation is separate from the simulator visual checks above.

Screenshots in this directory show simulated outage states and loading states, plus the recovered brands page. Simulator data uses an Apple-area location fixture.
