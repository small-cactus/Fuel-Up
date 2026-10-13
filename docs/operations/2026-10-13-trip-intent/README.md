# Trip intent rather than slowing down — October 13, 2026

**Updated objective:** the user subsequently prioritized zero false alerts and earlier warning over recall. See [the precision-first follow-up](PRECISION-FIRST.md) for 10/15-minute tests against actual confirmed purchases. The five-minute results below remain exploratory evidence, not the selected operating standard.

The user rejected deceleration as an intent signal because it happens repeatedly on ordinary trips. This experiment removes speed, braking, speed changes, and instantaneous station proximity from the prediction inputs, changes the target to **5–20 minutes before arrival**, and trains against ordinary driving as well as short station detections.

A personal **route-prefix contrast plus fueling-cycle gate** is a more promising candidate on this snapshot. At the stricter tested score threshold it emits two would-be alerts, both followed by confirmed fueling, 5.72 and 5.77 minutes later. Both belong to the largest account. It misses four other confirmed purchases in the test period, has not demonstrated generalization to other testers, and is not validated for live notifications. Two successes must not be reported as established 100% accuracy.

## What the approach actually asks

1. **Is this person plausibly due?** Use only their previously answered fueling visits. Require elapsed time since the latest confirmed fill to reach 75% of their median prior inter-fill interval. At least three known fills are needed to form two intervals. This is a readiness gate, not a tank-level estimate.
2. **Does the recent path resemble an earlier fueling approach?** Compare current position, position two minutes earlier, direction, and observed trip origin with past paths from the same person.
3. **Does it also resemble ordinary driving or a short station encounter?** Those historical examples vote against a fuel-stop prediction. The candidate abstains without enough independent examples or a sufficiently strong score.

The candidate predicts timing, not a recommended station. Matching an earlier fueling route does not require the app to recommend that prior station; choosing cheaper gas would be a separate downstream step. It cannot anticipate a new route from personal route memory alone.

Speed is used only to recognize that the device is driving and to validate/accumulate observed travel, never as a slowdown predictor. The approach does not use future coordinates, the future destination, the current stop's eventual duration, or a fueling answer not yet known at the decision time.

## Data and evaluation

The **same frozen protected snapshot** is reused for comparison with the preceding signal study: 66,996 research events, 999 usage events, four accounts with 260 completed encounters, 24 long encounters and eight confirmed fuel purchases overall. No extra uploads or live collection were triggered. Hashes identify the input files and feature implementation in [results.json](results.json).

Build a causal observed driving segment from valid GPS observations. A gap of more than ten minutes, or departure after at least five stationary minutes, starts a new observed segment. GPS gaps can split one real trip; this segmentation is not verified trip truth.

Every minute is eligible when an accepted fix is at most 120 seconds old, the device is moving, and no currently known station visit is active. This produces 2,080 eligible minutes overall, including 1,536 test minutes on October 9–13. Minute samples are correlated; they are not independent trips or purchases.

Training labels use the first station encountered in the next 20 minutes:

- Long encounter arriving in 5–20 minutes: positive duration proxy.
- Every shorter encounter: negative, even if a longer stop follows later.
- A long encounter less than five minutes away: too late for this target, not a successful advance warning.
- No encounter, with fresh valid observations covering at least 15 of the next 20 minute bins: an observational negative.
- Insufficient subsequent coverage: unknown, excluded from training but still eligible to receive a simulated alert during testing.

Full feature-table outcomes: 29 positive minutes, 76 too-late long-stop minutes, 1,329 short-encounter minutes, 317 well-observed ordinary-driving minutes, and 329 unknown minutes. The short-encounter rows cover 212 of 236 short encounters; the remainder lack eligible pre-encounter minutes under this replay policy. Missing inputs are not filled using future observations.

There are 21 recorded long encounters and six confirmed purchases in the test period. Only seven of those long encounters have even one eligible 5–20-minute positive window under the first-encounter target. Sparse sampling, known active visits, and intervening short encounters limit the usable warning opportunities. Report overall coverage as well as performance within eligible windows.

Each test UTC day uses only training outcomes completed before that day. Pooled classifiers weight each observed segment equally in total, preventing dense minute samples from receiving unlimited weight. Personal route retrieval is same-person only and excludes the current segment. Repeated rows for a past encounter count as one example even if a GPS gap split its approach into multiple segments; ordinary-driving negatives get one vote per segment.

Route matching uses current position within 750 m, two-minute prefix position within 1,500 m, and direction within 60 degrees. Similarity cost also considers observed origin distance. Up to eight independent nearest examples contribute exponentially distance-weighted votes plus a weak negative prior. These are heuristic scores, **not calibrated probabilities**.

