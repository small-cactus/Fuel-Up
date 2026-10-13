# Precision and earlier warning take priority

The user clarified that false alerts are much worse than missed fill-ups: favor zero false alerts, earlier warnings, and low recall. This supersedes the earlier five-minute candidate as the desired operating objective. **Observed zero errors is a screening condition, not proof of 100% future accuracy.** An abstaining policy has undefined precision, not 100% precision.

## Target correction for an early fueling warning

The original station-destination comparison treats every brief station detection as negative. When translated literally into a timing test that matches only the **first** station detected, it removes most early fueling windows: someone can pass other stations before the intended purchase. The strict first-encounter tests had only three long-stop targets with eligible 10-minute warnings and none with eligible 15-minute warnings. Their results remain preserved as `first-encounter-10m.json` and `first-encounter-15m.json`.

A separate, explicitly named **confirmed-fuel target** therefore checks the next answered fuel purchase within 30 minutes, requiring at least 10 or 15 minutes' lead. Passing a shorter encounter does not terminate that fueling horizon. This changes the endpoint; it is not an improvement in station-destination accuracy. Short station detections remain observational negative examples when no confirmed fuel purchase is recorded within the horizon, and remain negative destinations in the original comparison. Unanswered long-stop windows are excluded from training for this target. A missing purchase answer can still contaminate the apparent negatives; unknown is not verified non-fueling.

Training may use a positive only after both its terminal visit outcome and fueling answer were available. Inputs remain causal and do not use braking. Daily retraining, segment weighting, route-example deduplication, one-hour cooldown, and a maximum of two alerts per account per UTC day are unchanged. The same frozen snapshot is used: no untouched final holdout, and no new users or purchases added between these comparisons.

## What happened

There are **six confirmed fuel purchases** in the test period. All six have some eligible 10–30-minute input; five have some eligible 15–30-minute input. This is actual fueling timing, not the three-minute-duration proxy.

| Policy | Target lead | Alerts | Correct early fueling alerts | Other outcomes |
|---|---|---:|---:|---|
| Route contrast, score >=.7 | 10–30 min | 2 | 1 | One short encounter, unanswered |
| Route contrast, score >=.7 | 15–30 min | 2 | 1 | One short encounter, unanswered |
| Answer-qualified route + personal cycle, score >=.7 | 10–30 min | 1 | 1 | None |
| Answer-qualified route + personal cycle, score >=.7 | 15–30 min | 1 | 1 | None |
| Same rule requiring at least two independent route examples | Either | 0 | 0 | Abstains |
| Strict rule: at least three examples, all favor confirmed fueling | Either | 0 | 0 | Abstains |

The single success is **the same event in both horizons**, not two independent successes. It came **22.72 minutes before a confirmed purchase**, in the largest account. At that time there were four known confirmed fills, eight prior long stops, and five prior distinct stations. The person had been observed driving for about 19.4 minutes, and time since the last confirmed fill was about 23.96 hours (85.4% of the then-known median cycle). The route score was .726, supported by **one matched independent historical approach**.

The relaxed candidate catches 1/6 known purchases and misses five. It has zero other alerts in this small replay, but one match is insufficient to estimate precision or establish generalization. The strict candidate has zero alerts and misses all six. It is silent because evidence is insufficient, not because 100% accuracy was demonstrated.

Full model comparisons at score thresholds .5, .7 and .9, plus history/example minimums, are in [confirmed-fuel-10m.json](confirmed-fuel-10m.json) and [confirmed-fuel-15m.json](confirmed-fuel-15m.json). Pooled classifiers either abstain or emit short/unknown alerts at lower thresholds. Cycle alone emits four alerts: one early confirmed purchase, one purchase too late for the desired lead, and two short unanswered encounters. The stricter user preference disqualifies those noisy policies.

## Operating decision

Keep live behavior unchanged. Preserve the stricter, abstaining offline configuration in [candidate.json](candidate.json): at least 15 minutes' useful lead, confirmed-answer-qualified route memory, three independent matching historical examples with no matched negative vote, readiness from the person's own confirmed fill history, and a conservative score cutoff. Unknown outcomes do not certify precision. A score is not a calibrated probability.

Prospective validation should prioritize independently confirmed false alerts, unknown/unanswered alerts, useful lead time, and only then recall. Retain abstention until future unseen trips support a nonzero-alert policy. Do not repeatedly tune this same small snapshot until a seemingly perfect subset appears. No release, app notification, or automation was enabled by this experiment.

Reproduce the direct fueling tests with:

```sh
PYTHONPATH=ANALYSIS_PACKAGES python3 scripts/driving-research/backtestTripIntent.py PRIVATE_INPUT_DIRECTORY OUTPUT_DIRECTORY 10 30 confirmed_fuel
PYTHONPATH=ANALYSIS_PACKAGES python3 scripts/driving-research/backtestTripIntent.py PRIVATE_INPUT_DIRECTORY OUTPUT_DIRECTORY 15 30 confirmed_fuel
```

For the original duration/first-encounter target, omit the last argument or specify `first_encounter`. Future data must be treated as new validation; the candidate below is not a proven production policy.
