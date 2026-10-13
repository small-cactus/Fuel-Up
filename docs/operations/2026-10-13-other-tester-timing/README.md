# Other-tester fueling timing: October 13, 2026

Protected read-only snapshot analyzed at approximately 16:44 UTC. No pushes,
notifications, app launches, or collection changes were performed.

## What is present

Excluding the previously identified owner research account yields 20,542 records.
Three substantial research accounts contain 13,285 / 4,869 / 2,360 records over
6.94 / 6.91 / 0.69 days. They contain 56 / 14 / 6 distinct station visits.
The remaining three accounts contain only 15 / 9 / 4 records; these are not
treated as established driving histories or verified distinct people.

There is one distinct user-confirmed fueling visit and no explicitly negative
visits among these accounts. Two label events refer to that same visit; they
are not two fill-ups. The other 75 visits have unknown outcomes. Nine distinct
visits have prompt records across the three main accounts; prompt records do
not prove the person saw a notification.

Installation telemetry, excluding the owner installation and simulator, contains
713 events across six installations. These include 31 station-selection events,
three Go events, and 368 map-gesture events. Gesture phases are separate events,
not 368 independent browsing sessions. Only one Go event can be joined to a
research account through recorded installationId. That account has no observed
subsequent visit; its very short research history cannot establish non-fueling.

## Actual replay result

Reused `TimingFeatures` and the five unchanged rules in `backtestTiming.py` on
each substantial research account separately. Decisions run every minute with
a four-hour cooldown and two-alert maximum per UTC day. Station identity and
preference are not prediction features. Server upload delays are ignored, as
requested; on-device recording/receipt times and the time a label became known
are preserved. Future answers are used only to score outcomes.

All five personalized rules produced zero alerts. They require at least two
prior confirmed stops for clock habits or three for cycle estimates. No other
tester meets those requirements. This is insufficient history, not evidence
that personalized timing cannot work.

At the sole confirmed stop, there were fresh moving location fixes at both
15 and 30 minutes before arrival. At five minutes before arrival the latest
valid fix was 3.88 minutes old, outside the two-minute freshness requirement.
At 60 minutes there was a fresh fix without a moving-speed indication.
These are retrospective signal-availability checks, not successful predictions.
The confirmed stop predates the October 12 interaction instrumentation: there
are no new packet-context or usage events before it to validate those features.

An illustrative motion-only baseline used the same minute schedule/caps and
alerted whenever a fresh valid fix had speed >=2.5 m/s. It emitted 25 alerts
(11 / 12 / 2) and caught zero confirmed stops 5–60 minutes before arrival.
Fifteen alerts preceded unanswered station encounters and ten had no observed
encounter in that hour. Neither category establishes a false positive because
the actual fueling outcomes and full trip coverage are unknown. This baseline
was selected during this analysis and is not a validated production policy.

## What this supports next

The dataset supports offline signal-availability and notification-volume tests,
and shadow evaluation of frozen timing rules. It does not yet support a reliable
accuracy estimate, generalization claim, or live predictive-alert rollout.
App opens, station selection/Go, movement and elapsed driving are candidate
features; their incremental predictive value remains unmeasured. Historical
sensor batches must only enter a causal replay when the device received them.
Long idle gaps do not prove collection failure or continuous driving distance.

The main missing evidence is independently answered fueling/non-fueling outcomes
after the new instrumentation, across multiple testers and repeated fill-ups.
Keep unanswered visits unknown, freeze candidate thresholds before evaluating
later outcomes, and measure advance lead time plus unwanted-alert burden.

## Evidence and privacy

`aggregate-results.json` contains anonymous cohort aggregates and input hashes.
Raw research and usage exports remain in a private mode-0700 directory outside
the repository; no routes, coordinates, station IDs, installation IDs, or
participant IDs are committed. Account/installation counts are not verified
person counts. `validation.txt` records six passing existing replay tests for
causal cutoffs, station independence, missing-time distance handling, and caps.
The existing CLI report's old hard-coded six-fill-up limitation was not reused;
the evaluator's metrics were extracted and documented for this actual cohort.
