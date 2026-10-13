# Richer fueling signal study — October 13, 2026

There is exploratory predictive signal close to arrival and a personal daily fueling pattern in the largest account. There is **no demonstrated reliable early-warning system, generalization to new people, or tank-capacity estimate**. This study adds 103 causal predictors, full correlation matrices, four model families across eight lead times, chronological validation, experience scenarios, and a clock-based replay. It sends no notifications and changes no app behavior.

## Data and outcomes

Protected read-only snapshot: 66,996 research events, 999 installation-usage events, and 1,015 static station coordinates. Eight research accounts exist in the snapshot; four have completed station encounters. Accounts are numbered by research event count, not identified as people. Only usage linked by an explicit installation ID is joined. Raw IDs, routes, event times, and per-example feature rows remain outside this repository.

| Anonymous account | Completed station encounters | At least 3 minutes | Confirmed fuel purchases |
|---|---:|---:|---:|
| 1, largest account | 184 | 15 | 7 |
| 2 | 56 | 7 | 1 |
| 3 | 14 | 2 | 0 |
| 4 | 6 | 0 | 0 |
| Total | 260 | 24 | 8 |

The user-requested target is a detected encounter lasting at least 180 seconds, with the other 236 shorter encounters as negatives. Two short encounters ended in a tracking gap; they remain negatives under that requested comparison but are potentially censored. Duration uses last-inside time, not a delayed departure receipt. The 2,080 feature rows are eight views of the same 260 encounters, not independent visits.

**Duration is an imperfect proxy for buying gas:** among 16 answered long encounters, eight were labeled `fueled`, five `not_fueling`, and three `not_a_stop`. Six answered shorter encounters were labeled `not_a_stop`. Unanswered encounters cannot establish fuel-purchase truth. Raw telemetry volume is much larger than the number of independently answered outcomes.

## Correlation matrix and inputs

