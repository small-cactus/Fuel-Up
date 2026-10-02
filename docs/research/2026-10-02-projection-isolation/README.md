# Isolate immutable research collection from the app projection

The 10:00 UTC run expired with 61/72 batches (119,960 station IDs); the 11:38 check found the next hour at 0/72 with the same metadata RPC failures. City collection continued with 972 successes and 32 unchanged historical misses. The database maintenance/availability issue remains unresolved; this repair addresses a collector dependency exposed by that incident.

## Repair attempt 2

Previously, an optional metadata lookup prevented raw collection, and archive publication shared a transaction with app projection updates. A timeout in either step therefore lost research progress or retried an already-fetched response.

The worker now tolerates only recognized database availability errors in the optional metadata lookup. It records a lease-fenced diagnostic before fetching the normal prices-only query. Permission/authentication failures and unknown errors still fail closed. The exact station IDs, provider response validation, request pacing, fixed regions, archive hashes, budgets, campaign deadlines and provider denial handling remain unchanged.

After uploading the immutable object, the worker commits its manifest through the existing fenced archive RPC. It then attempts app projection publication separately. A projection failure is recorded as `SERVING_DEFERRED_*` and returned as pending; it cannot roll back research or trigger another provider request. Existing app data is not deleted or filled with estimates. Its latest-price projection can remain stale until database availability recovers and subsequent scheduled batches publish successfully. There is no automatic replay of failed projection writes in this change.

`record_fuel_national_projection_event` restricts event codes and accepts only the exact job lease token, either still running within its lease or already archived successfully. Anonymous and authenticated clients cannot call it. Original incident events and missed jobs remain preserved. No attempt counts were reset and no schedules were manually triggered.

## Validation and deployment

- 36 focused Node tests passed, including timeout fallback, fail-closed permissions, archive-before-projection order, stale lease rejection, provider error rejection and raw archive validation.
- Protected live SQL tests verified diagnostic fencing and privilege boundaries, with all fixture writes rolled back. The new function was first tested inside a rolled-back migration transaction, then applied and tested again.
- All three regional worker deployments succeeded. Six provider-free regional health checks passed, including rejection of incorrect execution regions.
- Live scheduled recovery and immutable read-back verification are reported below when available. Deployment and tests alone do not prove recovery.


## Repair attempt 3: bounded optional work

After the first deployment, no new archives appeared and old leases expired without diagnostics. The database gateway sometimes never returned a statement timeout before the worker expired. Both optional calls now abort after five seconds, with a separately identifiable `CLIENT_TIMEOUT` diagnostic. Two additional tests exercise requests that never settle and verify actual cancellation. This prevents optional RPC waits from consuming the entire 90-second research lease. The second deployment of all three workers and six regional health checks succeeded.

The existing Trends publication gate requires every job's hash-matched trend summary before publishing a completed run. Deferred station projections therefore cannot falsely label an old/incomplete app snapshot as the newly completed research hour.

## Verification blocker at 11:52–11:54 UTC

`worker-audit.json` shows the scheduled workers in all three regions returning HTTP 503 `DATABASE_CLAIM_FUEL_NATIONAL_REGION_JOB_FAILED`. They cannot reach the repaired metadata/archive path. At 11:52, run 1654 still had zero archived batches; it remains before its 12:00 deadline and is not represented as an expired missing hour.

A protected Data API diagnostic using `fuel_station_metadata_needed` with an empty ID list returned HTTP 503 `PGRST002`: “Could not query the database for the schema cache. Retrying.” A claim-RPC diagnostic used an intentionally invalid region, which the function must reject before any job mutation or provider request; it returned the same schema-cache failure. This isolates a Supabase Data API availability blocker rather than an access denial or a failed provider batch. No API credentials were printed or stored.

Recovery is **not verified**, and there are no newly successful archives to read back. The three automatic attempts for this incident are exhausted: the platform-owned maintenance cancellation was denied, projection isolation was tested/deployed, and bounded optional RPCs were tested/deployed. A Supabase project/service restart or support intervention is now required if the Data API does not recover automatically. No further automated repair is attempted in this incident. Existing Cron remains enabled and will resume against the repaired workers when the Data API becomes available.

Coverage at the checkpoint: 27 complete national hours; five partial hours including October 2 10:00 at 61/72 batches (119,960 IDs, approximately 84.7% of the fixed catalog); five historical unstarted hours; the current 11:00 hour still in progress. No new city gap was observed in the 11:38 status. Capacity remained within the existing database and archive budgets. Provider observations and all original failure evidence remain immutable; none of these records establish pump truth.
