# Recommendation audit v2

September 30, 2026: post-experiment diagnostic prompted by the user's correction.
The original test has already been examined. This is not a fresh held-out test,
and no model or threshold will be selected or tuned from these results.

Primary product objective: avoid recommending a station that costs more than an
eligible alternative. Evaluate top-choice regret, wrong-winner frequency, severe
regret (>=10 cents/gallon), and false-cheap winners. Price MAE is secondary.
Ultimately these require contemporaneous, independently verified prices and the
actual eligible candidate set at each decision (fuel, payment, membership, range).

Available approximation: each September stored batch, grouped by exact write
timestamp, rounded search origin, selected fuel, and payment. Keep all valid raw
quotes, including repeated reports and candidates without subsequent labels.
These batches may not contain every station in the actual cache-filled response;
user membership/preferences are not stored. This is a price-only batch audit,
not a replay of actual recommendations.

Use the already frozen ridge, Huber, and neural price model weights without
refitting, alongside raw price and the reconstructed current rules. Choose the
lowest predicted price across the entire batch; station ID is the deterministic
tie break. Never filter by future-label availability before choosing.

Targets remain the next independently newer same-station/grade/payment report
observed within 48 hours. First report time must advance >5 minutes. No target
means unknown, not unchanged or correct. A later report is not proof of the pump
price at the original decision time.

Report two comparisons: all available future-labelled alternatives, and the
subset with target source timestamps within two hours of the winner's target.
The latter reduces timing mismatch but still does not establish simultaneity.
For a labelled winner with at least one comparable labelled alternative, report
max(0, winner target - cheapest comparator target). This is a regret lower bound
against partially observed *later reports*, not actual trip regret. Zero is not
proof of a correct choice. Without a labelled winner/comparator, report unknown.
Count a false-cheap-winner proxy only when this regret is positive and the winner's
target exceeds its displayed/predicted selection price by >=10 cents.

Report candidate/label/full-batch coverage and unknown winners for every policy.
Do not compare policy rates as if they share the same labelled denominator.
Repeated requests are dependent: provide an additional earliest-only summary
deduplicated by origin/fuel/payment plus station IDs, raw prices, source times.
Do not calculate statistical confidence from independent-request assumptions.
No deployment or production changes are authorized by a diagnostic win here.