- [Readable matrix](correlation-matrix.png), also [PDF](correlation-matrix.pdf).
- [Full 104-by-104 matrix](correlation-matrix-full.csv): 103 predictors plus the duration target.
- [Sample counts for every matrix cell](correlation-matrix-pair-counts.csv).
- [Every feature's coverage](feature-coverage.csv), [correlations at every lead time](feature-correlations.csv), and [displayed signals](top-training-signals.csv).

The primary matrix uses five-minute-before-arrival features and pairwise Spearman correlation, requiring at least 20 observations per cell. The readable figure displays 18 features selected by their correlation on data completed before October 11; its cells describe the full snapshot. Gray/missing cells mean insufficient data or variation. Descriptive within-account correlations are also supplied after demeaning ranks within each account. No p-values or significance claims are made after exploring this many comparisons.

Input families: recent speed, acceleration/deceleration proxies, turning, position age/accuracy, altitude, known-station distance/heading/closing speed/density, past same-station counts, prior route matches including short-encounter negative evidence, prior stop/fuel intervals, observed driving distance and time since those outcomes, motion state, recovered motion, recovered steps/distance/floors/pace, battery/power/thermal/background-refresh state, network state, app-observable audio route, recent app opening, screen views, map movement, station selection, Go actions, and geofence transitions. Station identity and the future destination are not supplied as timing-model predictors.

Some promising-sounding new inputs barely overlap the outcomes yet. At the five-minute cutoff, battery and recent-open context are present for only 20/260 encounters; step-history totals are present for just 1/260. Motion state is present for 232/260. Missing optional measurements remain missing, with imputation fitted only on training data. Zero recorded UI actions does not prove the person did nothing.

| Five-minute signal | Earlier correlation | Later correlation | Interpretation |
|---|---:|---:|---|
| Average speed over previous 3 minutes | +0.276 | +0.204 | Modest repeatable association with a coming long stop |
| Speed change over previous minute | −0.151 | −0.246 | Slowing down is associated with a coming long stop |
| Speed variability over previous 10 minutes | +0.228 | +0.123 | Weaker movement signal |
| Heading toward nearest known station | +0.156 | +0.102 | Weak directional signal |
| Geofence entries in previous 30 minutes | +0.242 | +0.009 | Earlier association does not replicate |
| Observed km since confirmed fuel | +0.150 | −0.037 | No stable range-based signal demonstrated |
| Prior positive route match | +0.191 | −0.052 | Not stable at this particular five-minute cutoff |

Earlier/later refer to completed pre-October-11 training encounters versus cutoffs on/after October 11. Sample sizes differ by field; see CSV. Position quality, collection frequency, location, participant differences, and repeated trips can confound correlations. Slowing near a station is a useful candidate signal, not proof of purchase intent.

## Chronological model comparison

For each UTC day October 9–13, train only on encounters whose terminal outcome was available before that day, then evaluate that day's later encounters. Four fixed families were compared: regularized logistic regression, class-balanced logistic regression, shallow random forest, and shallow boosted trees. Each lead time is a separate experiment. Features need at least 20 nonmissing training observations and variation. No random row split, future station injection, or backdating recovered sensor history is allowed. Server upload is assumed instant as requested, while on-phone receipt and answer times are respected.

Average precision summarizes ranking of rare positive outcomes; higher is better. The daily base-rate predictor provides a comparator. These are **encounter-conditioned** results: evaluation happens before known future station encounters, so these numbers alone do not validate notifications during ordinary driving.

| Lead before detected arrival | Test encounters / long stops | Daily base-rate AP | Logistic AP | Balanced logistic AP | Forest AP | Boosted AP |
|---|---:|---:|---:|---:|---:|---:|
| 30 seconds | 191 / 21 | .104 | .300 | .251 | .279 | .261 |
| 1 minute | 191 / 21 | .104 | .221 | .184 | .250 | .263 |
| 3 minutes | 190 / 21 | .105 | .256 | .195 | .311 | .267 |
| 5 minutes | 187 / 21 | .107 | .176 | .170 | .219 | .199 |
| 10 minutes | 184 / 21 | .109 | .142 | .143 | .110 | .149 |
| 15 minutes | 182 / 21 | .111 | .108 | .110 | .097 | .098 |
| 30 minutes | 164 / 19 | .115 | .097 | .101 | .090 | .081 |
| 60 minutes | 143 / 17 | .113 | .175 | .196 | .118 | .132 |

The near-arrival results suggest a signal worth pursuing. Fifteen- and thirty-minute forecasts do not improve on the baseline here. The isolated 60-minute improvement is inconsistent across models and is not evidence of a dependable hour-ahead warning. Exploration includes multiple models, features, and horizons on a small dataset; it has no untouched final holdout. For example, the three-minute forest's account-day bootstrap 95% AP interval is approximately .192–.466, reflecting considerable uncertainty.

Full metrics, daily folds, per-account results, experience scenarios, and bootstrap intervals: [results.json](results.json).

## Actual clock replay: the important check

Three promising model/lead combinations were challenged on every UTC minute with a fresh accepted GPS fix (at most 120 seconds old), speed at least 2.5 m/s, and no currently known active station encounter. This yields 1,536 eligible driving minutes across the replay dates, **not complete continuous coverage**. Models retrain daily on only prior completed encounters. Would-be notifications require score >=.5, with a 30-minute cooldown and maximum two per account per UTC day. These scores are not calibrated probabilities.

Outcome: the next detected encounter within 15 minutes. A shorter encounter cannot be skipped to match a later long stop. No observed encounter is recorded separately as unknown, not a confirmed false positive. There are 21 observed long-stop targets in the replay dates.

| Model training cutoff | Would-be alerts | Later long stop | Later short stop | No observed encounter | Lead for matched long stops |
|---|---:|---:|---:|---:|---|
| Forest, 1 minute before arrival | 6 | 2 | 3 | 1 | 2.1, 2.7 minutes |
| Forest, 3 minutes before arrival | 6 | 3 | 3 | 0 | 1.4, 3.7, 4.1 minutes |
| Logistic, 30 seconds before arrival | 4 | 3 | 0 | 1 | 8, 43, 58 seconds |

The three-minute forest's three successes are **confirmed fuel purchases**, all in the largest account. It catches only 3/21 recorded long-stop targets and emits three other alerts before short stops. The near-arrival logistic model has two confirmed purchases and one unanswered long stop, plus one unmatched alert. Raising the threshold to .8 produces no alerts for any of the three models. This does not establish deployment-ready precision or adequate coverage.

No reliable advance notification for the other testers is demonstrated. These are further exploratory comparisons after seeing the encounter results, not independent final validation. [Full replay evidence](continuous-replay.json).

## Learning after observing a few stations

Experience buckets use only prior completed long stops; they do not require future outcomes or repeat a target in training. The three-minute forest's encounter-conditioned results are:

| Prior long stops | Test encounters / positives | Correct / incorrect alerts at .5 |
|---|---:|---:|
| None | 25 / 2 | 0 / 0 |
| 1–2 | 14 / 3 | 0 / 0 |
| 3–5 | 36 / 6 | 0 / 0 |
| 6+ | 115 / 10 | 3 / 3 |

All six alerts are in the two-or-more-distinct-stations scenario. This is compatible with needing personal history, but it does **not** prove that six stops are a sufficient learning threshold: history count is confounded with account identity, calendar date, and repeat routes. The pooled model has not been evaluated on a sufficiently large set of entirely held-out people.

## Fill-up windows and tank capacity

The largest account has seven answered fuel purchases, giving only six observed inter-fill gaps: **69.73, 28.05, 21.40, 24.34, 22.78, and 24.86 hours**. The latest five cluster around a day, with a median of 24.34 hours and range 21.40–28.05 hours. The smallest observed inter-fill gap is 21.40 hours. Missing or unlabeled purchases could shorten these gaps; they are not necessarily complete tank cycles.

A causal personal forecast based on the median of up to three previous inter-fill intervals gives:

| Confirmed fills already known | Forecast error for next fill |
|---|---:|
| 3 | 27.49 hours late |
| 4 | 3.70 hours late |
| 5 | 1.56 hours late |
| 6 | 2.07 hours early |

Each forecast is made only after the preceding visit has ended and its fueling answer is available. A window of roughly **±4 hours around the estimate** would contain the last three forecasts, after at least four known fills. That is an eight-hour illustrative window supported by **three cases in one account**, not a calibrated reliability guarantee. The earlier forecast fails badly. There is not enough evidence to claim a stable narrower window, or an equivalent pattern in other testers; account 2 has only one answered fill.

Different meanings of “smallest window” should remain separate:

- **Before the trip / next-fill scheduling:** a personal daily pattern, currently only exploratory at ±4 hours after enough history.
- **While approaching a station:** the tested model finds some events 1.4–4.1 minutes ahead, with three short-stop alerts alongside three successes.
- **Time actually spent at the station:** answered fueling encounters span about 3.38–9.50 minutes. This is observed station dwell, not measured pumping time or dispensed volume.

**Tank capacity cannot be identified from these packets.** No measured gallons, tank capacity, odometer, MPG, or fuel-level fields were found in either export. Between confirmed fills the captured valid driving segments total roughly 186–346 km, but maximum GPS gaps range from 8.2 to 23.5 hours. Those segment totals are incomplete, noisy travel estimates. A purchase can also be a partial top-up, and the dataset does not establish vehicle consistency or empty-to-full cycles.

The app already contains an `11.5`-gallon default in `predictiveFuelingProfileStore.js` and separate range-estimation defaults. These are assumptions, not observed measurements; this analysis does not treat them as labels or tank estimates. Useful additions for estimating consumption would be actual gallons and whether the tank was filled completely, plus odometer/distance coverage and a known vehicle. Vehicle tank capacity could be supplied separately; stop duration alone cannot estimate it reliably.

## Practical next experiment

Keep an offline/shadow two-stage candidate: a personal cycle estimate for a broad readiness window, then fresh driving/deceleration/known-station approach features to narrow timing. This combination is a proposed next experiment, not a measured improvement in this report. Freeze the current predictors and thresholds, collect future independent answered outcomes from multiple testers, and evaluate missed purchases plus false alerts per driving day before any live notification rollout. More correlated sensor rows cannot substitute for those outcomes.

## Reproduction and validation

Scripts: `richTimingFeatures.py`, `buildRichTimingDataset.py`, `analyzeRichTiming.py`, `replayRichTiming.py` under `scripts/driving-research/`. Private input directory contains `research.json`, `stations.json`, and `usage.json`; the builder emits `rich-features-private.csv`. The replay also caches `clock-features-private.csv` there. Clear that private cache when inputs or feature code change. Neither private table should be committed.

```sh
python3 scripts/driving-research/buildRichTimingDataset.py PRIVATE_DIRECTORY
python3 scripts/driving-research/analyzeRichTiming.py PRIVATE_DIRECTORY/rich-features-private.csv OUTPUT_DIRECTORY
python3 scripts/driving-research/replayRichTiming.py PRIVATE_DIRECTORY
```

Analysis used Python 3.13, NumPy 2.5.4, pandas 2.2.3, SciPy 1.18.1, scikit-learn 1.9.1, and matplotlib 3.10.1. Isolated analysis packages resolved a broken pre-existing system SciPy binary; no app dependency changes were made. Input hashes and cycle aggregates are in [cycle-summary.json](cycle-summary.json). The snapshot is frozen; later uploads are outside this study.

Validation: causal cutoff invariance, delayed receipt/recovered history, missing context, duplicate step/action handling, known-outcome timing, replay cooldown/daily budget, earliest-encounter matching, and separation of stop-duration labels from fueling answers. Existing destination, anticipation, and timing gates are rerun. See [validation.txt](validation.txt). Charts were visually inspected. No app build or simulator gate is relevant to this offline-only change.
