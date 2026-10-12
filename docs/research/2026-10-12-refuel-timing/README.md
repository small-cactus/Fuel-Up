# Notification timing without station preference

The product question is **when to offer cheaper gas**, before a likely fueling trip or while it is underway. Station selection happens after that timing decision and is outside this backtest. No station identity, preferred station, station distance, or route match enters these predictions. Server upload delay is ignored, as requested; records are replayed as available on the phone.

## Frozen participant replay

Use the largest contributor at the October 12 03:59:43 UTC cutoff: 40,962 records over 7.19 days, six explicit fuel answers, 14 explicit non-fuel/not-a-stop answers, and 144 unknown station encounters. This is the same frozen input as the earlier anticipation study; its hash is in `results.json`. Only earlier, already-answered fuel visits train later decisions. The policies and thresholds were written in `PROTOCOL.md` before calculating this timing replay.

Unlike the earlier station-approach experiment, evaluate every minute across the entire record span: **10,351 decisions**, including time when the person is not visibly moving. Each policy independently permits at most two alerts per UTC day with a four-hour cooldown. Count a useful warning when an explicitly confirmed purchase occurs 5–60 minutes later, at any station.

| Timing rule | Alerts | Confirmed purchases 5–60 minutes later | Warning time | Other outcomes |
|---|---:|---:|---|---|
| Usual time of day | 8 | 0 | — | 4 unknown encounters, 3 windows without a recorded encounter, 1 explicit non-fuel encounter |
| Time since last fuel + currently moving | 2 | 2 | **11.77 and 41.72 minutes** | None among the two emitted alerts |
| Observed driving distance since last fuel + currently moving | 2 | 1 | 31.72 minutes | 1 unknown encounter |
| Time of day + either cycle + currently moving | 2 | 2 | 6.77 and 41.72 minutes | None among the two emitted alerts |
| Cycle/time risk + inferred usual departure soon | 2 | 0 | — | 2 windows without a recorded encounter |

The elapsed-cycle policy triggers after 80% of the median of previous positive-to-positive intervals, once movement is observed. It requires three earlier answered fuel stops. **Only three later positive stops were eligible; it caught two of those three.** Thus two successful alerts are an encouraging causal replay result, not a 100%-precision or production-readiness claim. The current evidence supports investigating a reminder during a likely refueling trip more strongly than a reminder before departure.

Observed distance between confirmed purchases ranged from 186 to 346 km, with a median of 201 km. Those are incomplete GPS totals, not vehicle odometer readings or known fuel consumption. The distance rule excludes gaps rather than inventing miles traveled. Fixed pre-purchase landmarks and every tested policy, including unsuccessful ones, are preserved in `results.json`.

Unknown windows are not confirmed false alarms. Positive labels may omit other real purchases, which would affect both learned refuel intervals and evaluation. One selected participant, six positives, and a single week cannot establish generalization or a trustworthy probability threshold. The 80% threshold was a fixed exploratory choice; there was no sweep to select an attractive score.

## Missing evidence and collection update

Existing data is sufficient for this initial timing replay, but not a dependable reconstruction of usual departures. There are **49 valid-location gaps over 15 minutes**; the longest is approximately 23.5 hours. Gaps can include normal stationary periods or unrecorded travel. Only 17 movement-session starts can be inferred from recorded movement gaps, and none is an independently verified departure. The existing motion recovery queries only the last three minutes, so process suspension can lose earlier transitions. Historical device timezone is also absent.

The update adds:

- Apple historical motion activity recovery on normal wakes, at most once per 15 minutes, with an explicit collection boundary, seven-day maximum lookback, and three-minute settling delay.
- Small immutable diagnostic chunks containing original activity timestamps, all activity flags/confidence, query bounds, completion chunk counts, and explicit timeout/error/expired-history evidence. History never changes the live moving state or triggers notifications.
- Receipt-time device timezone, UTC offset and foreground/background state on newly saved research records. Receipt context must not be mistaken for the timezone of a historical activity.

[Apple documents historical motion queries and their retention/delay limits](https://developer.apple.com/documentation/coremotion/cmmotionactivitymanager/queryactivitystarting%28from%3Ato%3Ato%3Awithhandler%3A%29?language=objc). Missing/error history remains unknown; a complete zero-sample response is separately represented. Partial windows can repeat after interruption, so future analysis must deduplicate identical sensor samples and require all chunks before calling a window complete.

This uses existing research enrollment and permissions, durable local storage, and the existing server upload path. No new enrollment is required. It begins when an enrolled, enabled participant first runs the updated build; it cannot silently install the update, guarantee background execution, or reconstruct records from before the new collection boundary. Pausing clears that boundary, so resuming does not recover the paused period. Existing live motion and location records continue unchanged in meaning.

The new records will support learning actual motion transition routines and separating collection gaps from stationary periods. The frozen timing replay above uses the old live records only; recovered chunks are a separately identified historical source for subsequent analyses, not retroactively claimed as live observations.

## Validation and scope

Six synthetic Python checks verify station/upload independence, causal labels and future-outcome invariance, no distance interpolation across missing time, sensor receipt timing, and alert limits. Native tests execute the actual history service with deterministic Apple API substitutes, exercising chunk sizes, persisted cursor, write failure, pause/resume boundaries, timeout/late callback rejection, unavailable history, expiry and permission gating. Live synthetic server read-back is recorded in the release evidence separately.

No predictive user notifications have been enabled. These are timing research and data-collection changes. A cheapest-station recommendation can be attached later to a sufficiently reliable timing decision.

Reproduce with private input (do not commit participant records):

```sh
PYTHONDONTWRITEBYTECODE=1 python3 scripts/driving-research/backtestTiming.py /private/events.jsonl /private/results.json
PYTHONDONTWRITEBYTECODE=1 python3 tests/refuelTiming.test.py
node --test tests/drivingResearchTimingHistory.test.cjs
```
