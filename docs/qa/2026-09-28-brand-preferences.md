# Brand preferences and E85 QA

Implementation adds seven-page onboarding, nearby brand discovery/search, strong preferred-brand-first ranking, E85 co-availability, and matching Settings controls. GasBuddy's E85 coverage search returns the user's chosen grade, rather than filtering an incomplete standard-grade result set. Provider brand identity is preserved independently of station name through cloud cache/history. Predictive and Trends preferences use the same settings.

Checkpoint validation: core unit suite 133/133; focused lifecycle/preferences suite 127/127; cloud suite 50/50; five-grade live/cache probe passed. Live Tampa premium+E85 query returned four confirmed E85 stations with premium prices. ESLint reports zero errors; existing style/performance warnings remain for targeted review.

Home card-swap Argent replay passed 4/4 with Fast Refresh disabled. Video inspection showed annotation continuity during both swaps. React capture: 20.2 seconds, 40 commits, none over 16 ms. This is not a native FPS measurement or a valid before/after improvement comparison. Native Instruments capture has not produced a usable trace in this environment.

Visual verification in progress. Settings brand list and search inspected; Poppy selection native value changed from0 to1. Concurrent map-lab edits/probe in the shared checkout interrupted Home and onboarding tests, so verification is moving to an isolated checkout. XCTest attempts so far are not passes. The existing cluster integration gate still times out while production clustering is disabled; thresholds were not changed.
