# Price forecasting experiment v1 — September 30, 2026

**No learned replacement passed.** We fitted statistical models and two small
neural networks, and evaluated local Tev1. On this chronological test, retaining
the reported price had lower average next-report error than the current adjustment
logic or any learned replacement. **This does not establish better station
selection.** A single stale bargain can win the ranking and harm the user while
barely affecting average error. See the follow-up [recommendation audit](RANKING.md)
and [one-shot OpenAI comparison](OPENAI.md). No production policy, animation, or
selection code changed.

The target is the **next observed newer report within 48 hours**, not a verified
pump price. A later change does not prove the earlier report was already wrong.
This experiment therefore measures forecasting and a correction-risk proxy;
it cannot establish actual false-price detection accuracy.

## Data and leakage controls

The [fixed protocol](../../../scripts/price-model/PROTOCOL.md) was written before
fitting. The archived [input history](history-snapshot.json.gz) contains 9,095 rows
from the prior audit, excluding user UUIDs. Models use only each row's selected
grade and explicit raw cash/credit amount. Repeated source reports are deduplicated,
cash and credit histories remain separate, and observation time controls availability.
Source timestamps alone do not make a report available to an earlier prediction.

| Split | Observation period | Examples | Corrections >= 10¢ | Stations |
| --- | --- | ---: | ---: | ---: |
| Train | March 4–April 14 | 299 | 96 | 94 |
| Validation | April 15–May 1 | 426 | 84 | 196 |
| Test | September 28–29 | 105 | 14 | 62 |

113 samples crossing split label boundaries were purged. Labels after the sample's
observation were never features. Unchanged newer reports remain controls. Model
settings and alert thresholds were selected on validation, not test results.
25 of the 62 test stations appeared in training; this is repeat-station forecasting,
not a station-disjoint generalization test. Station IDs and names were excluded
from learned features. Membership-brand status was a categorical feature.

Existing math received the same causal history scope used by production: exact
rounded area and selected-fuel bucket, prior 14 days, at most 1,500 rows. Learned
features used that scope with deduplicated raw peers. Features include quote age,
peer price gap/spread/freshness, prior station price, existing heuristic outputs,
fuel/payment category, and local hour. Local hour uses FL/CA/CO time zones. A
Colorado timezone preparation bug was corrected before final scoring; only seven
training examples changed, no validation/test Tev1 inputs changed. Models were
refitted; initial outputs were not used to choose settings.

This is still small, request-driven, selectively observed history, with no samples
from June–August. It does not represent a continuously sampled population of all
stations, nor all the long-stale quotes for which no future label was observed.

## Price results

Error is against the next observed newer report, in cents per gallon.

| Method | Validation MAE | Test MAE | Test errors >10¢ too low / too high |
| --- | ---: | ---: | ---: |
| Keep reported price | **4.32¢** | **2.71¢** | 0 / 6 |
| Current displayed-price rules | 7.74¢ | 6.28¢ | 0 / 15 |
| Current unbuffered prediction | 13.26¢ | 8.28¢ | 4 / 24 |
| Nearby median | 13.90¢ | 12.04¢ | 4 / 28 |
| Ridge regression | 7.93¢ | 14.13¢ | 0 / 74 |
| Huber robust regression | 6.59¢ | 13.39¢ | 0 / 69 |
| Small boosted trees | 6.57¢ | 14.33¢ | 0 / 62 |
| Small neural network | 7.72¢ | 13.09¢ | 5 / 59 |
| Tev1 expected correction bucket (failed numeric-control gate) | 85.18¢ | 83.96¢ | 105 / 0 |

Boosted trees won among fitted regression families on validation but lost badly
on the later test. The unchanged-price baseline had already beaten every fitted
family on validation. It would be incorrect to promote the tree just because it
won the learned-family comparison.

Current rules increased test MAE over raw price by 3.56¢, with a station-cluster
bootstrap 95% interval of +0.55¢ to +8.46¢ (1,000 resamples). The small neural net
was 6.82¢ worse than current rules, interval +2.11¢ to +10.32¢. These intervals
describe this small held-out sample, not future pump-price reliability.

The data's price direction changed sharply: training has **88 material increases
and 8 decreases**; validation 42 of each; test **1 increase and 13 decreases**.
The fitted models mostly predicted increases. This supports a distribution-shift
explanation, but is not a controlled causal ablation proving which feature caused it.

## Detecting a material future correction

Positive means the next report differs by at least 10¢, in either direction.
Thresholds below were chosen by validation F1. This objective does not sufficiently
penalize annoying false alarms; the observed collapse is a reason not to deploy it.

| Detector | Test true positives / 14 | False positives / 91 | Test Brier (lower better) |
| --- | ---: | ---: | ---: |
| Never flag (control) | 0 | 0 | 0.133 |
| Current risk score, threshold .05 | 12 | 64 | 0.171 |
| Current actual adjustment decision | 0 | 9 | 0.219 |
| Fitted logistic regression, threshold .15 | 14 | 91 | 0.237 |
| Small neural classifier, threshold .05 | 14 | 87 | 0.203 |
| Tev1, threshold .20 | 14 | 91 | 0.139 |

The neural classifier's average precision was 0.229 versus 0.168 for the current
risk score, but it was poorly calibrated and selected an unusably permissive
threshold. That isolated ranking metric does not establish a better usable detector.
Tev1 at a conventional .50 threshold instead flagged nothing and missed all 14
corrections. A negative forecast label is not proof that the current price is true.

