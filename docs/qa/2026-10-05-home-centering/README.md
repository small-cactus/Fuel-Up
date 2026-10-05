# Home header clearance — October 5, 2026

The default framing center is 25 points lower. The usable map region reserves 50 additional points at its top, leaving the lower boundary above the station card unchanged. The map itself remains full screen. Short landscape layouts cap the additional clearance to retain a usable viewport. Initial framing, station focus, and Show all share these bounds.

## Verification

- All three camera-fit, focus, and location-clearance test suites passed. New assertions cover an exact 25-point downward shift without changing zoom in width-limited searches, preservation of the bottom edge, and short viewport bounds. Existing randomized fitting checks now exercise the header-adjusted region across phone sizes and landscape.
- Debug simulator build succeeded. Compared the same search coordinate and preferences on iPhone 17 Pro Max, iOS 26.5. The upper Costco pill moved from normalized y=0.176 to y=0.202, approximately 25 points on the 956-point screen. The wordmark and bottom station card stayed in place. Live station inventory may update between captures.
- Tapped Costco, then Show all. The native flight returned to the adjusted overview (Costco y=0.202), with the card and header clear.
- This checks camera framing and navigation; the full split/merge animation probe was not run. Split/merge animation code was not changed.

[Before](before.png) · [After / Show all](after.png).
