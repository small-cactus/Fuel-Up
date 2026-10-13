# Predicting a station destination before a three-minute stop

October 13 exploratory offline replay. No app changes, provider calls, pushes,
or user-facing predictive alerts were made. Raw exports stay in a private
mode-0700 directory outside the repository. Only anonymous aggregates and input
hashes are committed.

## Target and sample definition

The user explicitly approved treating observed station visits lasting at least
180 seconds as positives, all shorter detections as negatives, and other known
stations as competing negative destinations. These are detector outcomes, not
verified fueling or verified intended destinations. Short fueling stops may be
negative under this definition; store-only long visits may be positive.

Protected snapshot: 66,975 research events, 1,015 static station coordinate
records, and 997 installation events. Eight research accounts exist; four have
station encounters. Across them are 260 encounters: 24 long and 236 short.
Two short encounters end in an observation gap and are potentially censored.
Separate sensitivity results exclude these short gap cases from ranker scoring.
Accounts are not verified distinct people.

All visits before October 11 00:00 UTC with completed outcomes before that time
form training: 153 visits (11 long, 142 short). The later window contains 107
visits (13 long, 94 short). Every timestamped view of a visit stays on the same
side of the split. Prediction landmarks that precede the split are excluded.
Missing usable location/candidate data results in abstention; it does not become
a fabricated negative. A training positive missing from its candidate set is
excluded from fitting and remains a coverage failure in evaluation. There are
148,694 training candidate rows but only 43 positive rows across repeated lead
times: these are not 148,694 independent trips.

## Algorithms

1. Candidate ranker: regularized logistic regression using distance, heading
   alignment, closing speed, location speed/accuracy/age, previous personal
   station counts, time/day, motion, steps, recent app interactions and packet
   context when available. All known stations within 25 km compete; the actual
   future station is never inserted into the candidate list.
2. Separate stop gate: classify whether the encounter will last three minutes,
   then use the ranker for the destination. Fixed 0.5 threshold, no class
   balancing for this gate. This conservative version abstained throughout the
   held-out replay. Scores are not calibrated probabilities.
3. Personal route memory: compare a fresh moving fix with the same person's
   previously observed approaches 1–15 minutes before completed encounters.
   Require distance within 300 m and heading within 45 degrees. The closest
   historical approach supplies the station only if that encounter was long;
   shorter encounters participate and veto a match when closest. Only completed
   past outcomes are eligible. No minimum-history threshold was tuned to these
   results; scenarios separately require 1, 2, 3, or 5 prior long stops and 2 or 3
   distinct prior long-stop stations.

Phone event recording/receipt delays remain causal; server upload delays are
ignored, as requested. Historical motion enters when received on the phone.
Labels, later dwell/departure and later pedometer/context data never enter an
advance prediction. Station coordinates come from the current static catalog;
historical availability of a station ID is enforced, but historical coordinate
snapshots are unavailable. Usage joins use the recorded installation link and
client event time. Model features do not contain account IDs, absolute personal
coordinates, device model or station-ID one-hot columns.

New packet/app-use features were constant or absent in the training period
before the October 12 instrumentation. Their value cannot be learned or ruled
out here. Arrival/departure, answers, post-visit steps, and detector candidate
flags are outcomes, not advance features.

## Results

Exact station ranking for the 13 later long visits (missing inputs count as
misses in the denominator):

| Lead | Ranker correct | Fresh-input opportunities | Nearest station correct | Heading baseline correct |
|---|---:|---:|---:|---:|
| 1 min | 8/13 | 10/13 | 6/13 | 9/13 |
| 3 min | 6/13 | 10/13 | 2/13 | 2/13 |
| 5 min | 3/13 | 9/13 | 1/13 | 0/13 |
| 10 min | 4/13 | 9/13 | 1/13 | 1/13 |
| 15 min | 3/13 | 8/13 | 1/13 | 1/13 |

These landmark tests retrospectively know a station encounter is approaching.
They do not measure a continuously running notification product. The ranker
alone incorrectly alerted at 72 of 73 short encounters with usable inputs five
minutes before arrival. Station ranking alone is insufficient for timing.

A separate clock replay evaluated every minute in the later observation window,
with 30-minute cooldown, at most two alerts/account/UTC day, and a candidate more
than 150 m away. Outcome: the next detected encounter within 15 minutes.

| Method / required personal history | Alerts | Correct long-stop station | Short-stop alerts | No observed encounter |
|---|---:|---:|---:|---:|
| General ranker | 22 | 1 | 9 | 12 |
| Separate stop gate + ranker | 0 | 0 | 0 | 0 |
| Personal route memory / at least 1 long stop | 7 | 3 | 4 | 0 |
| Personal route memory / at least 2 long stops | 6 | 2 | 4 | 0 |
| Personal route memory / at least 3 long stops | 6 | 2 | 4 | 0 |
| Personal route memory / at least 5 long stops | 6 | 2 | 4 | 0 |
| Personal route memory / at least 2 distinct stations | 6 | 2 | 4 | 0 |
| Personal route memory / at least 3 distinct stations | 6 | 2 | 4 | 0 |

The three successful personal-route predictions led arrival by 4.72, 6.13 and
2.22 minutes. They cover 3 of 13 later long stops; exact-destination precision
under this proxy definition is 3/7 (43%). The successes span two accounts,
including one outside the largest account. Requiring more history lost one
success without reducing the four short-stop alerts.

Repeat destinations have a stronger signal: at five minutes the ranker chose
3/6 repeat destinations versus 0/7 first-time destinations; at one minute, 5/6
repeat versus 3/7 first-time. These are different small subsets, not a controlled
estimate of the causal benefit of more history. Full history-count and
unique-station scenarios at every lead appear in `aggregate-results.json`.

## Interpretation and next evaluation

Personal history is promising, particularly repeated approaches to stations,
but this experiment does not identify a safe number of prior stops after which
predictions become reliable. The route rule still produces more short-stop
alerts than correct predictions. Keep it offline/shadow-only until a later,
untouched evaluation window provides substantially more outcomes.

The initial ranker/baseline comparison was evaluated first. The separate gate
and personalized route scenarios were added after seeing those results and the
user's subsequent instruction. Therefore the shared later window is exploratory
for these additions, not an untouched final validation set. No threshold or
scenario should be promoted merely because it looks best on this window.

A further experiment should freeze route-prefix matching and ambiguity/score
margin requirements, compare performance after 0/1/2/3/5 prior personal stops,
and track actual unwanted alerts and confirmed fueling separately. The current
observational negatives remain the user-requested proxy task.

## Reproduction and checks

Private inputs expected by `scripts/driving-research/backtestDestination.py`:
`research.json` (participant_id + event), `stations.json` (station_id + lat/lon),
and `usage.json` (installation_id, id, kind, occurred_at, payload). Export via
protected database read-only queries; never put these files in the repository.

```sh
python3 scripts/driving-research/backtestDestination.py PRIVATE_DIR OUTPUT_JSON
python3 tests/destinationPrediction.test.py
python3 tests/refuelAnticipation.test.py
python3 tests/refuelTiming.test.py
```

Requires NumPy. Eleven new tests cover future catalog/outcome exclusion, delayed
and stale inputs, precise dwell construction, history availability, motion-history
receipt times, repeated step-window deduplication, route negative veto and the
classifier's direction/weight handling. Thirteen existing causal tests also pass.
