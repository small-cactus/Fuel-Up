# User-authorized project restart and recovery

On October 2 the user explicitly authorized computer-use recovery through their logged-in Safari session after the three automatic repair attempts documented in the projection-isolation incident. The project dashboard displayed an impending Disk IO Budget depletion warning before the restart. This establishes resource pressure, but does not prove the original schema-cache failure's root cause. No paid upgrade was made.

The dashboard Restart project action was submitted around 13:33 UTC. Supabase showed Restarting, then returned to Healthy. At 13:39:00 UTC the protected empty-ID metadata diagnostic returned HTTP 200 in 746 ms, replacing the prior PGRST002/timeout failures. The diagnostic does not claim jobs or query the provider.

Existing Cron resumed collection without manual dispatch, resetting attempts, changing schedules, extending either window, or altering regional routing. Fresh national archives were observed in Virginia, Northern California and Oregon. `regional-readback.json` verifies a post-restart immutable object from each region: SHA-256, exact station IDs, price schema, observation window and provenance all passed. This is a three-batch sample, not full-hour verification or verified pump truth. Original errors and historical gaps remain intact.

At the final status capture the 13:00 run (1728) had 17/72 batches, 32,213 catalog IDs and 20,535 stations with prices. Its deadline is 14:00, so remaining batches are still in progress. There are 27 complete national hours across 40 expected slots: seven expired partial/empty run rows, five historical unstarted hours, and the current running hour. The October 2 11:00 and 12:00 hours expired empty; 10:00 remains 61/72. The city collector has resumed, with a fresh success at 13:39:02, 1,006 successes and 42 misses (10 more than the previous checkpoint).

All collector main/watchdog schedules remained active. The shared provider cooldown is expired; zero wrong-region jobs were observed. Database size is 322,497,683 bytes and Storage 121,354,160 bytes, with 117,079,212 bytes against the unchanged 900,000,000-byte national archive budget. Scheduled Cron executions at 13:39 and 13:40 succeeded. A serving-projection timeout at 13:40 remains recorded; raw collection continued successfully. Dashboard CPU remained elevated, so sustained recovery should be watched by the existing hourly monitor. No guarantee that resource pressure cannot recur is implied.

## 14:08 UTC follow-up

The recovered 13:00 national sweep completed at 13:55:34 with all 72 batches.
`full-hour-1728-readback.json` independently verifies every immutable archived
batch: hashes, schema, observation windows, fixed catalog IDs, and regional
provenance. All 141,660 IDs are accounted for; 94,856 stations have reported
prices and 46,804 do not. These remain provider observations, not pump truth;
the catalog's Texas/DC coverage assumptions remain unchanged.

There are now 41 expected national slots: 28 complete, 12 expired incomplete
(including the five historical hours without run rows), and one current hour.
The 14:00 sweep had 30/72 batches at the status capture and is before its 15:00
deadline. City collection has 1,014 successes and the same 42 misses, no expired
unfinished jobs, and its next city job is due at 14:19. No new gaps appeared.
All recent scheduled jobs succeeded, both main/watchdog schedules remain active,
and the shared cooldown is expired. Two transient 503 attempts during 13:00 were
retried successfully; the original errors remain recorded. Optional serving
projection timeouts persist without blocking the research archives.

Database size was 335,064,211 bytes; Storage 125,759,964 bytes; accounted national
archives 121,485,016 of the unchanged 900,000,000-byte budget. All six provider-free
regional health checks passed and no wrong-region jobs were found. No collection
was manually dispatched and no repair, budget, schedule, or window change was
needed. The slot counts and regional checks are saved in the follow-up files.

## Requested phone installation

The current master tree (61c3667, including onboarding change f0454f1) built successfully as a signed Release for the connected iPhone 18 Pro Max. `devicectl` confirmed installation of com.anthonyh.fuelup and a subsequent installed-app query found Fuel Up 1.0.0 (1). The app was not launched. This confirms build and installation, not device interaction or end-to-end UI validation.

Validation for this evidence-only checkpoint: JSON parsing, whitespace checks, protected API success, scheduled collection writes, and immutable read-back. No source code changed or new provider collection was manually initiated.
