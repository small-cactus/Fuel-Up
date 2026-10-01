# October 1 collector incident: optional brand resolver

14:15 national event 41 halted collection after HTTP 200 GraphQL errors. The saved first ten errors were internal station-service ECONNRESET failures, already classified as transient; the deciding error was lost by truncation. Run 549 (14:00) ended partial: 56/72 batches, 109,960 station observations. These are genuine coverage gaps, not backfilled data.

Added bounded full-list classification diagnostics, preserving original errors and all denial handling. Twenty-nine regression checks passed before deployment. After the recorded cooldown expired and city requests succeeded, the guarded `resume.sql` made diagnostic recovery attempt 1 through existing Cron (event 42).

That scheduled request failed at 15:28 (events 43/44). Full diagnostics now show 1,398 `INTERNAL_SERVER_ERROR` / `Brand get failed` errors. The optional `brands{name}` resolver introduced with metadata enrichment caused this second failure. The query now omits that optional field; names, coordinates, address, ratings and exact raw prices remain. Existing cached brand metadata is retained by JSON merge. No partial/error response was accepted or published. No provider identity, region, pacing or denial policy changed.

All three workers are deployed; six provider-free regional health checks pass (`brand-repair-regions.json`). Query/error/worker regression tests pass, including explicit exclusion of the failing resolver.

**Recovery verified (16:40 UTC):** attempt 2 resumed existing Cron after the recorded cooldown expired. Successful immutable archive samples from all three assigned regions passed hash, exact station-ID, price-schema and provenance checks. The 16:00 sweep is still running; this is recovery verification, not full-hour completion. Original failure evidence and historical gaps remain below.

Both main Cron schedules/watchdogs remain active, and archive capacity was 38.7 MB of the 900 MB budget. Raw observations, existing historical gaps, and original failure evidence remain intact. Research windows still end October 7 at 18:19 UTC.

## 16:24 UTC monitor checkpoint

The shared cooldown still ends at 16:28:04.429593 UTC. No recovery or provider
request was attempted, and no provider event newer than 44 exists. All four
main/watchdog schedules remain active, with zero Cron failures in the last
30 minutes and zero wrong-region jobs. Archive usage remains 38,727,743 bytes
of 900,000,000; database size is 250,088,595 bytes including the new Trends
read projection.

The 15:00 national run is now expired at 0/72 batches. There are nine complete
hours, four partial run rows (one with zero successes), and five expired
unstarted hours. The unstarted 16:00 hour is still before its deadline and is
not counted as failed. City totals are 496 successful / 32 missed slots and
9,920 observations; 14 additional misses accumulated during the existing
cooldown. This evidence is saved in `heartbeat-1624.json`. Attempt 2 remains
pending under the existing guarded recovery instructions.


## 16:35–16:41 UTC guarded recovery

The guards in `resume-brand-repair.sql` passed at 16:35:08.359102 UTC: the
recorded cooldown had expired, the incident matched, no newer denial existed,
and the campaign/budget limits permitted resumption. Attempt 2 enabled the
existing scheduled collector and recorded `USER_AUTHORIZED_BRAND_QUERY_RECOVERY`.
The cooldown value was neither shortened nor cleared. This monitor made zero
provider requests; Cron performed collection with unchanged identity and routing.

All 30 query/error/region/archive regression tests passed
(`brand-recovery-tests.tap`). Six provider-free regional checks passed
(`brand-recovery-regions.json`), including rejection of wrong-region requests.
`auditRegionalSample.mjs` downloaded and verified one successful immutable batch
from each assigned region: 3,960 station records total. It checked compressed
size and SHA-256, exact manifest station IDs, raw price schema and regional
provenance. Evidence is in `brand-recovery-archive-sample.json`; this sample
must not be treated as a complete-hour audit or verified pump truth.

At 16:41 UTC, run 566 had progressed to 23/72 successful batches; both western
regions were complete and Virginia was continuing. There were no new provider
errors following recovery, no wrong-region jobs, and no Cron failures in the
last 30 minutes. All four main/watchdog schedules remained active. City
collection reached 518 successful / 32 missed slots and 10,360 observations,
with no due queue at the 16:40 check. Archive usage was 41,819,437 of 900,000,000
bytes; database size was 279,235,731 bytes. `brand-recovery-after.json` contains
the timestamped snapshots (independent queries may show different progress).

Expected-hour accounting remains nine complete historical hours, four partial
hours and five expired unstarted hours. The current 16:00 hour is running
before its deadline and is not a new failure. All prior gaps remain preserved.
The raw-price serving policy remains priced stations reported within 24 hours,
without estimates; no production ranking or app behavior was changed.
