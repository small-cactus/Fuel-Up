# October 12 16:14 UTC database timeout incident

The 15:09 UTC nationwide check had 112 complete operational hours, four previously reported partial hours, no expired absent/running slots, and a current-hour sweep within deadline. This incident began after that verified snapshot.

At the 16:14 UTC check:
- Protected CLI queries failed while creating the temporary login role: HTTP 544, connection terminated due to connection timeout. A sequential retry ended with HTTP 524.
- Two bounded service-role REST reads (national config and latest health) each timed out after 12 seconds. A subsequent config read timed out after 20 seconds.
- Protected infrastructure metrics returned HTTP 504.
- The dashboard initially showed Unhealthy, then Healthy. The latter did not establish recovery: direct reads still failed.
- Database logs showed statement timeouts (57014 at 16:12:14 and 16:16:11 UTC), connection/SSL EOF errors, and cron startup timeouts for national dispatch, cache publication, watchdog and projection repair at 16:13–16:15 UTC. Some dispatch calls completed at 16:16, so this was degraded/intermittent database service, not evidence of a deliberate collection pause or provider denial.

## Recovery attempt 1

At approximately 16:18 UTC, requested one project restart through Supabase Settings > General. Dashboard confirmed Restarting. No configuration, provider budgets, billing, collection identities/routes, raw objects, research retention boundaries or campaign activation were changed. No manual provider collection was requested. No source repair/deployment was justified by the available failure evidence.

Recovery verification is pending. A successful dashboard alone is insufficient; verify protected status reads, scheduled collection progress, cache projection, retention and immutable archive read-back.
