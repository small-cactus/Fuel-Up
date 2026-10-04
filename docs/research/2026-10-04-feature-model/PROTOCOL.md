# Second nationwide feature experiment

User requested stronger modeling and feature engineering on October 4. Preserve the first experiment and its frozen candidate as comparators. Research only, with no provider collection or production changes.

Reuse all 2,062,756 eligible national training examples and their exact labels. The first experiment already covered the full fixed inventory; missing prices are not synthetic training labels. Training features and labels remain before October 3 18:19 UTC. Existing development examples are exploratory selection data. October 5 18:19 through October 7 18:19 remains inaccessible final evaluation.

Add causal same-station fuel/payment relationships, historical spread-adjusted estimates, deviations from the station's own recent distribution, change/reversal statistics, and individual neighbor movement/age summaries. Current cross-grade observations must be available in the same completed response; historical spreads exclude the current hour. Neighborhood observations come only from previous hours. Never include target availability, future price, or station identity as a predictor.

Train absolute-error and squared-error boosted trees at multiple capacities and compare raw, sparse, and bounded corrections. Preserve every trial, model, parameters, input hashes and prediction. Select using development MAE with tail and harmful-correction diagnostics; do not claim parameter count or training accuracy as a win. Use feature ablations to identify useful signal. Keep the prior ±20-cent correction cap as a conservative comparator.

After choosing a candidate, freeze it before downloading additional development outcomes (hours after the first export). Evaluate that later slice once and report it separately, even if the candidate fails. This is a short sequential development check, not a replacement for the final two-day test. Audit causal invariance by perturbing future data and verify saved-model prediction replay. All prices remain provider-report proxies rather than verified pump truth.

## User-directed national and Qwen extensions

The nationwide-context network attends over all 51 state/DC tokens. Each token summarizes every available valid price of the target fuel/payment in that region: coordinates, quantiles, mean, count, report age/freshness, and past 1/6/24-hour movements. It receives the target's coordinates and station features. These are compressed national summaries, not a literal 141,660-record attention sequence. Each context is shifted to the previous completed hour.

The stale-price classifier predicts whether the next newer source report changes by at least 10 cents within 24 hours. Its labels cannot prove current physical pump staleness. Report average precision, prevalence, calibration and false alarms.

Fine-tune the public Apache-2.0 Qwen3-0.6B-Base checkpoint, pinned by revision. Use LoRA on its attention projections and learned numeric input/output projections: six station-feature tokens, two tokens containing all flattened national summaries, and a prediction token. This is a pretrained-backbone numerical adaptation, not text instruction tuning. Train on all eligible national examples, with a residual-regression and change-classification objective. Report actual total/trainable parameters, rows and numeric tokens seen, runtime and saved adapters. Do not claim architecture or parameter-efficiency superiority: these systems have different parameter counts and compute budgets.

Development selection considers raw price as a valid winner and restricts promoted experimental policies to a 20-cent cap with no increase in the combined rate of errors exceeding 10 cents or mean error on large changes. Larger caps remain sensitivity diagnostics only. All these are development guards, not production guarantees.

## Sampling audit and separate aging-quote task

An audit found 142,739/145,644 original development examples had source age under one hour, 2,905 had age 1–6 hours, and none had age over six hours. That source-event benchmark cannot establish stale-quote correction quality.

Add a separately reported query-time cohort: every 12 hours, with a deterministic station-index offset, sample the then-visible quote even if its source timestamp has not advanced. Labels still require an independently newer report within 24 hours, and missing labels remain unknown. Use the same train/development/final boundaries, causal features, raw baseline and error guards. Report ages, missing-target counts, right-censoring and repeated-quote dependence. Never compare MAE across different cohorts as if it were a model improvement. The original source-event results remain preserved.

The query-time cohort contains 858,713 training and 31,410 development examples. Of the development examples, 5,281 are aged 6–24 hours and 3,514 are aged 24–168 hours. There are 791,316 sampled queries without an available qualifying target, plus 84,418 boundary-purged cases. Retain these coverage limitations.

Prioritize this more relevant task: retain Qwen's first completed full-data epoch as the source-event checkpoint, then continue from its saved adapters and normalization on the query-time training data for two passes. Record the intentional early stop and exclude any discarded partial epoch from checkpoint-training claims. This continuation uses the original 47 station features plus the national context; the boosted trees and dedicated spatial networks additionally receive the 69 engineered features.

Also fit a directional transition mixture on the query-time cohort. Classify changes below -1 cent, within 1 cent, and above +1 cent, then fit separate absolute-change regressors for the two nonzero classes. The unchanged price remains an explicit probability mass. Evaluate fixed direction-confidence thresholds 0.5, 0.6, 0.75 and 0.9, with the same 20-cent cap; preserve all outcomes and false alarms.


## Later-slice freeze and exploratory lead-lag study

`FROZEN_CONFIRMATION.json` was written and pushed before exporting observations from 02:00 through 05:00 UTC on October 4 (deadline-filtered cutoff 06:00 UTC). It locks the source-event spatial ensemble and the query-time station-tree correction gated by the stale-proxy classifier. Exact checkpoint hashes and both development prediction hashes are included. The ongoing query-time Qwen continuation and direction-mixture model remain development-only challengers; they cannot replace these frozen policies on this later check. This short, right-censored slice does not replace the untouched final two days.

The correlation study independently examines matched-station hourly movements, update rates, state/common-market-adjusted leads, product/payment and initial-price/age cohorts. Nationwide discovery stays before hour 72. Historical daily crude and wholesale series and weekly retail gasoline provide separate longer-horizon experiments, with calendar and observation-frequency limitations documented. A 30-day lag can be computed from four current gasoline dates paired with older oil dates; four dates cannot reliably identify a durable delay. Historical forecast experiments use chronological fitting and at least eight-day external-feature lags, but current-vintage data and prior examination of the benchmark preclude claiming untouched confirmation.
