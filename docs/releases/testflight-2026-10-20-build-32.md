# TestFlight 1.0.0 (32): fewer false stop prompts

User authorized enabling the stronger location rule and distributing it through
TestFlight on October 20. Policy `station-stop-v3-core65` adds recent,
accuracy-expanded station distance to the existing three-minute eligibility.
It defers notifications until the median of accepted fixes in the preceding
minute is within 65 meters, with at least three distinct fixes spanning 30
seconds and a newest fix no older than 30 seconds.

The visit detector still records its existing observations, candidates,
departures, and gaps. Every accepted fix can reevaluate a deferred prompt;
departure never bypasses the stronger gate. Evidence resets for a new visit,
collection interruption, or process restart. A bounded in-memory buffer avoids
adding high-frequency persistent writes. Decision reason changes use existing
research diagnostics. Durable prompt claims and explicit participant labels
retain their existing meaning. An asynchronous notification attempt is also
cancelled if the visit has ended before scheduling finishes.

This is a precision tradeoff, not a promise of no false stops. The existing
38-visit exploratory comparison produced 2 false prompts instead of 7, with
14 fuel stops instead of 15 and all six previously reproduced non-fuel stops.
All avoided false prompts belonged to one participant; a different participant
lost one fuel prompt without gaining a false-prompt reduction. No new accuracy
claim is made from shipping the rule.

## Validation

The production Swift gate reproduced all 38 Python candidate decisions and
prompt times with zero mismatches (22 prompts). Private replay inputs remain
outside Git. Compiled synthetic tests cover deferral after the one-shot
candidate, duration, uncertainty, stale/future/invalid inputs, duplicate fixes,
moving fixes, departures, gaps, relaunch coverage, and durable notification
claims. Diagnostic metadata round-trips through the existing backend validator.

## Distribution

Build preparation is in progress. Upload acceptance, processing, and tester
availability will be recorded separately after verification. The public App
Store submission is outside this task's scope.
