# Price reliability experiment v1

Frozen before training, September 30, 2026. Research only; no backend deployment.

Input is the audit's immutable 9,095-row export, fetched 2026-09-30T16:31:02Z.
Use only each row's selected fuel grade and raw payment amount. Require explicit
credit/cash provenance and valid source time. Deduplicate identical source
reports; exclude conflicting prices at the same station/grade/payment/time.

One sample per independent source report, at its earliest observed cache time.
Label with the first subsequently observed report for that station/grade/payment
whose source time advances more than five minutes, observed within 48 hours.
Unchanged-price updates remain negative examples. This label is the next observed
newer report, NOT a verified pump price or proof the earlier price was false.
Unobserved future reports are excluded rather than treated as unchanged.

Features use only history available strictly before the sample observation plus
the incoming quote. Use the existing server's exact area/fuel scope, 14-day
lookback and 1,500-row cap. Historical raw reports are deduplicated for statistical
features. Run existing math on the same historical scope as an explicit baseline.
Do not backdate observation availability to provider source time.

Chronological split: train before April 15; validation April 15–August 31;
final test September 1 onward. Drop train/validation samples whose labels arrive
after their split boundary. No random train/test split, station-ID feature, or
future peer price. Station overlap across dates is permitted for the real repeat-
station forecasting task and must be disclosed. Keep test untouched until model
selection is complete; select settings only on validation data.

Price target: signed next-report minus raw-price delta in dollars/gallon.
Baselines: unchanged raw price, existing displayed math, unbuffered math estimate,
nearby median. Candidates: ridge (alpha 1/10/100), Huber (epsilon 1.35/2), small
boosted trees (7 leaves, 30/80 iterations), and MLP (16,8), Adam, seeds 11/23/47,
30/60/120/240 epochs. Scale from training data only. Select each family by
validation MAE. Classification target: absolute next-report correction >= $0.10;
fit logistic regression (C .01/.1/1/10) and the same small MLP with a separate
classification head. Select by validation Brier score; choose alert threshold on
validation F1, retaining 0.5 metrics too. This is a proxy, not calibrated truth.

Tev1: existing local 0.8B Q8_0, Ollama systemone decision API. No fine-tuning.
Provide only causal feature values, no station name/ID/date/label. Ask whether
the next report differs by >= $0.10 and choose a signed correction bucket.
Use a fixed prompt and fixed delta bins, without test-driven prompt tuning.
Report probability-weighted expected delta and chosen-bin delta, classification
quality, failed calls, context/token budget, and inference latency. No hosted API.

Report MAE, RMSE, within 5/10 cents, correction-subset error, underestimation over
10 cents, Brier/AP/ROC, precision/recall/false alarms. Bootstrap differences by
station (1,000 resamples, fixed seed) to reflect repeated-station dependence.
Report counts, split date ranges, class balance, station overlap, and meaningful
limitations. A tiny historical win does not authorize deployment or establish
pump-price accuracy. Save code, features, predictions, settings, and small model
artifacts for reproducibility; do not save authentication material.
