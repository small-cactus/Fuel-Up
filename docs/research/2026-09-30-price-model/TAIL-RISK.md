# Worst-slice price error

**Sol 6.1 has the smallest absolute-error tail among the tested prediction
methods, but leaving raw quotes alone still has a smaller tail. No method has
demonstrated reliable correction of false-cheap winners.** This is a post-hoc
re-score of existing frozen outputs, not additional training or API calls.

Use the identical 464 labelled candidate observations from the 95 cases with
valid outputs from all three GPT configurations, spanning 62 stations. The five
malformed Luna responses remain failures outside this numeric comparison.
Labels are the next independently newer report observed within 48 hours, not
verified pump prices at decision time. Unlabelled stale bargains are missing.

## Each method's worst errors

All numbers are cents/gallon. P95 is the 95th-percentile absolute error, using
linear interpolation at `(n-1)*.95`. Worst-5% mean averages the largest
`ceil(.05*n)` errors (24 here); it captures severity beyond the percentile cutoff.

| Method | P95 absolute error | Mean of worst 5% | Maximum |
| --- | ---: | ---: | ---: |
| Raw quote | 11.00 | 13.29 | 20.00 |
| Current rules | 20.95 | 34.51 | 56.00 |
| Ridge | 21.15 | 23.49 | 33.69 |
| Huber | 25.18 | 28.20 | 33.15 |
| Boosted tree | 24.05 | 28.42 | 42.68 |
| Small neural network | 43.66 | 46.19 | 47.84 |
| GPT-6 Luna, none | 15.00 | 21.83 | 32.00 |
| GPT-5.6 Terra, none | 20.00 | 33.42 | 60.00 |
| GPT-6.1 Sol, low | 12.00 | 13.90 | 22.00 |

These tails contain different rows for each method, so they cannot alone answer
whether a model corrects the *same* troublesome quotes. The next comparison fixes
the hard cases before comparing methods.

## Correcting the same worst slice

Take our rules' worst 5% by absolute error, including ties at the cutoff: 24 rows
across 13 stations, each with at least 21 cents error under the rules.

| Method | Mean error on those same 24 rows | Improved / worsened versus rules |
| --- | ---: | ---: |
| Current rules | 34.51¢ | — |
| Raw quote | 5.58¢ | 24 / 0 |
| Ridge | 15.12¢ | 24 / 0 |
| Huber | 14.81¢ | 24 / 0 |
| Boosted tree | 13.20¢ | 21 / 3 |
| Small neural network | 13.14¢ | 22 / 2 |
| GPT-6 Luna | 17.17¢ | 23 / 1 |
| GPT-5.6 Terra | 28.33¢ | 19 / 2 |
| GPT-6.1 Sol | 8.82¢ | 24 / 0 |

Sol reduces the mean error of this rules-defined worst slice by about 74%, but
raw prices do better still. This mainly demonstrates damage from adjustments on
these examples, not successful recovery of false raw quotes.

Now fix the worst **raw-quote** slice instead: 31 rows across just six stations,
including all ties at the 11-cent cutoff. Raw error is 12.77¢; Sol is 12.54¢,
improving 10 rows, worsening 10, and tying 11. Every other tested method has a
larger mean error on this slice. Sol's 0.23-cent improvement here is small and
does not support a useful correction claim. **All 31 raw errors are too high**
relative to the subsequent report, so this slice does not represent stale cheap
quotes taking first place.

## The dangerous direction: predicting too low

The loss here is `max(later_report - predicted_price, 0)`, computed over all 464
rows; overestimates contribute zero. P95 alone can conceal rare severe misses.

| Method | P95 too-low loss | Mean of worst 5% too-low losses | Largest underestimate |
| --- | ---: | ---: | ---: |
| Raw quote | 2.00¢ | 4.50¢ | 10.00¢ |
| Current rules | 2.00¢ | 6.85¢ | 30.40¢ |
| Ridge | 0.00¢ | 0.40¢ | 2.83¢ |
| Huber | 0.00¢ | 0.96¢ | 4.90¢ |
| Boosted tree | 0.00¢ | 0.48¢ | 4.85¢ |
| Small neural network | 0.28¢ | 5.06¢ | 12.85¢ |
| GPT-6 Luna | 0.00¢ | 2.33¢ | 9.00¢ |
| GPT-5.6 Terra | 2.00¢ | 13.50¢ | 60.00¢ |
| GPT-6.1 Sol | 3.00¢ | 5.94¢ | 14.00¢ |

Ridge has the smallest one-sided tail here, but it mostly raises predictions:
257/464 predictions are more than 10 cents too high. Penalizing only
underestimation rewards inflating prices, which can hide the true bargain and
produce a worse recommendation. Therefore this is not a winning selection policy.
Terra's 2-cent P95 despite a 60-cent underestimate illustrates why the tail mean
and maximum also matter.

## Repetition and missing outcomes

Deduplicating to the earliest available observation of each station/fuel/payment/
source/target report pair leaves 105 pairs; the worst 5% then contains only six
rows. The absolute tail conclusion remains: raw worst-5% mean 13.50¢, Sol 14.83¢,
Luna 28.17¢, Terra 46.67¢, current rules 51.50¢. Repetition changes the other
models' tails substantially; there is no independent-sample confidence claim.

Actual selection regret remains the primary product objective. On common cases,
only 10–21 choices per policy have a labelled winner and a labelled comparator
within two hours. Unknown cases number 74–85 of 95. Their nominal worst-5% means
are just one or two observations and cannot estimate a dependable 95th-percentile
user outcome. The JSON retains these as explicitly flagged diagnostics, never
as a leaderboard. See [the selection audit](RANKING.md) for candidate-set and
eligibility limitations.

For the next untouched evaluation, prioritize the worst-5% mean of **selection
regret**, with a cap on severe false-cheap winners, and report the missing-label
rate. P95 alone can hide a disastrous rare recommendation. Collect near-time
outcomes for apparent bargains and their eligible competitors; do not remove
unlabelled winners or count them as correct. No production policy is changed.

## Reproduce

[Full metrics and fixed-slice cases](tail-risk-results.json). All prices are
reconstructed from frozen model outputs; the mean-error checks reproduce the
previous benchmark exactly. Tests cover percentile interpolation, tail size,
one-sided loss direction, and fixed-slice ties.

```sh
# Rebuild /tmp/fuelup-ranking-snapshots.json using RANKING.md if needed.
node scripts/price-model/tailRisk.cjs /tmp/fuelup-ranking-snapshots.json docs/research/2026-09-30-price-model
node --test tests/priceTailRisk.test.cjs tests/priceRanking.test.cjs
```
