# Real-time stop evidence: October 20, 2026

## Finding

A recent, accuracy-aware station-distance gate is worth prospective testing.
It reduced false prompts in this saved-data replay from **7 to 2**, retaining
**20 of the baseline's 21 confirmed stops**. This is exploratory evidence,
not a live improvement or a production-ready threshold. No app policy,
collection, consent, notification, or upload behavior was changed.

The benefit is concentrated in one person. For the second person, this gate
missed one additional confirmed fuel stop and prevented no false prompt.
Do not deploy a universal 65-meter rule from this sample.

## Evidence and definitions

Protected snapshot exported October 20, 2026 at 17:34:54 UTC:
38 definitively labeled visits from three people: 17 fuel purchases, eight
stops without fuel, and 13 “not a stop” answers. The other 432 observed visits
are unlabeled and excluded, not negative examples. Fuel purchases do not
establish full tanks.

The private export contains 11,809 events and coordinates for 22 associated
stations. It retains visit records and saved sensor windows around labeled
visits. Raw data, identities, coordinates, and per-visit chronology stay outside
Git. The adjacent aggregate JSON contains the input digest and every tested
policy, including unsuccessful approaches.

The baseline replays today's v2 three-minute detector on saved fixes at each
originally associated station. A separate harness running the production Swift
detector matched all **38 windows, including prompt timing, with zero
discrepancies**. This validates the Python baseline against the same input;
it does not reconstruct unsaved phone callbacks.

There were 13 actual scheduled prompts attached to “not a stop” labels in the
historical records, including older policy behavior. Do not compare those 13
directly to a candidate's two: the controlled v2 replay comparison is **7 vs 2**.

## Results

Counts below are visits that would receive a prompt before their recorded
departure/gap, capped at 30 minutes. A non-fuel stop is a true stop.

| Gate added to v2 | Fuel stops prompted / 17 | Non-fuel stops prompted / 8 | False prompts / 13 |
| --- | ---: | ---: | ---: |
| None: v2 baseline | 15 | 6 | 7 |
| Continuous low speed for 90 seconds | 6 | 3 | 5 |
| Continuous low speed for 120 seconds | 5 | 3 | 5 |
| Stable position plus 90 seconds low speed | 5 | 2 | 5 |
| Recent walking evidence | 4 | 5 | 3 |
| Stable position OR walking | 6 | 5 | 6 |
| Stable position AND motion support | 2 | 1 | 2 |
| Recent station core, 50 meters | 11 | 4 | 0 |
| **Recent station core, 65 meters** | **14** | **6** | **2** |
| Recent station core, 80 meters | 14 | 6 | 4 |
| 50-meter core OR walking | 11 | 6 | 3 |
| 65-meter core OR walking | 14 | 6 | 5 |

The 65-meter candidate removed five of seven replayed false prompts (71.4%)
and lost one of 21 baseline-confirmed stops (4.8%). These are sample counts,
not population error rates. Median extra delay for retained real stops was
zero; maximum was 92 seconds.

| Anonymous participant group | Visits | Baseline true / false prompts | 65-meter gate true / false prompts |
| --- | ---: | ---: | ---: |
| A | 30 | 16 / 6 | 16 / 1 |
| B | 7 | 4 / 1 | 3 / 1 |
| C | 1 | 1 / 0 | 1 / 0 |

Chronological descriptive slices:
- Before October 14: false prompts 3→0, fuel prompts 8→8,
  non-fuel prompts 5→5.
- October 14 onward: false prompts 4→2, fuel prompts 7→6,
  non-fuel prompts 1→1.

Geometry gates were added after examining first-stage results. Neither period
is an untouched holdout. The apparent success needs new, prospectively labeled
visits, especially from other participants and stations.

## Real-time approach

Keep the existing three-minute eligibility and explicit confirmation. At each
subsequent accepted fix while the visit remains active:

1. Take accepted fixes from the preceding 60 seconds, after arrival and already
   received at the decision time.
2. Require at least three distinct fix timestamps spanning at least 30 seconds,
   with the newest no older than 30 seconds.
3. For each fix, add horizontal accuracy to distance from the station point.
4. Permit a prompt only if the median expanded distance is at most 65 meters.
   Otherwise defer and reevaluate; silence does not label the visit false.

This uses inputs already available on the phone. It needs no server lookup,
new sensor, or predictive model. The exploratory implementation scans replay
history for clarity; a phone implementation should retain a bounded recent
buffer and preserve the existing durable once-per-visit notification claim.
The current native candidate event fires once, so merely filtering that event
would be insufficient: deferred eligibility must be reevaluated on later fixes.

Station catalog points are not pump or property boundaries. The lost stop
shows why distance alone cannot be treated as ground truth. A future candidate
could use accurate station footprints or previously confirmed parking
locations, but their benefit is unmeasured here.

## What the new inputs do and do not establish

- Longer stationary time alone performs poorly: a person can be stopped near a
  station without visiting it. The present v2 timer also retains elapsed time
  through some movement inside its exit boundary.
- Walking as a required signal misses too many confirmed fuel stops; allowing
  walking to override the distance gate lets false prompts back through.
- Pedometer results were available by the three-minute point in **zero of these
  38 visits**. Current visit pedometer queries occur after departure. They cannot
  justify an earlier real-time notification.
- Historical motion is usable only after its response arrives. Missing motion
  is unknown, and combined automotive/stationary flags are not a veto.
- A separate causal check of earlier same-person “not a stop” corrections found
  no usable matches within 20, 30, or 50 meters at later baseline prompts.
  Personalized rejection memory has no demonstrated benefit in this snapshot.

## Limits and next validation

Labels are self-selected and concentrated in three people, mostly one person.
Saved GPS is downsampled; two windows were capped at 30 minutes. Current station
coordinates and original associations are used. This comparison cannot
measure unseen stops, station-selection errors, general driving false-alert
rates, or performance on full-frequency phone callbacks.

Recommended next stage: keep 65 meters fixed and run this candidate silently
alongside v2 on **new** visits, recording decision-time distance, accuracy,
sample coverage, eligibility, and suppression reasons. Continue gathering
explicit outcomes, including suppressed visits, to avoid only labeling cases
that the candidate chose to prompt. Report participant-level misses and false
prompts before deciding whether to enable it. This stage is proposed, not
implemented or deployed by this evaluation.

## Reproduce

Private input format: JSON object with `exportedAt`, decoded `events` carrying
`participantId`, and `stations` with `id`, `latitude`, and `longitude`.

```sh
PYTHONDONTWRITEBYTECODE=1 python3 scripts/driving-research/testStopEvidence.py
PYTHONDONTWRITEBYTECODE=1 python3 scripts/driving-research/evaluateStopEvidence.py \
  PRIVATE_SNAPSHOT.json AGGREGATE_REPORT.json \
  --native-windows PRIVATE_NATIVE_WINDOWS.json
swiftc modules/fuel-up-driving-activity/ios/Research/DrivingResearchModels.swift \
  scripts/driving-research/replayStopEvidenceBaseline.swift \
  -o /tmp/replay-stop-baseline
/tmp/replay-stop-baseline PRIVATE_NATIVE_WINDOWS.json
```

The native-window export contains locations and must remain outside the repo.
Checks cover future/late evidence, motion ambiguity, invalid fixes, movement,
gaps, duplicate fixes, uncertainty, freshness, the three-minute boundary,
departure limits, participant identity separation, non-fuel positives, and
causal use of corrections.
