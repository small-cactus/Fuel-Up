# October 5, 14:32 UTC database incident

The monitoring heartbeat found the 14:00 national sweep delayed: 20/72 batches archived at 14:33, with metadata timeouts and an archive write failure. Its 15:00 deadline had not passed. The previous 97 hours were complete, with ten historical partial and five absent slots unchanged (113 expected slots including the current running hour). City collection had 2,745 successes, 54 unchanged misses and 54,900 observations. All collection schedules and regional workers were enabled. Archive accounting was 381,591,771 of 900,000,000 bytes; total Storage was 385,866,719 bytes, and database size 376,515,731 bytes. The shared provider cooldown had expired at 11:08 UTC.

The user then reported Home showing no prices after more than a minute. The public Home endpoint reads the same database and makes no provider requests. A request during recovery returned HTTP 503 CACHE_UNAVAILABLE; a later request timed out after 20 seconds. The current app preserves its scoped cache on errors, but waits up to five minutes for its next periodic refresh (returning to the foreground also refreshes).

Supabase dashboard live checks at approximately 14:41 UTC explicitly reported Unhealthy, Database not usable, and TCP CONNECT_TIMEOUT after 5000 ms. The recent database chart reported 90.88% CPU and 1.47 GB memory commitment on the Nano instance; the overview's separate snapshot showed CPU 17%, RAM 62%, disk 10%, with connection metrics unavailable. Those measurements do not establish an infrastructure root cause. Disk I/O budget and several I/O metrics were unavailable.

The read-only coverage query itself timed out. A guarded request to cancel only its exact backend returned no matching active row because the statement timeout had already ended it. No production query or maintenance job was cancelled. A later job snapshot showed the failed archive job had succeeded on its third ordinary attempt; collection remained slow.

## Recovery attempt 1

Restarted only the affected project through the authenticated dashboard at approximately 14:42 UTC under existing recovery authorization. The dashboard confirmed Restarting. Provider requests were not manually triggered, attempts were not reset, budgets/routing/deadlines were unchanged, and original errors were preserved.

## Verified recovery

The dashboard reported Healthy by 14:46 UTC. Two real public Home endpoint requests returned HTTP 200 and 148 Tampa-area regular-fuel prices in 1,307 ms and 403 ms, respectively. Both responses used national-cache and the reported-last-24-hours policy. This verifies the service, not a visual result on the user’s phone; the phone app was not opened.

Ordinary Cron collection resumed without manual collection requests. City successes reached 2,754 (55,080 observations), still 54 historical misses and zero overdue jobs. National run 5936 reached 27/72 batches at 14:46, then continued archiving at 14:47. Its 15:00 deadline remains pending; no full-hour completion is claimed. The latest expired missing slot remains October 4 10:00. All main/watchdog schedules are active. The newest recorded cron startup timeout is 14:43; schedules executed successfully again at 14:45–14:47. There are 15 database connections and no long-running active query at the coverage snapshot.

Six provider-free regional health checks passed. Immutable read-back verified one successful batch from each assigned region, including Virginia job 425595 observed at 14:47:14 after restart. Northern California and Oregon samples were archived before restart; their work had already finished. Hashes, exact IDs, schemas and provenance passed. This sample does not establish full-hour completeness or verified pump prices. No model training used these observations.

Twenty-three focused cache-serving, archive, projection-repair and routing tests passed. No executable code change or deployment was needed. One recovery restart was performed. The underlying resource/platform cause remains unconfirmed; repeated restarts are not a permanent fix.

