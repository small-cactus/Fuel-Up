# Stop prompt update, 2026-10-06

## Synced evidence

A protected server snapshot contains 6,937 research events, including 1,668 saved location fixes, 34 observed visits, and eight explicit visit labels. Latest received sensor event: 2026-10-06 01:40:35 UTC. The older six-hour device count report cannot establish the current local queue size. A completed server upload is confirmed; a fully empty phone queue is not.

Labels: one fueled, one stopped without fuel, six not-a-stop. Real test notifications are stored separately and excluded. Unanswered visits, wrong-station answers, and unsure answers are not negative examples. Raw events, coordinates, participant IDs, station IDs, and route chronology remain outside the repository.

The two confirmed stops lasted approximately 220 and 231 seconds. Rejected visits spanned 32–139 seconds. Several rejected visits also reported zero speed, so stationary speed alone does not distinguish traffic from station visits. The two-minute v1 candidate rule produced a false candidate; the 30-second departure path produced five additional false prompts.

## Scoped policy

Require three minutes before any real-stop prompt. Keep existing station geometry, speed/accuracy acceptance, sample count, gap rules, research recording, sync policy, notification copy/actions, and explicit confirmation semantics. Version new events as `station-stop-v2`. A restored v1 candidate can cross the new boundary using its original visit ID, so the durable prompt claim still prevents duplicate notifications.

Three minutes is a round conservative threshold with margin above this sample's rejected visits, not an optimized probability model. It intentionally sacrifices prompts for short real stops. Duration does not distinguish buying a drink from buying fuel; participant answers still provide that distinction.

## Evaluation and limitations

| Evidence | v1 | v2 |
| --- | ---: | ---: |
| Actual labeled false notifications in collected events | 6 | Not deployed yet |
| False prompts reproduced by native saved-fix replay | 4 / 6 | 0 / 6 |
| Confirmed fuel stop prompted in replay | 1 / 1 | 1 / 1 |
| Confirmed non-fuel stop prompted in replay | 1 / 1 | 1 / 1 |

The replay runs the real Swift detector and prompt policy against saved fixes. It uses each labeled visit's original station association, current cached station coordinates, and up to 30 seconds of saved fixes after the recorded departure to observe its exit. It does not validate station selection, missed visits, or full-rate callbacks. Downsampling prevents reproduction of two of the original six false prompts. Applying the new duration gate to the recorded visit evidence also excludes all six rejected visits.

All eight labeled visits were examined during development. These are same-participant development results, not held-out accuracy, calibration, or proof of generalization. No fuel classifier was fitted. Future confirmed visits must evaluate lost short-stop recall and whether longer traffic stops still produce false prompts; preserve existing raw records and labels.

## Additional cross-checks

All eight labeled visits have recorded motion events within the visit interval plus 30 seconds on either side. Walking occurs in the one confirmed non-fuel stop, but not in the confirmed fuel stop or six rejected stops. This is a useful hypothesis for future labels, not a fuel-versus-store classifier. Repeated motion records are not independent samples, and absence of a walking event does not prove the user stayed in the car.

Apple's [motion activity flags](https://developer.apple.com/documentation/coremotion/cmmotionactivity) are not exclusive: automotive and stationary can both be true at a red light. Both flags also occur in this sample's confirmed fuel stop. Do not reject a visit using that combination alone.

The most useful candidate additions are [pedometer step counts and estimated walking distance](https://developer.apple.com/documentation/coremotion/cmpedometer) for the stop window, and [system visit events](https://developer.apple.com/documentation/corelocation/clvisit) as corroborating approximate arrival/departure evidence. Pedometer history queries can recover up to seven days, with Motion & Fitness authorization and device availability checks. Missing or unauthorized values must remain unknown, not zero. System visits are not a guaranteed timely notification trigger or independent ground truth. No additional sensor collection is enabled by this change; current consent, collection, and upload scope remain unchanged.

## Reproduce privately

Compile `replayStops.swift` with `DrivingResearchModels.swift` and `DrivingResearchConfirmation.swift`. Pass a private JSON array of events with decoded payload objects, and a private JSON array of station metadata. Only aggregate counts are printed. For comparison, compile the same replayer against the v1 files at `d48798f`.

Validation: native Swift detector/store suite passed, including three-minute boundary, v1 state restoration, brief traffic stops, invalid/duplicate fixes, observation gaps, and unanswered labels. All 14 research endpoint/quiet-mode tests passed. Native Release simulator build passed for arm64 and x86_64. This source change is not part of TestFlight build 23 and has not been installed on a phone.