## Tev1 specifics

Used the already installed **Tev1 0.8B Q8_0**, 752.39M parameters, Ollama 0.35.0,
on the user's RTX 5080. Model digest:
`d45e875d63fed9465390a4eb9e55f51f470390a446667b55d0a075a15e0336bf`.
This was zero-shot decision inference, not fine-tuning or a parameter-matched
comparison with the fitted networks. It used the documented
[`/v1/systemone` decision API](https://www.ollama.com/library/tev1).

All **531 validation/test calls succeeded**, with 1,302–1,406 input tokens.
Actual loaded context was 2,050 despite the 4,096 server environment request;
every measured call fit within the loaded context. Median warm local HTTP latency
was **172.8 ms**, p95 **191.9 ms**, excluding SSH and initial model loading.
Requests and data stayed on the user's machines; no hosted model API was used.

The fixed prompt provided causal numeric features and asked for a correction from
13 signed price-change buckets. Tev1 selected the first (-$1) bucket on **531/531**
calls. Probability weighting reduced the magnitude but did not repair forecasting.
The headline failure applies to this model/prompt/quantization, not every possible
Tev1 configuration. We did not tune prompts against the test to manufacture a win.

After this failure, diagnostic controls checked explicit zero corrections,
simple subtraction, reordered options, and numeric versus descriptive option names.
Tev1 passed **12/12 three-choice controls**, but only **10/12 controls with the same
13-choice format** as the experiment. Both failures selected -$1 for an explicitly
unchanged $5 price in the ascending option order. This is a failed numeric-control
gate: the reported 83.96¢ is a result for this unsuitable setup, not a fair estimate
of Tev1's general forecasting ability. API index mapping works on the other controls,
but the model/prompt cannot be trusted with this numerical choice format.
[Controls](tev1-controls.json) are explicitly post-experiment diagnostics, not
additional held-out quality evidence. No prompt was retuned on test labels.

The experiment server listened only on Windows loopback port 11439. The runner
stopped its own server afterward; other user services were not stopped.

## Artifacts, verification, and reproduction

The fitted neural price model and classifier each have **609 parameters**, two
hidden layers (16, 8), ReLU, with separate output heads/models. Both selected seed
47 and 120 Adam epochs on validation. No random validation split was used.
Local CPU inference including scaling was about 0.08 ms per row (warm microcheck;
not a phone or full-request performance benchmark).

- [Price network](tiny_mlp_price.json), [classifier network](tiny_mlp_stale.json),
  [ridge](ridge.json), [Huber](huber.json), [logistic](logistic.json).
- [Dataset](dataset.json), [all fitted-model predictions](predictions.json),
  [settings/results/intervals](results.json).
- [Tev1 label-free inputs](tev1-inputs.json), [raw results](tev1-results.json),
  [scores](tev1-scores.json), [runtime and prompt](tev1-metadata.json).
- [Export checks](artifact-checks.json): restored both neural networks from their
  JSON weights and reproduced all 830 predictions exactly.
- Dataset leakage/payment/purge tests and existing price/grade tests: **17/17 pass**.

Local training used an isolated Python 3.13.3 environment on Mac-127.lan, ARM64,
with NumPy 2.5.3 and scikit-learn 1.9.1. System SciPy could not load, so the system
environment was not modified. Dependencies are pinned in
[requirements](../../../scripts/price-model/requirements.txt).

From the repository root:

```sh
python3 -m venv /tmp/fuelup-price-model-venv
/tmp/fuelup-price-model-venv/bin/pip install -r scripts/price-model/requirements.txt
node scripts/price-model/buildDataset.cjs docs/research/2026-09-30-price-model/history-snapshot.json.gz /tmp/price-model-dataset.json
node --test tests/priceModelDataset.test.cjs tests/priceValidation.test.cjs tests/fuelGradeValidation.test.mjs
# fit.py expects dataset.json in the output directory. Use a fresh directory
# and copy the rebuilt dataset there to retain these original experiment results.
OMP_NUM_THREADS=1 /tmp/fuelup-price-model-venv/bin/python scripts/price-model/fit.py /path/to/new-output-directory
```

Tev1 scripts run under `C:\Users\antma\fuel-price-experiment-20260930`, using the
existing model/runtime in `C:\Users\antma\tev1-benchmark`. `runTev1.ps1` owns and
cleans up its server. `tev1.py` reads the committed label-free input schema and
exports results; `scoreTev1.py` scores them locally. Full regression tree fits can
be regenerated from the fixed data/settings; exported small neural/linear models
are standalone research artifacts, not loaded by the app.

## Decision

Keep this as a failed promotion experiment. Do not replace the backend with these
weights, treat Tev1 probabilities as verified reliability, or conclude that old
quotes are safe simply because the unchanged baseline won this sparse sample.

First fix per-grade timestamps, distinct raw/estimated provenance, unconditional
newer-report acceptance, and recommendation eligibility identified in the
[backend audit](../2026-09-30-price-reliability/README.md). Collect deduplicated
observations continuously and reserve an entirely new future test period before
trying age/volatility-aware shrinkage or retraining on the newer market. The useful
current finding is that automatic price replacement is overcorrecting this test;
it is not yet evidence for a model that can promise the correct pump price.
