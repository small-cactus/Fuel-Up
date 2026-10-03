# Location chip bounds and entrance spring

- The decorative price overlay uses the top 70% of the full map height, independent of the page's copy spacing. Normalized row positions are clamped, with inset space for capsule height, overshoot, and the sample-price caption. The overlay clips at its bounds as a final containment guard.
- Entrance uses a native SwiftUI spring (0.48-second response, 0.62 damping fraction). Existing hold, shrink, invisible relocation, Reduce Motion, and background cancellation behavior is preserved.
- Release device and Debug simulator builds passed. Eight focused iOS support/onboarding/state-continuity checks passed.
- Recorded 20 seconds on the iPhone 13 mini simulator, then inspected 10 fps frames: chips grow, settle, hold, shrink, and reappear in another cell within the bounded map area. A pre-existing unsigned-simulator notification entitlement banner was visible at the footer; it did not cover the tested map.
- Installed the Release app successfully on Anthony's iPhone 18 Pro Max with preferences preserved. Physical screen behavior was not inspected over the wireless connection.

Local recording (ignored): `.argent/recordings/screen-recording-0EE3DFFD-087C-483C-A651-C55C59A719A3-1790998521381.mp4`.
