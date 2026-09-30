# Recommendation quality, not average price error

The user's correction is right: the product objective is choosing the cheapest
eligible reliable station, not predicting every station equally well. For example,
99 exact predictions and one quote 50 cents too low produce only 0.5 cent average
error, yet that false bargain can send the user somewhere 30 cents/gallon more
expensive. At 12 gallons, that is $3.60 before wasted travel.

The primary future evaluation should measure **top-choice regret** (chosen actual
price minus cheapest eligible actual price), wrong-winner frequency, large-regret
frequency, and how often a stale low quote falsely takes first place. Measure
coverage/abstention too, so a policy cannot win by simply declining hard cases.
MAE remains a secondary diagnostic. Age alone is not proof a quote is false.

## What the stored evidence supports

The follow-up [protocol](../../../scripts/price-model/RANKING_PROTOCOL.md) retains
all candidates before choosing, including those with no later label. The original
forecasting dataset excluded unlabelled quotes, which can remove exactly the
long-stuck low prices of greatest concern.

From September's 173 stored write batches: 2,186 valid raw selected-grade candidate
rows, 848 with a subsequently observed newer source report within 48 hours. After
separating cash and credit, 11 single-candidate cash batches are excluded from
ranking. **None of the 173 multi-candidate batches has complete future labels.**
Only 100 distinct quote sets remain after keeping the first occurrence of each
origin/fuel/payment/station/source-time/price signature. Repeated source events
still occur across distinct sets; these are not 100 independent trials.

These stored batches are not guaranteed to be full cache-filled API responses,
and user membership/preferences are absent. This is a price-only batch audit,
not a replay of actual app recommendations. Targets are asynchronous later reports,
not contemporaneous verified pump truth; even target source times within two
hours do not resolve that limitation.

## Frozen policy diagnostic

No retraining or threshold tuning. Below, the winner must have a future label
and at least one labelled alternative whose source time is within two hours of
the winner's target. Loss is against the cheapest such observed alternative.
Zero witnessed loss is **not** proof of selecting the true cheapest station.

| Policy | Unknown chosen outcome / 100 | Comparable choices | Witnessed later-report losses | Largest witnessed loss |
| --- | ---: | ---: | ---: | ---: |
| Raw quote | 85 | 10 | 2 | 2¢/gal |
| Current displayed-price rules | 75 | 14 | 3 | 14¢/gal |
| Ridge | 78 | 16 | 2 | 2¢/gal |
| Huber | 80 | 15 | 2 | 2¢/gal |
| Small neural network | 81 | 12 | 0 | 0¢/gal |

Additional cases have a labelled winner but no comparable labelled alternative.
**These unequal and highly selected denominators cannot establish a winner.**
In particular, the neural net's zero cannot be interpreted as 100% success.
The raw-price policy's 85 unknown winners also make its low MAE insufficient
evidence for recommending stale low quotes. Full and deduplicated summaries,
48-hour permissive comparisons, and per-case evidence are in
[ranking-results.json](ranking-results.json).

## Verification and reproduction

Standalone JSON inference reproduces all 830 original ridge, Huber, and neural
predictions within 1e-10. Default forecasting dataset rebuilding remains byte-for-
byte identical; the separate ranking mode retains unknown targets and replays.
Tests cover an unknown cheap winner, small MAE with large selection regret,
missing alternatives, mismatched report times, and label-independent selection.

```sh
node scripts/price-model/buildDataset.cjs docs/research/2026-09-30-price-model/history-snapshot.json.gz /tmp/fuelup-ranking-snapshots.json --ranking-snapshots
node scripts/price-model/scoreRanking.cjs /tmp/fuelup-ranking-snapshots.json docs/research/2026-09-30-price-model /tmp/ranking-results.json
node --test tests/priceModelDataset.test.cjs tests/priceRanking.test.cjs tests/priceValidation.test.cjs tests/fuelGradeValidation.test.mjs
```

For a trustworthy promotion gate, record the full eligible choice set, selected
station, raw/estimated provenance, and decision timestamp; collect independent
near-time labels for the winner and plausible cheaper competitors, including
stuck quotes. Reserve a new future period. Until then, keep both the primary
selection outcome and its missing-label rate explicit rather than claiming
superiority from average prediction error.
