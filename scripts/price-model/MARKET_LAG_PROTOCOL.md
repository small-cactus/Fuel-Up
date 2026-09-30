# Causal market-lag approach v1

Frozen September 30, 2026 before the new seven-day collection has a second hour.
Research only: do not load this prototype into app rankings or overwrite reports.

Priority objectives: worst-5% mean extra price at the selected eligible station,
large false-cheap winner frequency, worst-5% price loss, then overall price loss.
Do not improve a one-sided underestimation score by raising every quote. Keep
genuine held-price discounts as hard negative controls.

Estimator: preserve each station's own earlier price as its discount anchor;
estimate subsequent local movement using matched station pairs, equal-weighted
brand medians, same grade/payment, and causal observation times. Require at least
five peers across three brands, four actually moving upward, direction agreement
>=60%, and a coherent nontrivial movement. Repeated identical prices or advanced
source timestamps do not themselves restore trust. Only uplift unexplained lag;
never reduce a legitimate high report. With insufficient evidence, preserve raw
price and explicitly return the reason. All changes are estimates, not corrected
observations or proof of fraud. Fixed v1 shrinkage=.75, 48-hour context, anchor at
least six hours old; no test-driven tuning of these settings.

Two diagnostic tracks:
1. Existing historical next-report proxy, reconstructed strictly causally, on
   the same 464 common candidate rows as the earlier benchmark. This already
   examined data is not a new holdout and has weak/missing outcomes.
2. Fixed seeded synthetic stress cases: controlled stale quotes despite refreshed
   timestamps, coherent market shocks, stationary markets, real held-price
   bargains, and station-specific movement. Score known simulated truth and
   selected-station regret separately. Synthetic improvements are not evidence
   of real-world correction accuracy. Include an indistinguishable pair where
   the same observed low quote is either genuinely held or stale: no algorithm
   can recover which without additional evidence.

Seven-day prospective protocol (starts 2026-09-30T18:19:00Z): days 1-3 build
features/fit candidate weights; days 4-5 choose settings; days 6-7 remain untouched
until selection is frozen. Split labels by observation availability, purge targets
crossing boundaries, and retain missing-outcome counts. Fit future candidates
against both tail-sensitive and mean losses; a model must not buy tail gains by
materially degrading ordinary quotes or genuine discounts. A later crowd report
remains a proxy, not pump truth, even if its timestamp changes.

Collect all returned grades with independent cash/credit source times, actual
request/observation times, station identities, brands, coordinates, and candidate
sets. Keep every hourly snapshot, including identical reports, for continuity;
deduplicate source events for statistical evidence. Missing stations/hours stay
missing. Do not manufacture retrospective samples after an outage. First-page
city results are a provider-selected panel, not complete city coverage.

Measure dropouts, unchanged-price timestamp churn, genuine price changes, matched
peer movement, source/observation lag, raw-vs-estimated provenance, and coverage.
Further architecture work can use a latent-price/state-space or small tabular
model, but real truth is partially unidentifiable from this provider alone.
Do not claim physically optimal accuracy or assured fraud detection from these
records. Promotion requires future tail/mean evidence and trustworthy winner
labels; otherwise retain the model in research/shadow evaluation.

## Development follow-up: scenario minimax

The v1 synthetic genuine-held-price counterexample produced unacceptable
overcorrection and selection regret. Added a mathematically derived comparison,
without fitting new weights: retain [reported price, anchored market scenario],
use the midpoint for minimax absolute price error within that interval, and choose
the station minimizing `max(0, upper_i - min(lower_j for j != i))`. These intervals
are uncalibrated hypotheses, not guaranteed price bounds. Evaluate this candidate
as development evidence on the same stress families; it is not a new holdout.
The same observed quote can represent a real discount or a stale report, so
neither scenario can simply be deleted to claim perfect correction.
