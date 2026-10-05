# Home wordmark — October 5, 2026

Home reuses `FuelUpHeaderLogo` and `TopCanopy` from Trends: centered 132 × 38 wordmark at the top safe-area inset, 44-point canopy extension, and the same progressive blur. The overlay ignores touches so the map remains interactive. Existing light/dark logo assets follow the app theme.

Verified light and dark on the iPhone 17 Pro Max simulator, iOS 26.5. Accessibility frame `(0.350, 0.065, 0.300, 0.040)` matches the existing header placement. Original simulator theme was restored after inspection. [Light](light.png) · [Dark](dark.png).

All five existing Home layout/launch tests passed; scoped ESLint and `git diff --check` passed. Native map/cluster behavior was not changed, so the cluster split/merge probe was not run.
