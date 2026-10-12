# Station-independent notification timing replay

User correction: predict when to notify before a likely fuel purchase, either during travel or before normal departure. Do not use station identity, preference, proximity, heading toward a station, or route matching. Treat server uploads as instantaneous and replay local device availability. This is a research replay, not deployment of notifications.

Use the same frozen largest-participant export as the anticipation study. Explicit fuel answers are positives; explicit non-fuel answers are negatives; all other encounters and unobserved outcomes are unknown. Use only already-available answers to learn. Sensor receipt time remains causal: instantaneous server upload does not make a delayed Apple callback available earlier.

Predeclare these timing hypotheses before computing results:

1. Clock: with at least two prior answered fuel stops, predict the next 60 minutes when a prior fuel time-of-day lies 0–60 minutes ahead. No station information.
2. Elapsed-cycle: during recorded movement, time since last confirmed fuel is at least 80% of the median of earlier positive intervals; requires three prior confirmed positives.
3. Driving-cycle: during recorded movement, observed driving distance since last confirmed fuel is at least 80% of the median of earlier observed inter-fuel distances; requires three positives and median distance at least 10 km. Distance is a lower bound: never interpolate missing GPS segments longer than two minutes.
4. Clock-and-cycle: during recorded movement, both clock and either cycle signal hold.
5. Before-departure: clock-and-cycle risk plus a recurring departure time 5–20 minutes ahead, while there is no fresh moving fix. A routine needs starts within a 45-minute clock neighborhood on at least three earlier days. Starts are gaps of at least 15 minutes between recorded movement observations, not verified physical departures; count this explicitly as a coverage limitation.

Evaluate a one-minute wall-clock grid across the exported observation period, including stationary periods. Fresh moving means a valid location fix (accuracy <=40 m, unsimulated, receipt lag <=30 seconds) no more than two minutes old with speed >=2.5 m/s. Clock uses a fixed UTC time basis for this short frozen window; no timezone inference from current device settings. Travel-based totals sum only valid consecutive fixes <=120 seconds apart, reject impossible >70 m/s jumps, and never infer zero driving across gaps.

For each policy independently, impose four-hour cooldown and maximum two alerts per UTC day. A positive outcome is a confirmed fuel stop within the following 60 minutes, regardless of station, with at least five minutes of warning. Also report 15-minute warnings. An alert followed by an explicit non-fuel encounter but no confirmed fuel in the window has an explicit negative encounter, not proof that no other fuel was purchased. Unknown outcomes never become negative training labels. Report every policy; no threshold sweep or selecting the best score for a release claim.

Fixed retrospective landmarks at 5, 15, 30 and 60 minutes before fuel stops separately show feature availability and causal trigger state. They do not substitute for continuous alert results. Before-departure successes require the next inferred movement-session start after the alert to precede the matched fuel stop; inferred starts are not verified departure truth. Report observation gaps and late motion callbacks. Do not claim that any one-week/six-positive replay validates notification accuracy.
