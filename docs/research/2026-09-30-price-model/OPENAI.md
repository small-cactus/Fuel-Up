# One-shot station selection with OpenAI models

Follow-up: [95th-percentile and worst-slice analysis](TAIL-RISK.md) separates
absolute price error, one-sided false-bargain risk, and selection regret.

**No demonstrated station-selection improvement.** Tested 100 distinct historical
candidate sets per model, one request per case, with the same frozen prompt and
actual station history sequences. No tools, examples, follow-up corrections,
retries, fine-tuning, or production changes. This is a diagnostic on previously
examined September data, not a fresh promotion test.

GPT-6 Luna and GPT-5.6 Terra ran with reasoning **none**; recorded reasoning tokens
were zero. GPT-6.1 Sol ran at **low**, explicitly approved by the user because
its API does not support none. The account's available Terra model is 5.6 Terra,
not a fabricated GPT-6 Terra. See official model documentation for
[Luna](https://developers.openai.com/api/docs/models/gpt-6-luna),
[Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra), and
[Sol 6.1](https://developers.openai.com/api/docs/models/gpt-6.1-sol).

## Temporal inputs

The initial three API smoke calls used historical summaries. Before the full
run, the user requested actual time sequences. The main run adds up to eight
independent source reports per candidate, oldest observation first, with price,
source age, first/last cache observation age, and replay count. Repeated cache
copies do not count as independent confirmations. All history was available
strictly before each decision, within the existing 14-day / 1,500-row market
scope. Later labels and later replay observations cannot enter inputs.

Among 1,306 candidate entries across the 100 sets:

| Prior independent reports supplied | Candidate entries |
| --- | ---: |
| 0 | 348 |
| 1 | 623 |
| 2 | 268 |
| 3 | 43 |
| 4 | 13 |
| 5 | 11 |

Thus 26.6% have no prior history and 47.7% only one prior report. Models can compare
station sequences and nearby stations' changes, but there is often insufficient
history to infer a reliable cadence. Request-driven source times are not pump
change times. Station identities, names, coordinates, and user data were excluded
from API inputs; only arbitrary IDs and causal numeric features/history were sent.

Frozen trained models use historical summary features; GPT sees richer temporal
sequences and every candidate together. This compares practical policies, not
architecture alone. Three earlier feature-only smoke outputs are retained but
excluded from this main experiment; none was scored to tune the new prompt.

## Primary result: selection cost

Full [results](openai-results.json) apply the [ranking protocol](RANKING.md): unknown
chosen outcomes remain unknown. Pairwise comparisons below require later reports
for both policies' chosen stations, with target source times within two hours.
They compare those **later reports**, not verified simultaneous pump prices.

| Policy | Valid answers / attempts | Comparable choices vs current rules | Cheaper / same / dearer than rules | Median request time |
| --- | ---: | ---: | ---: | ---: |
| GPT-6 Luna, none | 95 / 100 | 15 | 0 / 14 / 1 | 2.74 s |
| GPT-5.6 Terra, none | 100 / 100 | 17 | 0 / 16 / 1 | 3.86 s |
| GPT-6.1 Sol, low | 100 / 100 | 14 | 0 / 14 / 0 | 7.12 s |

Luna's five responses contained extra malformed JSON content despite the requested
strict schema. They were retained as failures, with no repair or second call.
These failures are not scored as correct choices. Sol used 4,999 reasoning tokens
across the 100 calls; none-mode models used zero. Latency includes network and
generation, measured with up to three concurrent requests per model; it is not
a controlled isolated hardware benchmark. p95: Luna 3.95 s, Terra 4.79 s, Sol 9.05 s.

Direct recommendations differed from current rules on 50/95 valid Luna cases,
45/100 Terra cases, and 38/100 Sol cases, but most different choices cannot be
judged from the stored outcomes. Unknown winner labels: Luna 66/95, Terra 73/100,
Sol 83/100. No batch has a complete set of future-labelled candidates.

Against the frozen small neural network, the assessable paired choices were
Luna 0 cheaper / 8 same / 2 dearer (10 pairs), Terra 0 / 11 / 1 (12), and Sol
0 / 13 / 0 (13). Against the frozen boosted tree: Luna 0 / 9 / 1 (10), Terra
0 / 11 / 1 (12), Sol 0 / 14 / 0 (14). These tiny, dependent, differently observed
subsets cannot establish overall superiority or equivalence.

The worst witnessed choice for Luna and Terra was RaceTrac at a later-reported
$5.04 versus an eligible membership station at $4.68: **36 cents/gallon** extra
in this price-only experiment. Membership access was explicitly assumed for
every candidate; actual user eligibility is not recorded in these stored batches.
The two targets were reported less than an hour apart, still not independent
verification of what either pump charged at the original decision time.

Selecting each model's **lowest predicted price** instead of its explicit
recommendation produced all ties against current rules on the assessable paired
cases: Luna 15/15, Terra 18/18, Sol 15/15. This is saved as a separate policy,
not selected after the fact as a claimed winner. It exposes a distinction between
the model's numeric predictions and its chosen recommendation.

## Secondary result: next-report price error

Use the identical 464 labelled candidate rows across the 95 cases with valid
responses from all three models. These are correlated candidate observations,
not 464 independent stations. Missing future labels remain excluded **only from
this numeric error metric**, never from the original candidate selection.

| Method | Mean absolute next-report error |
| --- | ---: |
| Raw quote | 2.75¢ |
| Current rules | 6.76¢ |
| Ridge | 11.65¢ |
| Huber | 13.44¢ |
| Boosted tree | 12.30¢ |
| Small neural network | 20.88¢ |
| GPT-6 Luna, none | 4.84¢ |
| GPT-5.6 Terra, none | 5.61¢ |
| GPT-6.1 Sol, low | 3.32¢ |

GPT predictions beat the adjustment rules and fitted models on this secondary
metric, but this does **not** establish better recommendations. Sol is closest to
the next reports among the tested GPT configurations; retaining the raw quote
has lower MAE yet leaves most chosen outcomes unknown. None of these findings
validates stale bargain selection. No broad conclusion about model capability
follows from this one prompt, sparse local history, or small observed subset.

## Evidence and reproduction

- [Fixed protocol](../../../scripts/price-model/OPENAI_PROTOCOL.md),
  [frozen prompt and causal inputs](openai-history-inputs.json).
- Raw request results: [Luna](openai-history-gpt-6-luna-none.jsonl),
  [Terra](openai-history-gpt-5.6-terra-none.jsonl),
  [Sol](openai-history-gpt-6.1-sol-low.jsonl).
- [Scored choices, matched comparisons, usage and latency](openai-results.json).
- [Original tree reconstruction check and inference](ranking-tree-predictions.json).
  Its predictions match all 830 original outputs exactly; no new training data,
  hyperparameter search, or test-based setting changes were used.

```sh
# First rebuild ranking snapshots using RANKING.md.
python3 scripts/price-model/test_price_history.py
python3 scripts/price-model/openaiBenchmark.py --prepare
# Paid calls require OPENAI_API_KEY or OPENAI_API_KEY_FILE supplied externally.
# Existing result files are resumable; completed/failed cases are never retried.
python3 scripts/price-model/openaiBenchmark.py --model gpt-6-luna
python3 scripts/price-model/openaiBenchmark.py --model gpt-5.6-terra
python3 scripts/price-model/openaiBenchmark.py --model gpt-6.1-sol --effort low
OMP_NUM_THREADS=1 /tmp/fuelup-price-model-venv/bin/python scripts/price-model/restoreTree.py /tmp/fuelup-ranking-snapshots.json docs/research/2026-09-30-price-model
node scripts/price-model/scoreOpenai.cjs /tmp/fuelup-ranking-snapshots.json docs/research/2026-09-30-price-model
```

24 Node tests plus 2 Python history tests pass. They cover retained unknown cheap
candidates, causal history and replay counts, grade/payment separation, timeline
matching, label-free scoring, and recommendation-versus-price selection. Original
forecasting dataset reconstruction remains byte-identical. Production behavior
and the pinned clustering version remain unchanged.

The temporary credential file was removed after the calls. No key is in these
artifacts. Requests used `store:false`; this flag does not make a promise about
all provider-side logging or retention. Rotate the key pasted into the chat.
