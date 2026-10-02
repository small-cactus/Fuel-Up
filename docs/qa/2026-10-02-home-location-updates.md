# Home location updates

Home's native MapKit user dot followed Core Location, but its JavaScript station search reused the saved context indefinitely. The five-minute and foreground refresh paths fetched stations at that same old origin.

Home now owns a foreground location subscription while focused, requests a fresh position on activation/resume, updates the shared search context after 100 metres of movement, and persists the last accepted position. Manual location overrides remain authoritative. Backgrounding/unmounting releases the subscription, including asynchronous setup completing after cleanup. Old one-shot results cannot replace newer watched fixes. Cached quote distances are recalculated before Home filters by radius and ranks candidates; observed prices are unchanged.

## Verification

- `npm test`: 159 passed, including live-location controller lifecycle, stale results, movement, denied permission, manual overrides, shared context/persistence, and cached-distance regression checks.
- Real iOS 26.5 simulator, FuelUp Glass Lab (iPhone 13 mini), existing Debug app with refreshed JavaScript; no native rebuild required.
- Cold bundle reload at Clearwater (27.9659, -82.8001) replaced the old Tampa-area search and displayed the Largo Wawa on Ulmerton Road, 5.5 miles away.
- Foreground simulated movement to Town 'n' Country (28.0100, -82.5770) changed native map input to those coordinates and loaded 71 stations; first card was Wawa, 8458 N Dale Mabry Hwy, 4.5 miles away. Verified both React/native bridge props and the visible accessibility tree.
- Backgrounded using Home, moved to St. Petersburg (27.7731, -82.6400), then foregrounded without terminating. Native map input changed to those coordinates and loaded 66 stations; first card was Wawa, 5390 66th St N, 6.3 miles away. Bridge distance was 6.349421973995485 miles after rebasing.
- No physical-phone installation or driving test in this task. No cluster animation implementation, collector, raw-price policy, or ranking preference changes.
