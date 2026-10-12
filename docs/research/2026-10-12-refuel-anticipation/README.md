# Can background signals anticipate a fuel purchase?

**Exploratory answer:** for the most-recorded participant, recognizing the final approach to their usual station is promising. The available data does not establish reliable prediction of a need to refuel 15–60 minutes ahead, before departure, or for an arbitrary individual.

## Data and outcome definitions

Export cutoff: **2026-10-12 03:59:43.751 UTC**. Select the participant with the highest server event count, not the best prediction score. The four contributors had 40,962, 12,359, 2,276 and 9 records respectively. This replay uses only the first participant: **40,962 records across 7.19 days**, including 10,563 usable location fixes and approximately 22.06 observed moving hours.

Of 164 observed station encounters, 20 have explicit answers: **six “fueled,” five “stopped, no fuel,” and nine “not a stop.”** The remaining 144 are unknown, not negative examples. Answers are self-reports, not receipts or pump verification. All six positive answers identify the same station. A stop timestamp is the detector's first observation and may follow physical arrival; it is not the instant fuel starts dispensing.

Raw events, participant identifiers, station identities and precise routes stay outside this repository. `results.json` contains aggregates and an input hash. `PROTOCOL.md` records baseline hypotheses and the subsequently added exploratory route hypothesis.

## Chronological replay results

At each prediction, only already-received device fixes and already-answered historical visits are available. No future answer, arrival, dwell, departure, route segment or retrospective detector state enters a prediction. The first positive is a cold start; there are five later positive opportunities with prior confirmed history.

| Policy | Continuous alerts | Confirmed fuel stops caught / exact station | Other alert outcomes | Lead before recorded stop |
|---|---:|---:|---|---|
| Moving toward a previously confirmed fuel station, within 2 km | 6 | 5 / 5 | 1 unconfirmed encounter | 0.95–2.63 min; median 1.45 |
| Moving toward a known catalog station, within 2 km | 83 | 1 / 0 | 4 explicit non-fuel, 56 unconfirmed encounters, 22 without an observed encounter | The one match selected the wrong station |
| Matching an earlier answered approach route | 39 | 2 / 2 | 3 explicit non-fuel, 24 unconfirmed encounters, 10 without an observed encounter | 5.72–6.35 min |
| Median previous refuel interval | 0 | 0 / 0 | No alerts | No advance detection |

Continuous evaluation makes at most one decision per recorded moving minute (1,406 opportunities), with a 20-minute cooldown per policy. Approach/interval alerts predict the next 15 minutes; route alerts predict the next 30. Matching uses the next observed station encounter in that window. Intervening encounters can therefore prevent a later fuel stop from matching. Unknown/unobserved outcomes do not establish false positives, so population precision is not identifiable.

The personal approach rule caught **all five later confirmed stops**, with one additional alert whose outcome is unknown. At its five matched alerts, the device was approximately **0.85–1.86 km** from the static station center, and **0.50–2.08 minutes before its first recorded entry within 250 m**. This supports final-approach detection, not merely an alert after the recorded stop. Static geometry and sampled boundary crossings are approximate.

The conditional station-habit baseline also picked the correct station for all five subsequent positives. This answers “where, if a fuel purchase happens”; it supplies no independent evidence of “when.” A constant guess can perform well for a person who uses one station.

The route rule identified the correct station at the fixed five-minute landmark for five of six positives, but it also fired for two answered negatives at that landmark. **Its continuous operational replay caught only two positives with 39 alerts**: earlier triggers and cooldowns change what a real alert system would deliver. The landmark result must not be reported as five operationally successful five-minute warnings. Route matching was added after inspecting baseline results and is an exploratory extension, not an untouched confirmation test.

Neither personal approach nor route matching triggered at the 15-, 30- or 60-minute positive landmarks. Fresh fixes existed for only four, four and three of the six positives respectively at those horizons. Missing observations cause abstention; they do not prove a person was stationary or that prediction is impossible. Positive-to-positive intervals ranged from 21.40 to 69.73 hours, with a median of 24.34 hours. A fixed interval rule did not predict the recorded stops in this replay.

## What the app could use

The useful inputs are ordinary **on-device location, accuracy, speed, heading, known station positions, and personal history of confirmed fuel stops**. Motion and lifecycle records also exist. This collector is consented research instrumentation; these records do not establish that every production user supplies the same signals or that every fix was collected in the background. The replay does not test iOS wake reliability or actual notification delivery.

No observed fuel-gauge level, tank capacity/remaining fuel, purchased quantity or vehicle telemetry establishes how urgently this participant needs gas. Elapsed time or driving distance alone cannot reconstruct that reliably from these answers. Repeated approaches can also be commute, traffic or store trips.

**Prediction would need to run on the phone.** Median server-upload delay across this participant's records was 1.47 hours and the maximum was 25.72 hours; only 1,001 of 40,962 records arrived within two minutes. This analysis replays device availability, not an unrealistically immediate server feed.

The defensible next step is a consented, silent prospective evaluation of the simple personal approach rule, logging predictions before outcomes and obtaining explicit fuel/non-fuel answers. Evaluate whole trips and alert burden across additional people and unseen days before presenting an intent probability or sending proactive alerts. This work changes no app behavior and sends no requests or notifications.

## Reproduction and validation

Run with a private participant JSONL export and private static station coordinate array:

```sh
python3 scripts/driving-research/backtestAnticipation.py \
  /private/path/events.jsonl /private/path/stations.json /private/path/results.json
PYTHONDONTWRITEBYTECODE=1 python3 tests/refuelAnticipation.test.py
```

Seven synthetic tests cover delayed sensor receipt, future catalog exclusion, label availability and correction, future-outcome invariance, invalid/stale fixes, unknown outcomes, and route-label availability. These validate replay mechanics; six positive answers cannot establish generalization. Current catalog coordinates are a static approximation, while eligible station IDs are gated by historical recorded availability. The personal approach rule learns its site position from an earlier observed stop.
