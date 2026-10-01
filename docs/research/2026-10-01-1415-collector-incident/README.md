# October 1 collector incident: optional brand resolver

14:15 national event 41 halted collection after HTTP 200 GraphQL errors. The saved first ten errors were internal station-service ECONNRESET failures, already classified as transient; the deciding error was lost by truncation. Run 549 (14:00) ended partial: 56/72 batches, 109,960 station observations. These are genuine coverage gaps, not backfilled data.

Added bounded full-list classification diagnostics, preserving original errors and all denial handling. Twenty-nine regression checks passed before deployment. After the recorded cooldown expired and city requests succeeded, the guarded `resume.sql` made diagnostic recovery attempt 1 through existing Cron (event 42).

That scheduled request failed at 15:28 (events 43/44). Full diagnostics now show 1,398 `INTERNAL_SERVER_ERROR` / `Brand get failed` errors. The optional `brands{name}` resolver introduced with metadata enrichment caused this second failure. The query now omits that optional field; names, coordinates, address, ratings and exact raw prices remain. Existing cached brand metadata is retained by JSON merge. No partial/error response was accepted or published. No provider identity, region, pacing or denial policy changed.

All three workers are deployed; six provider-free regional health checks pass (`brand-repair-regions.json`). Query/error/worker regression tests pass, including explicit exclusion of the failing resolver.

**Recovery pending:** the recorded cooldown ends 2026-10-01 16:28:04.429593 UTC. It has not been shortened or cleared. The existing ten-minute monitor now carries a one-time instruction to inspect state after expiry and run `resume-brand-repair.sql` (attempt 2 of at most 3) only if all guards hold. It must verify successful scheduled jobs and immutable archive read-back before claiming recovery. No successful archive exists for this attempted recovery yet.

Both main Cron schedules/watchdogs remain active, and archive capacity was 38.7 MB of the 900 MB budget. Raw observations, existing historical gaps, and original failure evidence remain intact. Research windows still end October 7 at 18:19 UTC.
