# One-shot OpenAI comparison

September 30, 2026. User requested GPT-6 Luna, Terra, and GPT-6.1 Sol without
reasoning. Account model listing and official documentation resolve Terra to
GPT-5.6 Terra. Luna/Terra support `none`. Sol 6.1 requires at least `low`; user
explicitly approved a separate low-reasoning comparison.

Use the first occurrence of each of the 100 distinct quote sets in the ranking
audit, including missing future outcomes. No selection based on label availability.
One Responses API call per model/case, fixed prompt, structured numeric output,
no tools, no examples, no training, no follow-up repairs or automatic retries.
Use `store:false`; only anonymized candidate feature values leave the machine.
No coordinates, station IDs/names, user information, future prices, target
availability, or observed benchmark performance enters the prompt.

Each model returns per-candidate next-report price, probability of an upward
correction >=10 cents, and one recommended ID. Score that direct recommendation
and the lowest predicted price separately. Frozen learned models use individual
feature vectors; GPT also sees all candidate vectors together. This is a practical
policy comparison, not a controlled neural-architecture comparison.

Use RANKING_PROTOCOL.md's partial-label and timing restrictions. Compare policies
on the same cases with assessable choices as a separate paired diagnostic, and
report how many cases survive. MAE on the identical labelled candidate rows is
secondary. Missing chosen labels remain unknown. Zero witnessed losses does not
establish success or superiority. Do not choose a model for production from this
small, previously examined test period. Save actual model IDs, usage, zero
reasoning-token verification for `none`, latency, outputs, failures and prompt.
An API key is supplied at runtime, never in code or version-controlled artifacts.

## User-directed temporal inputs (before full run)

After one API smoke call per model, the user requested actual station price
sequences, not only historical summary features. Those three feature-only calls
are retained as `openai-gpt-*.jsonl` with `openai-inputs.json`; they are excluded
from the main benchmark. No outcomes from them were scored or used to tune.

The main `openai-history-*` run adds each candidate's last eight independent raw
source reports observed strictly before the decision, within the same 14-day,
1,500-row history scope as the rules and learned features. Include price, source
age, first/last observation age, and replay count; exclude conflicting reports.
No later observation can increase those replay counts. Multiple cache copies
remain one source report. Report actual history coverage and sparse-data limits.
This gives GPT more temporal detail than the frozen models' summary features;
any difference cannot be attributed to model architecture alone.
