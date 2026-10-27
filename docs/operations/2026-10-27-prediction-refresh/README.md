# Fresh prediction replay and local ML experiments

Snapshot: **October 27, 2026, 15:42 UTC**. Unanswered predictions count as wrong. Code and aggregate evidence only; no app behavior, collection schedule, user labels or original price-research objects changed.

## Data growth

| Evidence | October 22 | October 27 |
|---|---:|---:|
| Uploaded events | 184,733 | 249,959 |
| Observed station encounters | 531 | 691 |
| Confirmed purchases | 18 | 24 |
| Unanswered encounters | 490 | 641 |
| Purchase-to-purchase intervals | 15 | 21 |
| Comparable durable-mileage intervals | 8 | 14 |
| Intervals without recorded gaps/boundaries | 1 | 1 |
| Accounts with repeat purchases | 2 | 2 |

The 24 confirmed purchases are concentrated in three accounts: 19, 4 and 1. There are 17 accounts with exported events, not 17 independently validated drivers. The export includes 163,522 relevant events; geofence and station-catalog events are excluded from replay. Every included kind's row count matches the database cutoff.

## Advance station prediction

Every emitted prediction without a confirmed correct station-and-purchase outcome fails the primary score. This includes unanswered, absent encounters and incomplete outcome windows. A suppressed prediction earns no credit. Original labels remain unchanged.

| Policy | All data correct / predictions | New period correct / predictions |
|---|---:|---:|
| Habitual station | 1/73 (1.4%) | 0/42 |
| Single route-point match | 1/36 (2.8%) | 0/20 |
| Three-point route sequence | 5/18 (27.8%) | 1/9 (11.1%) |
| Sequence, every point within 150m | 5/16 (31.3%) | 1/8 (12.5%) |
| Sequence, every point within 100m | 5/15 (33.3%) | 1/7 (14.3%) |
| Sequence, two prior station purchases | 5/14 (35.7%) | 1/5 (20.0%) |
| Sequence, consistent mileage cycles | 2/8 (25.0%) | 1/4 (25.0%) |
| Sequence, familiar purchase time ±1h | 5/11 (45.5%) | 1/3 (33.3%) |

New period begins October22 14:10 UTC. The original three policies retain exactly their earlier-window prediction and correct counts. The time-of-day filter removes failures while retaining all five historical successes; it is an exploratory candidate, not a validated production winner. All five successes are from one account and one station, 3.36–6.38 minutes before arrival. Every sequence variant still makes more wrong than correct predictions in the newest period.

## Models actually trained

Local scikit-learn logistic regression and random forest classifiers predict whether to emit a familiar-station candidate. Training precedes October18; validation runs until October22 14:10; test data comes afterward. Entire outcome horizons are embargoed at boundaries. Labels and preprocessing respect availability; no random split of neighboring GPS points.

Training contains 440 minute rows but only **four distinct positive purchases from one account**. Validation has 93 rows and one positive purchase. Test has 582 rows across two accounts and two distinct positive candidate purchases. These are not 1,115 independent labeled refueling decisions.

| Model at predeclared 0.5 threshold | New-period correct / predictions | Distinct purchases caught |
|---|---:|---:|
| Logistic regression | 1/17 (5.9%) | 1 |
| Random forest | 1/5 (20.0%) | 1 |
| Time-of-day sequence rule | 1/3 (33.3%) | 1 |

Neither model qualified for a validation-selected threshold under the predefined minimum-success/coverage rule. The forest's minute-level average precision was 0.682, but its emitted-alert precision was only 20%; a high ranking metric must not be presented as reliable alerts. Fitted models and per-decision rows remain private and are not deployed.

## Mileage and TimesFM 3

More comparable intervals do **not** establish miles since a full tank. No tank quantity/full-tank fields were found in the exported research payloads, and every recorded `completeOdometer` claim was false. A confirmed purchase may be a partial fill.