All policies have a one-hour cooldown and maximum two alerts per account per UTC day. Candidate scores of .5 and .7 and experience minimums of zero, three, and six past long stops are reported, including abstentions. These are exploratory comparisons using a previously inspected snapshot, not a fresh final holdout or a significance test.

## Results on the ordinary-driving clock

| Policy | Score threshold | Alerts | Useful long stops | Short stops | Confirmed purchases among useful stops | Advance warning |
|---|---:|---:|---:|---:|---:|---|
| Cycle alone | Due ratio .85 | 4 | 1 | 3 | 1 | 6.13 min |
| Personal route contrast | .5 | 5 | 2 | 3 | 2 | 6.25, 5.72 min |
| Personal route contrast | .7 | 3 | 2 | 1 | 2 | 6.25, 5.72 min |
| Route plus cycle | .5 | 2 | 1 | 1 | 1 | 5.72 min |
| **Route plus cycle** | **.7** | **2** | **2** | **0** | **2** | **5.72, 5.77 min** |
| Answer-qualified route plus cycle | .7 | 2 | 2 | 0 | 2 | 5.72, 5.77 min |
| Trip-context logistic / forest / boosted trees | .5 or .7 | 0 each | 0 | 0 | 0 | Abstained |

Threshold results are not monotonic in recovered events: an earlier lower-score false alert can use the cooldown and suppress a later true alert. Therefore the .5 and .7 route-plus-cycle policies do not necessarily alert on the same events.

The pooled models receive only causal trip/routine/readiness and explicit UI-intent features, including elapsed segment time, observed segment distance, displacement from observed origin, time/day cycles, prior station experience, hours/driving distance/driving time since prior long or answered fueling visits, historical inter-fill ratios, recent app opening, map interaction, station selection and Go actions. They do not receive raw coordinates, station identities, speed, deceleration, or current nearest-station distance. At the tested thresholds they provide no actionable warnings; this is not proof that their rankings contain no information.

## How much personal history was needed?

Both route-plus-cycle successes survive requiring **three independent matched historical examples**. They also survive an answer-qualified variant where a prior long stop is positive only if its `fueled` answer was available before the training day. Already answered store-only/non-stop visits become negatives; unanswered long positives are excluded from that variant.

At the first successful alert, the account had four known confirmed fills, eight prior long stops, and five prior distinct stations. At the second, it had five known confirmed fills, 13 prior long stops, and eight prior distinct stations. Time since last confirmed fill was approximately 24.25 and 22.69 hours, about .865 of the then-known median inter-fill interval. Alerts occurred about 36.4 and 6.2 minutes into the currently observed driving segment. These are on-the-way detections, not before-departure detections.

The experiment supports testing a personalized model after some history. It does not establish a universal onboarding requirement or a guarantee after N visits. No useful alert from another account was demonstrated. Missing/potentially partial fuel purchases, incomplete travel records, and repeated routes remain limitations.

## Earlier five-minute candidate, superseded by precision-first requirements

The earlier exploratory setting used answer-qualified route memory, score >=.7, three independent examples, cycle ratio >=.75, and a five-minute warning. It was not deployed. The current `candidate.json` instead records the stricter abstaining configuration described in `PRECISION-FIRST.md`. Future unseen trips are required to evaluate any nonzero-alert rule.

Current outcome: **2/6 known fuel purchases caught**, both in one account; **2/21 recorded long encounters caught** overall; four other known purchases missed. There were zero false alerts among this candidate's two alerts in this replay, which is too small a sample to estimate reliable precision. It is a more useful experimental direction than a generic slowdown trigger, with substantial abstention and coverage limitations.

## Reproduction and checks

```sh
PYTHONPATH=ANALYSIS_PACKAGES python3 scripts/driving-research/backtestTripIntent.py PRIVATE_INPUT_DIRECTORY OUTPUT_DIRECTORY
python3 tests/tripIntent.test.py
PYTHONPATH=ANALYSIS_PACKAGES python3 tests/tripIntentAnswers.test.py
```

The numerical environment is the isolated environment documented in the prior richer-signal study. Raw coordinate features, per-minute labels, and exact alert times stay in the protected input directory outside Git. Cached features are invalidated when the input or feature-code hashes change. Only anonymous aggregates are committed.

Tests cover future-data invariance, absence of braking features, delayed outcome availability, negative route evidence, deduplication of segment/encounter votes, other-person/current-trip exclusion, useful lead boundaries, missing future coverage, and answer timing. Existing rich-feature, clock-replay, destination, anticipation, and timing tests are rerun; [validation.txt](validation.txt) records results.
