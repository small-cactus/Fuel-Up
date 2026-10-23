# Build 35 — native map gesture performance

Reuses bounded native glass containers and unchanged station pills across map movements, and removes a diagnostic-only clustering pass from normal rendering. Camera persistence, station-card navigation, native glass, cluster transitions and station/recommendation colors are retained.

Matched simulator measurements and raw evidence: [performance report](../../performance/native-map-2026-10-23/README.md). Repeat cycles created 78% fewer new pills and 98% fewer containers; overlay CPU p95 improved 12%. These are app overlay measurements, not physical-phone FPS or proof that MapKit tile/GPU warmup is eliminated.

Validation: 26 native integration/routing checks, 165 standard tests and seven native unit runners passed. Touch gesture flow passed twice. The retained debug-only legacy renderer still fails its unchanged animation gate; it is excluded from shipping iOS Release. No test threshold was relaxed.

Release archive/upload is in progress. Tester availability has not yet been verified for build 35.