Across 14 receipt-aligned intervals, the durable ledger captured 2,389.74 miles versus 2,373.04 from the saved GPS replay: **0.70% more distance**. This is a coverage comparison, not an accuracy measurement against a vehicle odometer. All six newly comparable intervals contain gaps or collection boundaries.

The latest comparable ledger snapshots show 58.14 and 146.20 captured miles since the last confirmed purchase for the two repeat-purchase accounts. Those spans include 10 and 163 recorded gaps respectively; parked time may explain some gaps, while recovered automotive activity demonstrates that some gaps contain travel. Neither number is actual odometer mileage since a full tank.

Eight usable supervised mileage examples exist, all from one account. Requiring four earlier labeled examples leaves four expanding-window test forecasts. Models learn only from prior examples available at each forecast time.

| Method, identical four newest targets | Mean absolute error in captured miles |
|---|---:|
| Last-three-cycle median | 68.77 |
| Ridge regression | 70.35 |
| Random forest regression | 76.31 |
| **TimesFM 3, zero-shot** | **65.54** |

TimesFM improves this four-target result by 3.22 miles (4.7%). Across all eight eligible forecasts it scores 47.19 miles versus the median's 50.17. This is too small a sample, with too much residual error, to establish dependable low-fuel detection. TimesFM is evaluated on purchase-cycle order, not evenly spaced calendar days. Context is just 3–10 prior intervals. It was not fine-tuned or used for station classification.

Official TimesFM code: `e51928e27119cb17bebc005be2696b75e0a9e688`; checkpoint revision `43046b85ec22d584a13f8098c2ed39c889e129c2`. Inference ran offline on the Mac using MLX. [Upstream documentation](https://github.com/google-research/timesfm) specifies a separate non-commercial license for downloaded 3.0 weights; this result is not a production deployment recommendation.

## Improving without more manual input

1. Use sequence plus familiar purchase time for quiet candidate ranking, with explicit uncertainty. Do not promote the current scores into confident fuel alerts.
2. Separate advance intent prediction from post-arrival purchase evidence. The existing habitual-stop rule matched **13/13 later confirmations**, including **3/3 new predictions**, after 180–251 seconds at a station. All came from one account. This supports testing a provisional purchase anchor; it does not justify recording a confirmed purchase or full tank automatically.
3. Improve travel coverage and distinguish stationary gaps from unmeasured driving before tuning range models. Existing GPS uncertainty, recovered motion, audio and step timing are more relevant next features than larger models alone.
4. Keep confirmed and provisional anchors separate. Unanswered-as-wrong is the evaluation rule, not permission to fabricate actual nonpurchase labels or missing mileage.
5. See [the Apple API audit](APPLE-INPUTS.md) for additional signals and access limits.

## Reproduction and verification

`exportSnapshot.mjs PRIVATE_DIRECTORY CUTOFF` exports read-only data outside the repository with restricted permissions and checks exact per-kind counts. Run the audit scripts with that directory, aggregate output path, and cutoff. `auditRouteWindow.py` additionally accepts the new-period boundary. ML requirements are pinned in `scripts/driving-research/requirements-ml.txt`; optional TimesFM requires the pinned upstream checkout with its MLX extra and a separately downloaded local checkpoint. `testTimesFM3.py` additionally accepts the checkpoint directory and upstream commit.

Artifacts: `snapshot.json`, `mileage.json`, `automatic-inference.json`, `routes.json`, `route-ml.json`, `mileage-ml.json`, `timesfm3.json`, and `PROTOCOL.md`. Source and input hashes are embedded. Reports use anonymous account indices; indices are per-report ordering, not persistent identity keys.

Verification: 47 offline unit tests passed across route scoring, mileage coverage, automatic inference, mileage readiness and ML causality; exporter syntax and Git whitespace checks passed. Original-window baseline counts were reproduced exactly. No simulator or phone interaction was needed for these offline changes.
