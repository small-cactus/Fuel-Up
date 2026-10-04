# Second nationwide feature experiment

User requested stronger modeling and feature engineering on October 4. Preserve the first experiment and its frozen candidate as comparators. Research only, with no provider collection or production changes.

Reuse all 2,062,756 eligible national training examples and their exact labels. The first experiment already covered the full fixed inventory; missing prices are not synthetic training labels. Training features and labels remain before October 3 18:19 UTC. Existing development examples are exploratory selection data. October 5 18:19 through October 7 18:19 remains inaccessible final evaluation.

Add causal same-station fuel/payment relationships, historical spread-adjusted estimates, deviations from the station's own recent distribution, change/reversal statistics, and individual neighbor movement/age summaries. Current cross-grade observations must be available in the same completed response; historical spreads exclude the current hour. Neighborhood observations come only from previous hours. Never include target availability, future price, or station identity as a predictor.

Train absolute-error and squared-error boosted trees at multiple capacities and compare raw, sparse, and bounded corrections. Preserve every trial, model, parameters, input hashes and prediction. Select using development MAE with tail and harmful-correction diagnostics; do not claim parameter count or training accuracy as a win. Use feature ablations to identify useful signal. Keep the prior ±20-cent correction cap as a conservative comparator.

After choosing a candidate, freeze it before downloading additional development outcomes (hours after the first export). Evaluate that later slice once and report it separately, even if the candidate fails. This is a short sequential development check, not a replacement for the final two-day test. Audit causal invariance by perturbing future data and verify saved-model prediction replay. All prices remain provider-report proxies rather than verified pump truth.
